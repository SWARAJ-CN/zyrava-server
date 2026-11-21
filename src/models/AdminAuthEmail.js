import mongoose from "mongoose";

const schema = new mongoose.Schema({
  event: { type: String, enum: ["registration", "login"], required: true },
  recipient: { type: String, required: true },
  name: String,
  email: String,
  phone: String,
  user: { type: mongoose.Schema.Types.ObjectId, required: true },
  occurredAt: { type: Date, required: true },
  status: { type: String, enum: ["pending", "sending", "accepted", "failed"], default: "pending" },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  leaseUntil: Date,
  leaseId: String,
  lastError: String,
  acceptedAt: Date,
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
}, { timestamps: true });
schema.index({ status: 1, nextAttemptAt: 1 });
export const AdminAuthEmail = mongoose.model("AdminAuthEmail", schema);
