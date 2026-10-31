import { asyncHandler } from "../utils/http.js";
import * as visitService from "../services/visitService.js";

/**
 * Answer first, store after: the click being recorded is a visitor's first
 * moment on the site, and no part of it should wait on MongoDB. A write that
 * fails is a lost row, not an error the visitor ever sees.
 */
export const capture = asyncHandler(async (req, res) => {
  const { clientId, path, referrer } = req.valid.body;
  res.status(204).end();

  visitService.recordVisit(req, { clientId, path, referrer }).catch((error) => {
    console.error("[zyrava] visit not recorded:", error?.message ?? error);
  });
});
