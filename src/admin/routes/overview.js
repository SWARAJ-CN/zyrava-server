import { Router } from "express";
import { asyncHandler } from "../lib/async.js";
import { getOverview } from "../services/overviewService.js";

export const overviewRoutes = Router();

overviewRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await getOverview(req.query.range));
  })
);
