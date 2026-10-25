import mongoose from "mongoose";
import { songSnapshot } from "./songSnapshot.js";

/**
 * A catalogue track an event mentioned, cached so a log entry from last month
 * still resolves to something playable — event rows stay small, the snapshot
 * lives here once per account.
 */
const knownSongSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  /** The catalogue id, not this document's own. */
  songId: { type: String, required: true, maxlength: 64 },
  song: { type: songSnapshot, required: true },
  firstSeenAt: { type: Date, default: () => new Date() },
  lastSeenAt: { type: Date, default: () => new Date() },
  seenCount: { type: Number, default: 1 },
});

knownSongSchema.index({ user: 1, songId: 1 }, { unique: true });

export const KnownSong = mongoose.model("KnownSong", knownSongSchema, "known_songs");
