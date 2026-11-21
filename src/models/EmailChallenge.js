import mongoose from "mongoose";
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  purpose: { type: String, enum: ["login", "reset"], required: true },
  tokenHash: { type: String, required: true, unique: true },
  codeHash: String,
  passwordStamp: { type: String, required: true },
  remember: { type: Boolean, default: false },
  authEvent: { type: String, enum: ["registration", "login"], default: "login" },
  attempts: { type: Number, default: 0 },
  sends: { type: Number, default: 1 },
  sentAt: { type: Date, required: true },
  verifiedAt: Date,
  resetTokenHash: { type: String, index: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
});
schema.index({ user: 1, purpose: 1 }, { unique: true });
export const EmailChallenge = mongoose.model("EmailChallenge", schema);
