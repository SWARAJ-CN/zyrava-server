import { Router } from "express";
import { asyncHandler } from "../lib/async.js";
import { requireDeleteEnabled } from "../lib/guards.js";
import * as usersService from "../services/usersService.js";

export const usersRoutes = Router();

usersRoutes.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(
      await usersService.listUsers({
        page: req.query.page,
        limit: req.query.limit,
        q: req.query.q,
        sort: req.query.sort,
        type: req.query.type,
      })
    );
  })
);

usersRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await usersService.getUser(req.params.id));
  })
);

usersRoutes.delete(
  "/:id/sessions",
  requireDeleteEnabled,
  asyncHandler(async (req, res) => {
    res.json(await usersService.revokeUserSessions(req.params.id, req.body?.confirm));
  })
);

usersRoutes.delete(
  "/:id",
  requireDeleteEnabled,
  asyncHandler(async (req, res) => {
    res.json(await usersService.deleteUser(req.params.id, req.body?.confirm));
  })
);
