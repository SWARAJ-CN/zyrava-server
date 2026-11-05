import { Router } from "express";
import { asyncHandler } from "../lib/async.js";
import { getAudience } from "../services/audienceService.js";

export const audienceRoutes = Router();

audienceRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await getAudience(req.query.range));
  })
);
