import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "../utils/http.js";
import { paymentSettings } from "./paymentSettingsService.js";
export function validSignature(payload, signature, secret) {
  if (typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature))
    return false;
  const expected = createHmac("sha256", secret).update(payload).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
async function request(path, purchase, body) {
  const { keyId, secret } = await paymentSettings.credential(
    purchase.credentialId,
    purchase.keyId,
  );
  let response;
  try {
    response = await fetch(`https://api.razorpay.com/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new AppError(
      503,
      "Payment service is taking longer than expected. Check the payment status before paying again.",
    );
  }
  if (!response.ok)
    throw new AppError(
      502,
      "Razorpay could not confirm this request. Please retry the payment status check.",
    );
  return response.json();
}
export const razorpay = {
  createOrder: (receipt, p) =>
    request("/orders", p, {
      amount: p.amount,
      currency: p.currency,
      receipt,
      partial_payment: false,
    }),
  orderPayments: (orderId, p) =>
    request(`/orders/${encodeURIComponent(orderId)}/payments`, p),
  order: (orderId, p) => request(`/orders/${encodeURIComponent(orderId)}`, p),
  payment: (paymentId, p) =>
    request(`/payments/${encodeURIComponent(paymentId)}`, p),
  capture: (paymentId, p) =>
    request(`/payments/${encodeURIComponent(paymentId)}/capture`, p, {
      amount: p.amount,
      currency: p.currency,
    }),
};
