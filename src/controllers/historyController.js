import { asyncHandler } from "../utils/http.js";
import * as historyService from "../services/historyService.js";
import { emitToUser } from "../realtime/rooms.js";

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
  const result = await historyService.clearAll(req.userId);
  // The recommendations built on this log just went stale on every live tab.
  emitToUser(req.userId, "history:changed", { at: new Date().toISOString() });
  res.json(result);
});
