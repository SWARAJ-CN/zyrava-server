import { Router } from "express";
import { asyncHandler } from "../lib/async.js";
import { requireDeleteEnabled } from "../lib/guards.js";
import * as sessionsService from "../services/sessionsService.js";

export const sessionsRoutes = Router();

sessionsRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(
      await sessionsService.listSessions({
        page: req.query.page,
        limit: req.query.limit,
        q: req.query.q,
        active: req.query.active,
      })
    );
  })
);

sessionsRoutes.delete(
  "/:id",
  requireDeleteEnabled,
  asyncHandler(async (req, res) => {
    res.json(await sessionsService.deleteSession(req.params.id, req.body?.confirm));
  })
);
