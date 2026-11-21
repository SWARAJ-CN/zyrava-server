import { z } from "zod";
import { fileURLToPath } from "node:url";
import { User } from "../../models/User.js";
import { sendEmail } from "../../services/emailService.js";
import { AppError } from "../../utils/http.js";

export const userEmailBody = z.object({
  template: z.enum(["callback", "rare", "funny", "spam", "custom"]),
  subject: z.string().trim().min(1).max(160).refine(value => !/[\r\n]/.test(value), "Use a single-line subject."),
  message: z.string().trim().min(1).max(5000),
}).strict();

async function recipient(id) {
  const user = await User.findById(id).select("name email").lean();
  if (!user) throw new AppError(404, "That account no longer exists.");
  if (!z.string().email().safeParse(user.email).success) throw new AppError(422, "This account has no email address. Phone-only users cannot receive email.");
  return user;
}

export function emailTemplates(name) {
  const greeting = `Hi ${String(name || "there").replace(/[\r\n]/g, " ").slice(0, 80)},`;
  const ending = "\n\nWith love,\nTeam ZYRAVA";
  return [
    { id: "callback", label: "Call back user", subject: "Your next favourite song is waiting", message: `${greeting}\n\nReady for another listen? Come back to ZYRAVA, pick a favourite, and make a little time for yourself. We'd love to have you listening with us again.${ending}` },
    { id: "rare", label: "Rare activity", subject: "A little music for your day", message: `${greeting}\n\nLife gets busy. Whenever you have a quiet moment, ZYRAVA is here for a song, a short break, or a playlist that feels like you. Drop in whenever you're ready.${ending}` },
    { id: "funny", label: "Just a funny mail", subject: "Your headphones called. They miss you.", message: `${greeting}\n\nYour headphones have filed a very serious complaint: not enough good music!\n\nThe recommended treatment? One favourite song, a tiny kitchen dance, and absolutely no judgement from us. See you on ZYRAVA.${ending}` },
    { id: "spam", label: "Spam report", subject: "Help with ZYRAVA emails", message: `${greeting}\n\nIf a ZYRAVA email has landed in Spam or Junk, please check that it is an email you expected. For a legitimate ZYRAVA message, you can choose “Not spam” to help your inbox recognise it.\n\nNever share a sign-in code or password. If you did not request a verification email, you can safely ignore it.${ending}` },
  ];
}

export async function getUserEmailTemplates(id) {
  const user = await recipient(id);
  return { recipient: { name: user.name || "Listener", email: user.email }, templates: emailTemplates(user.name) };
}

const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export function adminEmailMessage(subject, message) {
  return {
    subject,
    text: `${message}\n\nZYRAVA · Your songs. Your little world.`,
    html: `<!doctype html><html><body style="margin:0;background:#f3f6f5;font-family:Arial,Helvetica,sans-serif;color:#15241e"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="520" style="width:100%;max-width:520px;background:white;border:1px solid #e2ebe6;border-radius:20px"><tr><td style="padding:32px"><img src="cid:zyrava-logo" width="48" height="48" alt="ZYRAVA" style="border-radius:12px"><p style="font-size:12px;font-weight:bold;letter-spacing:4px">ZYRAVA</p><h1 style="font-size:24px;line-height:1.3">${escapeHtml(subject)}</h1><div style="font-size:15px;line-height:1.8;overflow-wrap:anywhere">${escapeHtml(message).replace(/\r?\n/g, "<br>")}</div><hr style="border:0;border-top:1px solid #e2ebe6;margin:28px 0"><p style="font-size:12px;color:#53675c">Your songs. Your little world.</p></td></tr></table></td></tr></table></body></html>`,
    attachments: [{ filename: "zyrava.png", path: fileURLToPath(new URL("../../assets/email-logo.png", import.meta.url)), cid: "zyrava-logo" }],
  };
}

export async function sendUserEmail(id, draft) {
  // Resolve the recipient from the account on every send; never accept a 'to' field.
  const user = await recipient(id);
  await sendEmail(user.email, adminEmailMessage(draft.subject, draft.message));
  return { accepted: true, message: "Email accepted by the mail provider. Inbox delivery may take a moment." };
}
