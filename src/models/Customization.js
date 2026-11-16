import mongoose from "mongoose";
import { customizationConfigSchema } from "./customizationFields.js";

const schema = new mongoose.Schema(
  {
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    config: { type: customizationConfigSchema, required: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined"],
      default: "pending",
    },
  },
  { timestamps: true },
);
schema.index({ creator: 1, recipient: 1 }, { unique: true });
schema.index({ recipient: 1, updatedAt: -1 });
export const Customization = mongoose.model("Customization", schema);
