import mongoose from "mongoose";
import { appliedCustomizationSchema } from "./customizationFields.js";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 80 },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 254,
      index: { unique: true, sparse: true },
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 16,
      index: { unique: true, sparse: true },
    },
    authVersion: { type: Number, default: 0 },
    passwordHash: { type: String, required: true, select: false },
    customization: { type: appliedCustomizationSchema, default: null },
    lastLoginAt: { type: Date },
    /** Updated by the realtime layer, so offline profiles still show a pulse. */
    lastSeenAt: { type: Date, index: true },
  },
  { timestamps: true }
);

userSchema.set("toJSON", {
  transform(_document, value) {
    delete value.passwordHash;
    delete value.__v;
    return value;
  },
});

export const User = mongoose.model("User", userSchema);
