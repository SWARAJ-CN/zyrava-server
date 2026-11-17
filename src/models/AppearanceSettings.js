import mongoose from "mongoose";

const schema = new mongoose.Schema(
  {
    _id: { type: String, default: "appearance" },
    vimithaThemeEnabled: { type: Boolean, required: true, default: true },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true },
);

export const AppearanceSettings = mongoose.model("AppearanceSettings", schema);
