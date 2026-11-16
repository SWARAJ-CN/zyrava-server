import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { PaymentSettings } from "../models/PaymentSettings.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/http.js";
function encryptionKey() {
  const key = Buffer.from(env.paymentSettingsEncryptionKey ?? "", "base64");
  if (key.length !== 32)
    throw new AppError(
      503,
      "Payment settings encryption is not configured on the server.",
    );
  return key;
}
export function encryptPaymentSecret(value, context) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((b) => b.toString("base64"))
    .join(":");
}
export function decryptPaymentSecret(value, context) {
  try {
    const [iv, tag, data] = value
      .split(":")
      .map((v) => Buffer.from(v, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new AppError(
      503,
      "Stored payment credentials cannot be opened. Check the server encryption key.",
    );
  }
}
async function settings() {
  const existing = await PaymentSettings.findById("customization").lean();
  if (existing) return existing;
  const credentials = [];
  let activeCredentialId = null,
    webhookSecret = null;
  if (env.razorpayKeyId && env.razorpayKeySecret) {
    activeCredentialId = randomUUID();
    credentials.push({
      id: activeCredentialId,
      keyId: env.razorpayKeyId,
      secret: encryptPaymentSecret(env.razorpayKeySecret, activeCredentialId),
    });
  }
  if (env.razorpayWebhookSecret)
    webhookSecret = encryptPaymentSecret(env.razorpayWebhookSecret, "webhook");
  try {
    return await PaymentSettings.findOneAndUpdate(
      { _id: "customization" },
      {
        $setOnInsert: {
          amount: 500,
          currency: "INR",
          activeCredentialId,
          credentials,
          webhookSecret,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();
  } catch (e) {
    if (e.code === 11000)
      return PaymentSettings.findById("customization").lean();
    throw e;
  }
}
function publicSettings(row) {
  const active = row.credentials.find((c) => c.id === row.activeCredentialId);
  return {
    amount: row.amount,
    amountRupees: row.amount / 100,
    currency: row.currency,
    keyId: active?.keyId ?? null,
    configured: !!active,
    webhookConfigured: !!row.webhookSecret,
    encryptionReady:
      Buffer.from(env.paymentSettingsEncryptionKey ?? "", "base64").length ===
      32,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy ?? null,
  };
}
export const credentialVerifier = {
  async check(keyId, secret) {
    let response;
    try {
      response = await fetch("https://api.razorpay.com/v1/orders?count=1", {
        headers: {
          Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}`,
        },
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new AppError(
        503,
        "Could not verify the new Razorpay keys. Settings were not changed.",
      );
    }
    await response.body?.cancel();
    if (!response.ok)
      throw new AppError(
        400,
        "Razorpay rejected that key pair. Settings were not changed.",
      );
  },
};
export const paymentSettings = {
  async get() {
    const row = await settings(),
      active = row.credentials.find((c) => c.id === row.activeCredentialId);
    if (!active)
      throw new AppError(
        503,
        "Payments are not configured. Please try again later.",
      );
    return {
      amount: row.amount,
      currency: row.currency,
      keyId: active.keyId,
      secret: decryptPaymentSecret(active.secret, active.id),
      credentialId: active.id,
    };
  },
  async credential(id, keyId) {
    const row = await settings(),
      saved = row.credentials.find((c) =>
        id ? c.id === id : c.keyId === keyId,
      );
    if (!saved)
      throw new AppError(
        503,
        "The credentials for this payment are unavailable. Contact support before paying again.",
      );
    return {
      keyId: saved.keyId,
      secret: decryptPaymentSecret(saved.secret, saved.id),
    };
  },
  async webhookSecret() {
    const row = await settings();
    return row.webhookSecret
      ? decryptPaymentSecret(row.webhookSecret, "webhook")
      : null;
  },
  async public() {
    return publicSettings(await settings());
  },
  async update(input, adminEmail) {
    encryptionKey();
    if (input.keyId && input.keySecret)
      await credentialVerifier.check(input.keyId, input.keySecret);
    await settings();
    const update = {
      $set: { amount: input.amountRupees * 100, updatedBy: adminEmail },
    };
    if (input.keyId && input.keySecret) {
      const id = randomUUID();
      update.$set.activeCredentialId = id;
      update.$push = {
        credentials: {
          id,
          keyId: input.keyId,
          secret: encryptPaymentSecret(input.keySecret, id),
        },
      };
    }
    if (input.webhookSecret)
      update.$set.webhookSecret = encryptPaymentSecret(
        input.webhookSecret,
        "webhook",
      );
    const row = await PaymentSettings.findOneAndUpdate(
      { _id: "customization" },
      update,
      { new: true, runValidators: true },
    ).lean();
    return publicSettings(row);
  },
};
