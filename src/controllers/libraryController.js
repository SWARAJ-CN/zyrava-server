import { asyncHandler } from "../utils/http.js";
import * as libraryService from "../services/libraryService.js";
import { emitToUser } from "../realtime/rooms.js";

/**
 * Every handler is scoped to `req.userId`, taken from the verified access
 * token — an account can only ever read or write its own library.
 *
 * Each write ends with a `library:changed` push to the same account's live
 * tabs, so a second device (or a second window) sees the new like or playlist
 * without refetching on a timer. The client treats the payload as a hint and
 * re-syncs itself; the token only carries what changed.
 */
function notify(userId, reason) {
  emitToUser(userId, "library:changed", { reason, at: new Date().toISOString() });
}
export const read = asyncHandler(async (req, res) => {
  res.json(await libraryService.readLibrary(req.userId));
});

/** Saving a track that is already saved changes nothing, so retries are free. */
export const like = asyncHandler(async (req, res) => {
  const saved = await libraryService.addLikes(req.userId, req.valid.body.songs);
  notify(req.userId, "like");
  res.json({ songs: saved });
});

export const unlike = asyncHandler(async (req, res) => {
  await libraryService.removeLike(req.userId, req.valid.body.songId);
  notify(req.userId, "unlike");
  res.status(204).end();
});

export const createPlaylist = asyncHandler(async (req, res) => {
  const { key, name } = req.valid.body;
  const playlist = await libraryService.createPlaylist(req.userId, key, name);
  notify(req.userId, "playlist:create");
  res.status(201).json({ playlist });
});

export const deletePlaylist = asyncHandler(async (req, res) => {
  await libraryService.deletePlaylist(req.userId, req.valid.body.key);
  notify(req.userId, "playlist:delete");
  res.status(204).end();
});

export const addSongs = asyncHandler(async (req, res) => {
  const { key, songs } = req.valid.body;
  const playlist = await libraryService.addSongs(req.userId, key, songs);
  notify(req.userId, "playlist:songs");
  res.json({ playlist });
});

export const removeSong = asyncHandler(async (req, res) => {
  const { key, songId } = req.valid.body;
  const playlist = await libraryService.removeSong(req.userId, key, songId);
  notify(req.userId, "playlist:song:remove");
  res.json({ playlist });
});
