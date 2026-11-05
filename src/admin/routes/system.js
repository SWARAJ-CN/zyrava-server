import { Router } from "express";
import { asyncHandler } from "../lib/async.js";
import { getSystem } from "../services/systemService.js";

export const systemRoutes = Router();

systemRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await getSystem());
  })
);
