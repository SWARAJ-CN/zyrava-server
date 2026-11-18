import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Customization } from "../models/Customization.js";
import { publicCustomization } from "../models/customizationFields.js";
import {
  accountExperience,
  PERSONAL_ACCOUNT_EMAIL,
} from "./accountExperience.js";
import { AppError } from "../utils/http.js";

import { publicCustomizationPerson as person } from "../utils/contactPrivacy.js";
import { normalizePhone } from "../validators/auth.js";

export async function assertCustomizer(id, session = null) {
  const user = await User.findById(id)
    .select("name email phone customization")
    .session(session)
    .lean();
  if (!user) throw new AppError(404, "Account not found.");
  if (accountExperience(user) !== "standard")
    throw new AppError(403, "This account has a reserved personal experience.");
  return user;
}
export async function recipient(id, session = null) {
  const user = await User.findById(id)
    .select("name email phone")
    .session(session)
    .lean();
  if (!user || accountExperience(user) !== "standard")
    throw new AppError(404, "Recipient not found.");
  return user;
}
export async function searchRecipients(userId, query) {
  await assertCustomizer(userId);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(escaped, "i");
  const phoneQuery = normalizePhone(query).replace(/^\+/, "");
  const filters = [{ email: match }, { name: match }];
  if (/^\d{3,15}$/.test(phoneQuery))
    filters.push({ phone: new RegExp(phoneQuery) });
  const users = await User.find({
    email: mongoose.trusted({ $ne: PERSONAL_ACCOUNT_EMAIL }),
    $or: filters,
  })
    .select("name email phone")
    .sort({ name: 1, _id: 1 })
    .limit(8)
    .lean();
  return users
    .filter((user) => accountExperience(user) === "standard")
    .map(person);
}
function designView(design) {
  if (
    !design.creator ||
    !design.recipient ||
    accountExperience(design.creator) !== "standard" ||
    accountExperience(design.recipient) !== "standard"
  )
    return null;
  return {
    id: String(design._id),
    config: design.config,
    creator: person(design.creator),
    recipient: person(design.recipient),
    status: design.status,
    updatedAt: design.updatedAt,
  };
}
export async function readCustomizations(userId) {
  const user = await assertCustomizer(userId);
  const rows = await Customization.find({
    $or: [{ recipient: userId }, { creator: userId }],
  })
    .sort({ updatedAt: -1 })
    .limit(100)
    .populate("creator", "name email phone")
    .populate("recipient", "name email phone")
    .lean();
  const designs = rows.map(designView).filter(Boolean);
  return {
    active: publicCustomization(user.customization),
    incoming: designs.filter(
      (item) =>
        item.recipient.id === String(userId) &&
        item.creator.id !== String(userId) &&
        item.status === "pending",
    ),
    received: designs.filter(
      (item) =>
        item.recipient.id === String(userId) &&
        item.creator.id !== String(userId) &&
        item.status !== "declined",
    ),
    outgoing: designs.filter((item) => item.creator.id === String(userId)),
  };
}
async function applyDesign(userId, design, creator, session = null) {
  const appliedAt = new Date();
  const snapshot = {
    designId: design._id,
    config: design.config,
    creator: {
      id: creator._id,
      name: creator.name ?? null,
      email: creator.email ?? null,
      phone: creator.phone ?? null,
    },
    appliedAt,
    expiresAt: design.config.durationMinutes
      ? new Date(+appliedAt + design.config.durationMinutes * 60_000)
      : null,
  };
  await User.updateOne(
    { _id: userId, email: mongoose.trusted({ $ne: PERSONAL_ACCOUNT_EMAIL }) },
    { $set: { customization: snapshot } },
    { session },
  );
}
export async function persistCustomization(userId, input, session = null) {
  const creator = await assertCustomizer(userId, session);
  await recipient(input.recipientId, session);
  const self = String(userId) === input.recipientId;
  // One editable proposal per creator/recipient pair. Editing a sent design
  // never changes an already accepted snapshot without the recipient applying it.
  const design = await Customization.findOneAndUpdate(
    { creator: userId, recipient: input.recipientId },
    { $set: { config: input.config, status: self ? "accepted" : "pending" } },
    {
      upsert: true,
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true,
      session,
    },
  );
  if (self) await applyDesign(userId, design, creator, session);
  return design;
}
// Customization is free; gifting still requires the recipient to accept.
export async function saveCustomization(userId, input) {
  await persistCustomization(userId, input);
  return readCustomizations(userId);
}
export async function respondCustomization(userId, id, accept, updatedAt) {
  await assertCustomizer(userId);
  // Ownership belongs in the database filter, not in a client-supplied email.
  const design = await Customization.findOne({ _id: id, recipient: userId });
  if (!design) throw new AppError(404, "Customization not found.");
  if (+new Date(updatedAt) !== +new Date(design.updatedAt))
    throw new AppError(
      409,
      "This design changed. Refresh its preview before applying it.",
    );
  const creator = await recipient(design.creator);
  if (accept) await applyDesign(userId, design, creator);
  // A concurrent new proposal must remain pending instead of being marked read.
  await Customization.updateOne(
    { _id: id, recipient: userId, updatedAt: design.updatedAt },
    { $set: { status: accept ? "accepted" : "declined" } },
  );
  return readCustomizations(userId);
}
export async function resetCustomization(userId) {
  await assertCustomizer(userId);
  await User.updateOne({ _id: userId }, { $unset: { customization: "" } });
  return readCustomizations(userId);
}

export async function removeCustomization(userId, id) {
  await assertCustomizer(userId);
  const design = await Customization.findOne({ _id: id, recipient: userId });
  if (!design) throw new AppError(404, "Customization not found.");
  await Customization.updateOne(
    { _id: id, recipient: userId },
    { $set: { status: "declined" } },
  );
  // Removing a gift must never reset a different active design.
  await User.updateOne(
    { _id: userId, "customization.designId": id },
    { $unset: { customization: "" } },
  );
  return readCustomizations(userId);
}
