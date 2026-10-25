import mongoose from "mongoose";

/**
 * A catalogue track exactly as the listener saved it.
 *
 * The stream URL is a plain JioSaavn CDN path (no signed expiry), so a stored
 * snapshot stays playable across sessions; the song id is kept as the identity
 * the catalogue and the UI both agree on.
 */
export const songSnapshot = new mongoose.Schema(
  {
    id: { type: String, required: true, maxlength: 64 },
    title: { type: String, required: true, maxlength: 300 },
    artist: { type: String, maxlength: 300 },
    album: { type: String, maxlength: 300 },
    year: { type: String, maxlength: 16 },
    language: { type: String, maxlength: 40 },
    /** Seconds. */
    duration: { type: Number, default: 0 },
    image: { type: String, maxlength: 500 },
    imageLarge: { type: String, maxlength: 500 },
    streamUrl: { type: String, maxlength: 1000 },
    pageUrl: { type: String, maxlength: 500 },
  },
  { _id: false }
);
