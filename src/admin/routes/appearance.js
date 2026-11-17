import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../lib/async.js";
import { validate } from "../../middleware/validate.js";
import {
  readAppearance,
  updateAppearance,
} from "../../services/appearanceService.js";

export const appearanceAdminRoutes = Router();
// The parent admin router enforces administrator authentication for both verbs.
appearanceAdminRoutes.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
appearanceAdminRoutes.get(
  "/",
  asyncHandler(async (req, res) => res.json(await readAppearance())),
);
appearanceAdminRoutes.post(
  "/",
  validate(
    z.object({
      body: z.object({ vimithaThemeEnabled: z.boolean() }).strict(),
      params: z.object({}).strict(),
      query: z.object({}).strict(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.json(
      await updateAppearance(
        req.valid.body.vimithaThemeEnabled,
        req.admin.email,
      ),
    );
  }),
);
