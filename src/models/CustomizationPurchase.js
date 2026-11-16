import mongoose from "mongoose";
import { customizationConfigSchema } from "./customizationFields.js";

const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    purpose: {
      type: String,
      enum: ["customization_self", "customization_gift"],
    },
    requestId: { type: String, required: true },
    config: { type: customizationConfigSchema, required: true },
    amount: {
      type: Number,
      min: 100,
      max: 1000000,
      default: 500,
      required: true,
    },
    currency: { type: String, enum: ["INR"], default: "INR", required: true },
    credentialId: { type: String, required: true },
    paymentStatus: {
      type: String,
      enum: [
        "created",
        "authorized",
        "captured",
        "failed",
        "refunded",
        "partially_refunded",
        "order_failed",
      ],
      default: "created",
    },
    lastPaymentId: String,
    lastCheckedAt: Date,
    capturedAt: Date,
    capturedAmount: { type: Number, default: 0 },
    amountRefunded: { type: Number, default: 0 },
    failureCode: String,
    keyId: { type: String, required: true },
    orderId: { type: String },
    paymentId: { type: String },
    status: {
      type: String,
      enum: ["creating", "pending", "fulfilled"],
      default: "creating",
    },
    fulfilledAt: Date,
    designId: { type: mongoose.Schema.Types.ObjectId, ref: "Customization" },
  },
  { timestamps: true },
);
schema.index({ user: 1, requestId: 1 }, { unique: true });
schema.index({ orderId: 1 }, { unique: true, sparse: true });
schema.index({ paymentId: 1 }, { unique: true, sparse: true });
schema.index({ user: 1, status: 1, createdAt: -1 });
schema.index({ user: 1, createdAt: -1, _id: -1 });
export const CustomizationPurchase = mongoose.model(
  "CustomizationPurchase",
  schema,
);
