import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { AdminAuthEmail } from "../models/AdminAuthEmail.js";
import { sendEmail } from "./emailService.js";

const RETENTION = 7 * 24 * 60 * 60_000;

export async function queueAdminAuthEmail(user, event) {
  if (!env.adminAuthEmailsEnabled) return;
  try {
    await AdminAuthEmail.create({
      event, recipient: env.adminNotificationEmail, user: user._id,
      name: user.name, email: user.email, phone: user.phone,
      occurredAt: new Date(), expiresAt: new Date(Date.now() + RETENTION),
    });
  } catch {
    // A notification must never invalidate an already successful sign-in.
    console.warn("[zyrava] could not queue admin sign-in notification");
  }
}

export function adminAuthMessage(job) {
  const subject = job.event === "registration" ? "ZYRAVA · New user joined" : "ZYRAVA · User signed in";
  const text = [
    subject,
    "",
    `Name: ${job.name || "Not provided"}`,
    `Email: ${job.email || "Not provided (phone account)"}`,
    `Phone: ${job.phone || "Not provided"}`,
    `Account ID: ${job.user}`,
    `Time (UTC): ${new Date(job.occurredAt).toISOString()}`,
    "",
    job.event === "registration" ? "The new account completed its first sign-in." : "The user completed sign-in successfully.",
    "This notification contains no passwords, verification codes or session tokens.",
    "Team ZYRAVA",
  ].join("\n");
  return { subject, text };
}

export async function deliverNextAdminAuthEmail() {
  if (!env.adminAuthEmailsEnabled) return;
  const now = new Date();
  // A lease prevents multiple API instances from sending the same queued event.
  const job = await AdminAuthEmail.findOneAndUpdate({
    $or: [
      { status: "pending", nextAttemptAt: mongoose.trusted({ $lte: now }) },
      { status: "sending", leaseUntil: mongoose.trusted({ $lte: now }) },
    ],
    expiresAt: mongoose.trusted({ $gt: now }),
  }, { $set: { status: "sending", leaseUntil: new Date(Date.now() + 120_000), leaseId: randomUUID() }, $inc: { attempts: 1 } }, { new: true, sort: { nextAttemptAt: 1 } });
  if (!job) return;
  const filter = { _id: job._id, status: "sending", leaseId: job.leaseId };
  try {
    await sendEmail(job.recipient, adminAuthMessage(job), { idempotencyKey: `admin-auth-${job._id}` });
    await AdminAuthEmail.updateOne(filter, { $set: { status: "accepted", acceptedAt: new Date() }, $unset: { leaseUntil: 1, leaseId: 1, lastError: 1 } });
  } catch (error) {
    await AdminAuthEmail.updateOne(filter, { $set: {
      status: job.attempts >= 6 ? "failed" : "pending",
      nextAttemptAt: new Date(Date.now() + Math.min(60 * 60_000, 60_000 * 2 ** (job.attempts - 1))),
      lastError: error.mailCode || "delivery_unconfirmed",
    }, $unset: { leaseUntil: 1, leaseId: 1 } });
  }
}

export function startAdminAuthEmailWorker() {
  if (!env.adminAuthEmailsEnabled) return () => {};
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await deliverNextAdminAuthEmail(); }
    catch { console.warn("[zyrava] admin notification worker could not process queue"); }
    finally { running = false; }
  }, 5000);
  timer.unref();
  return () => clearInterval(timer);
}
