import "dotenv/config";
import { v2 as cloudinary } from "cloudinary";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { MediaUpload } from "../models/MediaUpload.js";
import { AppError } from "../utils/http.js";

export const MEDIA_LIMITS = { avatar: 5 * 1024 ** 2, image: 10 * 1024 ** 2, video: 100 * 1000 ** 2, audio: 100 * 1000 ** 2 };
const FORMATS = { image: ["jpg", "jpeg", "png", "webp", "gif", "heic", "avif"], video: ["mp4", "mov", "webm", "mkv"], audio: ["mp3", "m4a", "mp4", "aac", "wav", "ogg", "flac", "webm"] };
export function mediaOptions(upload) {
  return { resource_type: upload.kind === "image" ? "image" : "video", type: upload.purpose === "chat" ? "authenticated" : "upload" };
}
function configured() {
  const config = cloudinary.config();
  if (!config.cloud_name || !config.api_key || !config.api_secret) throw new AppError(503, "Media uploads are not configured yet.");
  return config;
}

export async function beginUpload(owner, input) {
  const config = configured();
  const maxBytes = MEDIA_LIMITS[input.purpose === "avatar" ? "avatar" : input.kind];
  if (input.size > maxBytes) throw new AppError(413, `Choose a file smaller than ${Math.round(maxBytes / 1000 ** 2)} MB.`);
  const publicId = `zyrava/${input.purpose}/${randomUUID()}`;
  const upload = await MediaUpload.create({ owner, ...input, publicId, expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
  const options = mediaOptions(upload);
  const params = { public_id: publicId, timestamp: Math.floor(Date.now() / 1000), overwrite: false,
    type: options.type, allowed_formats: FORMATS[input.kind].join(",") };
  return { uploadId: String(upload._id), url: `https://api.cloudinary.com/v1_1/${config.cloud_name}/${options.resource_type}/upload`,
    fields: { ...params, api_key: config.api_key, signature: cloudinary.utils.api_sign_request(params, config.api_secret) }, maxBytes };
}

export function verifyMediaResource(upload, resource) {
  const options = mediaOptions(upload);
  const limit = MEDIA_LIMITS[upload.purpose === "avatar" ? "avatar" : upload.kind];
  if (resource.public_id !== upload.publicId || resource.resource_type !== options.resource_type || resource.type !== options.type ||
      !FORMATS[upload.kind].includes(resource.format) || !resource.bytes || resource.bytes > limit ||
      (upload.kind === "audio" && resource.width > 0) || (upload.kind !== "audio" && !(resource.width > 0 && resource.height > 0))) {
    throw new AppError(422, "This file is not a supported media file or exceeds the upload limit.");
  }
  return resource;
}

export function attachmentView(upload, resource) {
  const common = { ...mediaOptions(upload), secure: true, sign_url: true, version: resource.version };
  const transformation = upload.kind === "image"
    ? upload.purpose === "avatar"
      ? { width: 320, height: 320, crop: "fill", gravity: "auto", quality: "auto", fetch_format: "auto" }
      : { width: 1200, crop: "limit", quality: "auto", fetch_format: "auto" }
    : { quality: "auto", ...(upload.kind === "video" ? { width: 1280, crop: "limit" } : {}) };
  return { id: String(upload._id), kind: upload.kind, name: upload.name,
    url: cloudinary.url(upload.publicId, { ...common, ...transformation, ...(upload.kind === "image" ? {} : { format: upload.kind === "audio" ? "mp3" : "mp4" }) }),
    width: resource.width || 0, height: resource.height || 0, bytes: resource.bytes, duration: resource.duration || 0 };
}

export async function ownedUpload(owner, id) {
  const row = await MediaUpload.findOne({ _id: id, owner });
  if (!row || ["discarded", "discarding", "cleaning"].includes(row.usedBy) || row.expiresAt < new Date() && !row.usedBy) throw new AppError(404, "This upload has expired. Please choose the file again.");
  return row;
}

export async function finishUpload(owner, id) {
  configured();
  const upload = await ownedUpload(owner, id);
  if (upload.attachment) return upload.attachment;
  let resource;
  try { resource = await cloudinary.api.resource(upload.publicId, { ...mediaOptions(upload), timeout: 15000 }); }
  catch { throw new AppError(422, "The upload has not finished. Please try again."); }
  verifyMediaResource(upload, resource);
  upload.attachment = attachmentView(upload, resource);
  await upload.save();
  return upload.attachment;
}

export async function claimUpload(owner, id, purpose, usedBy, conversation) {
  const upload = await MediaUpload.findOneAndUpdate({ _id: id, owner, purpose, usedBy: null,
    ...(conversation ? { conversation } : {}),
    attachment: mongoose.trusted({ $ne: null }), expiresAt: mongoose.trusted({ $gt: new Date() }),
  }, { $set: { usedBy: `${purpose}:${usedBy}` } }, { new: true });
  if (!upload) throw new AppError(422, "This attachment is unavailable. Please upload it again.");
  return upload;
}

export async function discardUpload(owner, id) {
  // Claim deletion atomically; an attachment being sent cannot be deleted here.
  const row = await MediaUpload.findOneAndUpdate({ _id: id, owner, usedBy: null }, { $set: { usedBy: "discarding" } }, { new: true });
  if (!row) return;
  try {
    await cloudinary.uploader.destroy(row.publicId, { ...mediaOptions(row), invalidate: true });
    // Retain the grant until its signature expires: a canceled browser request
    // may still finish uploading, and must be picked up by cleanup later.
    await MediaUpload.updateOne({ _id: row._id, usedBy: "discarding" }, { $set: { usedBy: "discarded" } });
  } catch {
    await MediaUpload.updateOne({ _id: row._id, usedBy: "discarding" }, { $set: { usedBy: null } });
    throw new AppError(503, "Could not remove this upload. Try again shortly.");
  }
}

export async function cleanupUploads() {
  // Signed upload requests expire after an hour. Wait an extra day so canceled
  // uploads finishing late are also removed, never a published chat attachment.
  const rows = await MediaUpload.find({ usedBy: mongoose.trusted({ $in: [null, "discarded", "discarding", "cleaning"] }), expiresAt: mongoose.trusted({ $lt: new Date(Date.now() - 86400000) }) }).limit(100);
  for (const candidate of rows) {
    const row = await MediaUpload.findOneAndUpdate({ _id: candidate._id, usedBy: candidate.usedBy }, { $set: { usedBy: "cleaning" } }, { new: true });
    if (!row) continue;
    try {
      await cloudinary.uploader.destroy(row.publicId, { ...mediaOptions(row), invalidate: true });
      await MediaUpload.deleteOne({ _id: row._id, usedBy: "cleaning" });
    } catch(error) {
      await MediaUpload.updateOne({ _id: row._id, usedBy: "cleaning" }, { $set: { usedBy: candidate.usedBy } });
      throw error;
    }
  }
  return rows.length;
}
