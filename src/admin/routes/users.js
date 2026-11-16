import { z } from "zod";
import { validate } from "../../middleware/validate.js";
import { readPaymentHistory } from "../../services/paymentHistoryService.js";
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
      }),
    );
  }),
);

usersRoutes.get(
  "/:id",
  asyncHandler(async (req, res) => {
    res.json(await usersService.getUser(req.params.id));
  }),
);

usersRoutes.delete(
  "/:id/sessions",
  requireDeleteEnabled,
  asyncHandler(async (req, res) => {
    res.json(
      await usersService.revokeUserSessions(req.params.id, req.body?.confirm),
    );
  }),
);

usersRoutes.delete(
  "/:id",
  requireDeleteEnabled,
  asyncHandler(async (req, res) => {
    res.json(await usersService.deleteUser(req.params.id, req.body?.confirm));
  }),
);

usersRoutes.get(
  "/:id/payments",
  validate(
    z.object({
      body: z.unknown(),
      params: z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i) }).strict(),
      query: z
        .object({
          page: z.coerce.number().int().min(1).max(100000).default(1),
          limit: z.coerce.number().int().min(1).max(50).default(10),
        })
        .strict(),
    }),
  ),
  asyncHandler(async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json(await readPaymentHistory(req.valid.params.id, req.valid.query));
  }),
);
