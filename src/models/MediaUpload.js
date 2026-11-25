import mongoose from "mongoose";

const schema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation" },
  purpose: { type: String, enum: ["chat", "avatar"], required: true },
  kind: { type: String, enum: ["image", "video", "audio"], required: true },
  publicId: { type: String, required: true, unique: true },
  name: { type: String, maxlength: 120 },
  attachment: { type: mongoose.Schema.Types.Mixed, default: null },
  usedBy: { type: String, default: null },
  expiresAt: { type: Date, required: true, index: true },
}, { timestamps: true });
// No TTL: cleanup must delete the Cloudinary asset before dropping its ownership record.
export const MediaUpload = mongoose.model("MediaUpload", schema);
