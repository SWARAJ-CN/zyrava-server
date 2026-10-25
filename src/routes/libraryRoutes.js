import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { verifyCsrf } from "../middleware/csrf.js";
import { historyLimiter } from "../middleware/rateLimit.js";
import { validate } from "../middleware/validate.js";
import {
  createPlaylistSchema,
  deletePlaylistSchema,
  likesSchema,
  playlistSongsSchema,
  removePlaylistSongSchema,
  unlikeSchema,
} from "../validators/library.js";
import {
  historyClearSchema,
  historyEventsSchema,
  historyStateSchema,
} from "../validators/history.js";
import * as libraryController from "../controllers/libraryController.js";
import * as historyController from "../controllers/historyController.js";

export const libraryRoutes = Router();

/** Nothing here is public — each handler works on the token's own account. */
libraryRoutes.use(requireAuth);

libraryRoutes.get("/", libraryController.read);

// Writes stay POST-only with the verb in the path: the API's CORS allowlist and
// the SPA client both speak GET/POST, so no preflight widening is needed.
libraryRoutes.post("/likes", verifyCsrf, validate(likesSchema), libraryController.like);
libraryRoutes.post("/unlike", verifyCsrf, validate(unlikeSchema), libraryController.unlike);
libraryRoutes.post(
  "/playlist",
  verifyCsrf,
  validate(createPlaylistSchema),
  libraryController.createPlaylist
);
libraryRoutes.post(
  "/playlist/delete",
  verifyCsrf,
  validate(deletePlaylistSchema),
  libraryController.deletePlaylist
);
libraryRoutes.post(
  "/playlist/songs",
  verifyCsrf,
  validate(playlistSongsSchema),
  libraryController.addSongs
);
libraryRoutes.post(
  "/playlist/song/remove",
  verifyCsrf,
  validate(removePlaylistSongSchema),
  libraryController.removeSong
);

/**
 * What the listener did, kept here so the app can reason about it later. These
 * ride the library router on purpose: the sign-in guard, the CSRF header and
 * the 64 kB body ceiling are all already the right fit for a batch of events.
 */
libraryRoutes.post(
  "/history/events",
  verifyCsrf,
  historyLimiter,
  validate(historyEventsSchema),
  historyController.ingest
);
libraryRoutes.get("/history/state", validate(historyStateSchema), historyController.state);
libraryRoutes.post(
  "/history/clear",
  verifyCsrf,
  validate(historyClearSchema),
  historyController.clear
);
