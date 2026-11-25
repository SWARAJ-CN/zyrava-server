import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { verifyCsrf } from "../middleware/csrf.js";
import { validate } from "../middleware/validate.js";
import { chatRequestLimiter } from "../middleware/rateLimit.js";
import { asyncHandler, AppError } from "../utils/http.js";
import { User } from "../models/User.js";
import { MediaUpload } from "../models/MediaUpload.js";
import { claimUpload } from "../services/mediaService.js";
import { findUser } from "../services/authService.js";
const schema = z.object({ body: z.object({ uploadId: z.string().regex(/^[a-f\d]{24}$/i).nullable() }).strict(), query: z.object({}).strict(), params: z.object({}).strict() });
export const profileRoutes = Router();
profileRoutes.post("/avatar", requireAuth, verifyCsrf, chatRequestLimiter, validate(schema), asyncHandler(async(req,res) => {
  const { uploadId } = req.valid.body;
  if (uploadId && (await User.findById(req.userId).select("avatar").lean())?.avatar?.id === uploadId) {
    res.json({ user: await findUser(req.userId) }); return;
  }
  const upload = uploadId ? await claimUpload(req.userId, uploadId, "avatar", req.userId) : null;
  let previous;
  try {
    previous = await User.findByIdAndUpdate(req.userId, { $set: { avatar: upload?.attachment ?? null } });
    if (!previous) throw new AppError(404, "Account not found.");
  } catch(error) {
    if (upload) await MediaUpload.updateOne({ _id: upload._id, usedBy: upload.usedBy }, { $set: { usedBy: null } });
    throw error;
  }
  if (previous.avatar?.id) await MediaUpload.updateOne({ _id: previous.avatar.id, owner: req.userId }, { $set: { usedBy: null, expiresAt: new Date() } });
  res.json({ user: await findUser(req.userId) });
}));
