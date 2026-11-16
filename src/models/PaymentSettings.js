import mongoose from "mongoose";
const credentialSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    keyId: { type: String, required: true },
    secret: { type: String, required: true },
  },
  { _id: false },
);
const schema = new mongoose.Schema(
  {
    _id: { type: String, default: "customization" },
    amount: {
      type: Number,
      min: 100,
      max: 1000000,
      default: 500,
      required: true,
    },
    currency: { type: String, enum: ["INR"], default: "INR" },
    activeCredentialId: { type: String, default: null },
    credentials: { type: [credentialSchema], default: [] },
    webhookSecret: { type: String, default: null },
    updatedBy: { type: String, default: null },
  },
  { timestamps: true },
);
export const PaymentSettings = mongoose.model("PaymentSettings", schema);
