import mongoose from "mongoose";

/**
 * One row per active refresh token. Tokens are stored only as SHA-256 hashes,
 * are rotated on every refresh, and expire through MongoDB's TTL monitor.
 */
const sessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    tokenHash: { type: String, required: true, unique: true },
    remember: { type: Boolean, default: false },
    userAgent: { type: String, maxlength: 220 },
    ip: { type: String, maxlength: 64 },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

export const Session = mongoose.model("Session", sessionSchema);
