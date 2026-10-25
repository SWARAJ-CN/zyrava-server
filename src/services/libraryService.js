import mongoose from "mongoose";
import { LikedSong } from "../models/LikedSong.js";
import { Playlist } from "../models/Playlist.js";
import { AppError } from "../utils/http.js";
import {
  MAX_LIKED,
  MAX_PLAYLISTS,
  MAX_SONGS_PER_PLAYLIST
} from "../validators/library.js";

const NOT_FOUND = "That playlist is not in your library.";

/** Newest first; `_id` breaks ties in the order the rows were written. */
const RECENT = { createdAt: -1, _id: -1 };

const duplicate = (error) => error?.code === 11000;

/** Subdocuments can leave optional fields unset — answer with the app's shape. */
export function toSong(song) {
  return {
    id: song.id,
    title: song.title,
    artist: song.artist ?? "",
    album: song.album ?? "",
    year: song.year ?? "",
    language: song.language ?? "",
    duration: song.duration ?? 0,
    image: song.image ?? "",
    imageLarge: song.imageLarge ?? "",
    streamUrl: song.streamUrl ?? "",
    pageUrl: song.pageUrl ?? "",
  };
}

function toPlaylist(playlist) {
  return {
    key: playlist.key,
    name: playlist.name,
    songs: (playlist.songs ?? []).map(toSong),
    createdAt: playlist.createdAt,
  };
}

export async function readLibrary(userId) {
  const [liked, playlists] = await Promise.all([
    LikedSong.find({ user: userId }).sort(RECENT).lean(),
    Playlist.find({ user: userId }).sort(RECENT).lean(),
  ]);

  return {
    liked: liked.map((row) => toSong(row.song)),
    playlists: playlists.map(toPlaylist),
  };
}

/**
 * Saves tracks by id, so sending one that is already liked refreshes its
 * snapshot instead of duplicating it. The app sends oldest-first when it lifts
 * a device's whole library, which keeps this order on read.
 */
export async function addLikes(userId, songs) {
  const keys = [...new Set(songs.map((song) => song.id))];
  // The connection sanitizes filters, so an operator here is declared trusted.
  const known = await LikedSong.find({ user: userId, songId: mongoose.trusted({ $in: keys }) })
    .select("songId")
    .lean();
  const seen = new Set(known.map((row) => row.songId));
  const incoming = keys.filter((id) => !seen.has(id)).length;

  const held = await LikedSong.countDocuments({ user: userId });
  if (held + incoming > MAX_LIKED) throw new AppError(409, "Liked songs has reached its limit.");

  await LikedSong.bulkWrite(
    songs.map((song) => ({
      updateOne: {
        filter: { user: userId, songId: song.id },
        update: { $set: { song } },
        upsert: true,
      },
    }))
  );

  return songs.map(toSong);
}

export async function removeLike(userId, songId) {
  await LikedSong.deleteOne({ user: userId, songId });
}

/**
 * Creates a list, or returns the one a retried request already made — the key
 * comes from the app, so its optimistic tile and this row are the same list.
 */
export async function createPlaylist(userId, key, name) {
  const held = await Playlist.countDocuments({ user: userId });
  if (held >= MAX_PLAYLISTS) throw new AppError(409, "That is enough playlists for now.");

  try {
    const created = await Playlist.create({
      user: userId,
      key,
      name,
      nameLower: name.toLowerCase(),
    });
    return toPlaylist(created);
  } catch (error) {
    if (!duplicate(error)) throw error;
  }

  const existing = await Playlist.findOne({ user: userId, key }).lean();
  if (existing) return toPlaylist(existing);
  throw new AppError(409, "You already have a playlist with that name.");
}

export async function deletePlaylist(userId, key) {
  const removed = await Playlist.deleteOne({ user: userId, key });
  if (!removed.deletedCount) throw new AppError(404, NOT_FOUND);
}

/** Appends in the order given, skipping whatever the list already holds. */
export async function addSongs(userId, key, songs) {
  const playlist = await Playlist.findOne({ user: userId, key });
  if (!playlist) throw new AppError(404, NOT_FOUND);

  const held = new Set(playlist.songs.map((entry) => entry.id));
  const fresh = songs.filter((song) => !held.has(song.id));
  if (!fresh.length) return toPlaylist(playlist);

  if (playlist.songs.length + fresh.length > MAX_SONGS_PER_PLAYLIST) {
    throw new AppError(409, "That playlist is full — start another one.");
  }

  playlist.songs.push(...fresh);
  await playlist.save();
  return toPlaylist(playlist);
}

export async function removeSong(userId, key, songId) {
  const updated = await Playlist.findOneAndUpdate(
    { user: userId, key },
    { $pull: { songs: { id: songId } } },
    { new: true }
  ).lean();

  if (!updated) throw new AppError(404, NOT_FOUND);
  return toPlaylist(updated);
}
