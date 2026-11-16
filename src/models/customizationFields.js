import mongoose from "mongoose";
import { publicCustomizationPerson } from "../utils/contactPrivacy.js";

export const customizationConfigSchema = new mongoose.Schema(
  {
    template: { type: String, enum: ["partner", "birthday"] },
    wishMessage: { type: String, maxlength: 280 },
    title: { type: String, required: true, maxlength: 60 },
    accent: { type: String, required: true },
    background: { type: String, required: true },
    surface: { type: String, required: true },
    text: { type: String, required: true },
    loadingAnimation: { type: String, required: true },
    headerAnimation: { type: String, required: true },
    lyricsAnimation: { type: String, required: true },
    durationMinutes: { type: Number, default: null, min: 1, max: 525600 },
    loadingMessage: { type: String, maxlength: 140, default: "" },
  },
  { _id: false },
);

export const appliedCustomizationSchema = new mongoose.Schema(
  {
    designId: { type: mongoose.Schema.Types.ObjectId, required: true },
    config: { type: customizationConfigSchema, required: true },
    creator: {
      id: { type: mongoose.Schema.Types.ObjectId, required: true },
      name: { type: String, default: null },
      email: { type: String, default: null },
      phone: { type: String, default: null },
    },
    expiresAt: { type: Date, default: null },
    appliedAt: { type: Date, required: true },
  },
  { _id: false },
);

export function publicCustomization(value, now = Date.now()) {
  if (!value?.config || !value?.creator) return null;
  if (value.expiresAt != null && !(+new Date(value.expiresAt) > now))
    return null;
  return {
    expiresAt: value.expiresAt ?? null,
    id: String(value.designId),
    config: value.config.toObject ? value.config.toObject() : value.config,
    creator: publicCustomizationPerson(value.creator),
    appliedAt: value.appliedAt,
  };
}
