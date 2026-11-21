import { Router } from "express";
import { asyncHandler } from "../lib/async.js";
import { getSystem } from "../services/systemService.js";
import { emailDiagnostics } from "../../services/emailDiagnostics.js";

export const systemRoutes = Router();
systemRoutes.get("/email", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(emailDiagnostics());
});

systemRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await getSystem());
  })
);
