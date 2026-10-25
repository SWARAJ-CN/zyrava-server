import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { verifyCsrf } from "../middleware/csrf.js";
import { validate } from "../middleware/validate.js";
import {
  createPlaylistSchema,
  deletePlaylistSchema,
  likesSchema,
  playlistSongsSchema,
  removePlaylistSongSchema,
  unlikeSchema,
} from "../validators/library.js";
import * as libraryController from "../controllers/libraryController.js";

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
