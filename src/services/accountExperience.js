import mongoose from "mongoose";
import { User } from "../models/User.js";
import { AppError } from "../utils/http.js";

// Match the verified existing account only; do not include lookalike addresses.
export const PERSONAL_ACCOUNT_EMAIL = "vimitharadottukaya@gmail.com";

export function accountExperience(user) {
  return user?.email?.trim().toLowerCase() === PERSONAL_ACCOUNT_EMAIL
    ? "brown-burgundy"
    : "standard";
}

export function communityUserFilter() {
  return { email: mongoose.trusted({ $ne: PERSONAL_ACCOUNT_EMAIL }) };
}

export async function assertCommunityUser(userId) {
  const user = await User.findById(userId).select("email").lean();
  if (!user || accountExperience(user) !== "standard") {
    throw new AppError(403, "Community is unavailable for this account.");
  }
}

export async function hiddenCommunityIds() {
  const users = await User.find({ email: PERSONAL_ACCOUNT_EMAIL }).select("_id").lean();
  return users.map((user) => user._id);
}
