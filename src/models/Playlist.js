import mongoose from "mongoose";
import { songSnapshot } from "./songSnapshot.js";

/**
 * A playlist the listener made. `key` is the id the app generated when it
 * created the list, so a song can be added the instant the tile appears
 * without waiting for a round trip; it is unique per account, never global.
 */
const playlistSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    key: { type: String, required: true, maxlength: 64 },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    /** Compared case-insensitively, the way the app names lists. */
    nameLower: { type: String, required: true, lowercase: true, trim: true },
    /** In the order the listener put them — play order. */
    songs: { type: [songSnapshot], default: [] },
  },
  { timestamps: true }
);

playlistSchema.index({ user: 1, key: 1 }, { unique: true });
playlistSchema.index({ user: 1, nameLower: 1 }, { unique: true });

export const Playlist = mongoose.model("Playlist", playlistSchema);
