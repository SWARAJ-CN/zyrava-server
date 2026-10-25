import mongoose from "mongoose";

/** The behaviours the app reports. Anything else is a bad request, not a row. */
export const EVENT_KINDS = [
  "play",
  "complete",
  "deep",
  "skip",
  "like",
  "unlike",
  "playlist_add",
  "save",
  "search",
];

/**
 * One thing a listener did, kept forever (up to the store's cap) so a taste
 * model computed today can be replayed tomorrow. The app owns the meaning of
 * the weight; this only records the fact and when it happened.
 */
const historyEventSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  /** The idempotency key the app generated: a retried batch stores one row. */
  eid: { type: String, required: true, maxlength: 64 },
  kind: { type: String, required: true, enum: EVENT_KINDS },
  /** The catalogue id, unset for a search. */
  songId: { type: String, maxlength: 64 },
  /** A phrase the listener typed, trimmed — the only text kept. */
  q: { type: String, trim: true, maxlength: 120 },
  /** The weight the app assigned; negative for a skip or an unlike. */
  w: { type: Number, default: 1 },
  /** How far through the track it got, 0..100. */
  pct: { type: Number, min: 0, max: 100 },
  /** On the listener's clock, clamped on the way in. */
  at: { type: Date, required: true },
});

historyEventSchema.index({ user: 1, eid: 1 }, { unique: true });
historyEventSchema.index({ user: 1, at: -1 });
historyEventSchema.index({ user: 1, songId: 1, kind: 1 });

export const HistoryEvent = mongoose.model(
  "HistoryEvent",
  historyEventSchema,
  "history_events"
);
