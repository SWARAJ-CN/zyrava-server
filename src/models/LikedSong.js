import mongoose from "mongoose";
import { songSnapshot } from "./songSnapshot.js";

/**
 * One row per liked track, per account. The unique index is what keeps a
 * double-tap (or a replayed request) from storing a song twice.
 */
const likedSongSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    /** The catalogue id, not this document's own. */
    songId: { type: String, required: true, maxlength: 64 },
    song: { type: songSnapshot, required: true },
  },
  { timestamps: true }
);

likedSongSchema.index({ user: 1, songId: 1 }, { unique: true });

export const LikedSong = mongoose.model("LikedSong", likedSongSchema, "liked_songs");
