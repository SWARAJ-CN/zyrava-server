import mongoose from "mongoose";
import { database } from "../../config/db.js";
import { AppError } from "../../utils/http.js";

/** Collection names exactly as declared by the server's own models. */
export const COLLECTIONS = Object.freeze({
  users: "users",
  sessions: "sessions",
  visits: "visits",
  likedSongs: "liked_songs",
  playlists: "playlists",
  historyEvents: "history_events",
  knownSongs: "known_songs",
});

export const users = () => database().collection(COLLECTIONS.users);
export const sessions = () => database().collection(COLLECTIONS.sessions);
export const visits = () => database().collection(COLLECTIONS.visits);
export const likedSongs = () => database().collection(COLLECTIONS.likedSongs);
export const playlists = () => database().collection(COLLECTIONS.playlists);
export const historyEvents = () => database().collection(COLLECTIONS.historyEvents);
export const knownSongs = () => database().collection(COLLECTIONS.knownSongs);

const ID_PATTERN = /^[a-f\d]{24}$/i;

export function toObjectId(value, label = "id") {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new AppError(400, `That ${label} is not valid.`);
  }
  return new mongoose.Types.ObjectId(value);
}

/** Raw user document, without the credential hash. */
export const PUBLIC_USER_PROJECTION = Object.freeze({
  passwordHash: 0,
  __v: 0,
});

export function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
