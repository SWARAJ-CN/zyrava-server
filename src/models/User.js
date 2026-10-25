import mongoose from "mongoose";

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
    passwordHash: { type: String, required: true, select: false },
    lastLoginAt: { type: Date },
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
