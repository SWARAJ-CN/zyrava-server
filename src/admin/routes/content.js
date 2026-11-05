import { Router } from "express";
import { asyncHandler } from "../lib/async.js";
import { getContent } from "../services/contentService.js";

export const contentRoutes = Router();

contentRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await getContent(req.query.range));
  })
);
