import mongoose from "mongoose";
import { Message } from "../models/Message.js";
import { Conversation } from "../models/Conversation.js";
import { MediaUpload } from "../models/MediaUpload.js";
import { AppError } from "../utils/http.js";
import { authorizeConversation, toMessageItem, replyView } from "./communityService.js";
import { REACTIONS } from "../validators/community.js";

export const EDIT_WINDOW_MS = 20 * 60 * 1000;
const visible = viewerId => ({ hiddenFor: mongoose.trusted({ $ne: viewerId }) });

async function load(viewerId, conversationId, messageId, write = false) {
  const conversation = await authorizeConversation(viewerId, conversationId, write);
  const message = await Message.findOne({ _id: messageId, conversation: conversationId, ...visible(viewerId) }).lean();
  if (!message) throw new AppError(404, "This message is no longer available.");
  return { conversation, message };
}

async function result(viewerId, conversation, message) {
  const reply = message.replyTo ? await Message.findOne({ _id: message.replyTo, conversation: conversation._id, ...visible(viewerId) }).lean() : null;
  return { message: toMessageItem(message, viewerId, replyView(reply)), conversationId: String(conversation._id),
    memberIds: conversation.members.map(String).filter(id => !(message.hiddenFor ?? []).map(String).includes(id)) };
}

export async function editMessage(viewerId, { conversationId, messageId, text }) {
  const { conversation, message } = await load(viewerId, conversationId, messageId, true);
  if (String(message.from) !== String(viewerId)) throw new AppError(403, "You can only edit your own messages.");
  const clean = String(text).trim();
  if (!clean || clean.length > 2000) throw new AppError(422, "Enter a message of up to 2000 characters.");
  // Check in the database write too, so crossing the deadline while editing cannot bypass it.
  const updated = await Message.findOneAndUpdate({ _id: messageId, from: viewerId, conversation: conversationId, deletedAt: null,
    ...visible(viewerId), createdAt: mongoose.trusted({ $gt: new Date(Date.now() - EDIT_WINDOW_MS) }),
  }, { $set: { text: clean, editedAt: new Date() }, $inc: { revision: 1 } }, { new: true }).lean();
  if (!updated) throw new AppError(409, "Messages can only be edited within 20 minutes of sending.");
  return result(viewerId, conversation, updated);
}

export async function deleteMessage(viewerId, { conversationId, messageId, scope }) {
  const { conversation, message } = await load(viewerId, conversationId, messageId);
  if (scope === "me") {
    await Message.updateOne({ _id: messageId, conversation: conversationId }, { $addToSet: { hiddenFor: viewerId } });
    return { conversationId, messageId, removed: true, memberIds: [String(viewerId)] };
  }
  if (String(message.from) !== String(viewerId)) throw new AppError(403, "You can only delete your own messages for everyone.");
  const updated = await Message.findOneAndUpdate({ _id: messageId, from: viewerId, conversation: conversationId },
    { $set: { text: "", attachment: null, replyTo: null, reactions: {}, deletedAt: new Date() }, $inc: { revision: 1 } }, { new: true }).lean();
  if (message.attachment?.id) {
    // The regular cleanup job invalidates the Cloudinary asset after the grace period.
    await MediaUpload.updateOne({ _id: message.attachment.id, owner: viewerId, conversation: conversationId }, { $set: { usedBy: null, expiresAt: new Date() } });
  }
  return result(viewerId, conversation, updated);
}

export async function reactToMessage(viewerId, { conversationId, messageId, emoji }) {
  const { conversation } = await load(viewerId, conversationId, messageId, true);
  if (emoji !== null && !REACTIONS.includes(emoji)) throw new AppError(422, "Choose one of the four reactions.");
  const key = `reactions.${viewerId}`;
  const updated = await Message.findOneAndUpdate({ _id: messageId, conversation: conversationId, deletedAt: null, ...visible(viewerId) },
    { ...(emoji ? { $set: { [key]: emoji } } : { $unset: { [key]: 1 } }), $inc: { revision: 1 } }, { new: true }).lean();
  if (!updated) throw new AppError(409, "This message was deleted.");
  return result(viewerId, conversation, updated);
}

export async function clearChat(viewerId, conversationId) {
  await authorizeConversation(viewerId, conversationId, false);
  const clearedAt = new Date();
  await Message.updateMany({ conversation: conversationId, createdAt: mongoose.trusted({ $lte: clearedAt }), ...visible(viewerId) }, { $addToSet: { hiddenFor: viewerId } });
  return { conversationId, clearedAt };
}

export async function blockChat(viewerId, conversationId, blocked) {
  const conversation = await authorizeConversation(viewerId, conversationId, false);
  await Conversation.updateOne({ _id: conversationId }, blocked ? { $addToSet: { blockedBy: viewerId } } : { $pull: { blockedBy: viewerId } });
  return { conversationId, memberIds: conversation.members.map(String) };
}
