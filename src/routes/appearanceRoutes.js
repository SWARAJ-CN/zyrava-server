import { Router } from "express";
import { asyncHandler } from "../utils/http.js";
import { readAppearance } from "../services/appearanceService.js";

export const appearanceRoutes = Router();
// Available before sign-in so a remembered personal loading/login screen can
// respect the administrator's switch. No account/contact/audit data is public.
appearanceRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    res.set("Cache-Control", "no-store");
    const { vimithaThemeEnabled } = await readAppearance();
    res.json({ vimithaThemeEnabled });
  }),
);
