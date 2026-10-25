import { asyncHandler } from "../utils/http.js";
import * as libraryService from "../services/libraryService.js";

/**
 * Every handler is scoped to `req.userId`, taken from the verified access
 * token — an account can only ever read or write its own library.
 */
export const read = asyncHandler(async (req, res) => {
  res.json(await libraryService.readLibrary(req.userId));
});

/** Saving a track that is already saved changes nothing, so retries are free. */
export const like = asyncHandler(async (req, res) => {
  const saved = await libraryService.addLikes(req.userId, req.valid.body.songs);
  res.json({ songs: saved });
});

export const unlike = asyncHandler(async (req, res) => {
  await libraryService.removeLike(req.userId, req.valid.body.songId);
  res.status(204).end();
});

export const createPlaylist = asyncHandler(async (req, res) => {
  const { key, name } = req.valid.body;
  res.status(201).json({ playlist: await libraryService.createPlaylist(req.userId, key, name) });
});

export const deletePlaylist = asyncHandler(async (req, res) => {
  await libraryService.deletePlaylist(req.userId, req.valid.body.key);
  res.status(204).end();
});

export const addSongs = asyncHandler(async (req, res) => {
  const { key, songs } = req.valid.body;
  res.json({ playlist: await libraryService.addSongs(req.userId, key, songs) });
});

export const removeSong = asyncHandler(async (req, res) => {
  const { key, songId } = req.valid.body;
  res.json({ playlist: await libraryService.removeSong(req.userId, key, songId) });
});
