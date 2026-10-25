import { asyncHandler } from "../utils/http.js";
import * as historyService from "../services/historyService.js";

/**
 * Both handlers work on `req.userId` alone, so one account can never read or
 * write another's history — the same rule the library follows.
 */
export const ingest = asyncHandler(async (req, res) => {
  const { events, songs } = req.valid.body;
  res.json(await historyService.ingest(req.userId, { events, songs }));
});

/** The whole log as a profile: the app sends nothing to narrow it. */
export const state = asyncHandler(async (req, res) => {
  res.json(await historyService.readTaste(req.userId));
});

export const clear = asyncHandler(async (req, res) => {
  res.json(await historyService.clearAll(req.userId));
});
