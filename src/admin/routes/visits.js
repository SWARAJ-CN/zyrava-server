import { Router } from "express";
import { asyncHandler } from "../lib/async.js";
import * as visitsService from "../services/visitsService.js";

export const visitsRoutes = Router();

visitsRoutes.get(
  "/meta",
  asyncHandler(async (req, res) => {
    res.json(await visitsService.getVisitMeta());
  })
);

visitsRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(
      await visitsService.listVisits({
        page: req.query.page,
        limit: req.query.limit,
        q: req.query.q,
        source: req.query.source,
        country: req.query.country,
        range: req.query.range,
      })
    );
  })
);
