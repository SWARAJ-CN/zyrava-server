import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { requireAuth } from "../middleware/auth.js";
import { verifyCsrf } from "../middleware/csrf.js";
import { validate } from "../middleware/validate.js";
import { asyncHandler, AppError } from "../utils/http.js";
import { assertCommunityUser } from "../services/accountExperience.js";
import { authorizeConversation } from "../services/communityService.js";
import * as media from "../services/mediaService.js";
const id = z.string().regex(/^[a-f\d]{24}$/i);
const envelope = body => z.object({ body, query: z.object({}).strict(), params: z.object({}).strict() });
export const uploadSchema = envelope(z.object({ purpose: z.enum(["chat", "avatar"]), kind: z.enum(["image", "video", "audio"]),
  conversation: id.optional(), name: z.string().trim().min(1).max(120), size: z.number().int().positive().max(100 * 1000 ** 2),
}).strict().refine(v => v.purpose === "avatar" ? v.kind === "image" && !v.conversation : !!v.conversation, "Choose a conversation or profile photo."));
const reference = envelope(z.object({ uploadId: id }).strict());
export const mediaRoutes = Router();
mediaRoutes.use(requireAuth, verifyCsrf);
mediaRoutes.use(rateLimit({ windowMs: 60000, limit: 30, keyGenerator: req => req.userId, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many uploads. Please wait a minute." } }));
mediaRoutes.post("/sign", validate(uploadSchema), asyncHandler(async(req,res) => {
  if (req.valid.body.purpose === "chat") {
    await assertCommunityUser(req.userId);
    await authorizeConversation(req.userId, req.valid.body.conversation);
  }
  res.json(await media.beginUpload(req.userId, req.valid.body));
}));
mediaRoutes.post("/complete", validate(reference), asyncHandler(async(req,res) => {
  const row = await media.ownedUpload(req.userId, req.valid.body.uploadId);
  if (row.purpose === "chat") {
    await assertCommunityUser(req.userId);
    await authorizeConversation(req.userId, row.conversation);
  }
  if (row.usedBy) throw new AppError(409, "This upload has already been used.");
  res.json({ attachment: await media.finishUpload(req.userId, row._id) });
}));
mediaRoutes.post("/discard", validate(reference), asyncHandler(async(req,res) => {
  await media.discardUpload(req.userId, req.valid.body.uploadId); res.json({ ok: true });
}));
