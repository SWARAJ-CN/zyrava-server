import mongoose from "mongoose";
import { HistoryEvent } from "../models/historyEvent.js";
import { KnownSong } from "../models/knownSong.js";
import { toSong } from "./libraryService.js";
import {
  MAX_ARTISTS,
  MAX_EVENT_AGE_DAYS,
  MAX_EVENTS_KEPT,
  MAX_FUTURE_SKEW_MINUTES,
  MAX_HEARD,
  MAX_LANGUAGES,
  MAX_PLAYABLE,
  MAX_QUERIES,
  MAX_SONGS_KEPT,
} from "../validators/history.js";

const MS_MINUTE = 60 * 1000;
const MS_DAY = 24 * 60 * MS_MINUTE;
const WEEK_MS = 7 * MS_DAY;

/** Kinds that count as a listen; a skip is its own column and weights carry the rest. */
const PLAYED = ["play", "complete", "deep", "like", "save", "playlist_add"];

const duplicate = (error) => error?.code === 11000;

/** Only rows that mention a track score; a search never does. */
const HAS_SONG = { songId: { $ne: null } };

/**
 * A listen is worth half as much for every week it ages. The shape needs no
 * JS: `$$NOW` and the stored stamp are both in the document.
 */
const DECAY = {
  $multiply: [
    { $ifNull: ["$w", 1] },
    {
      $pow: [
        0.5,
        { $max: [0, { $floor: { $divide: [{ $subtract: ["$$NOW", "$at"] }, WEEK_MS] } }] },
      ],
    },
  ],
};

const snapshotJoin = (uid) => ({
  $lookup: {
    from: KnownSong.collection.name,
    let: { sid: "$sid" },
    pipeline: [
      { $match: { user: uid, $expr: { $eq: ["$songId", "$$sid"] } } },
      { $project: { song: 1 } },
    ],
    as: "hit",
  },
});

/** Client clocks lie, so nothing lands outside the window the app can mean. */
function clampAt(at, floor, ceiling, now) {
  const stamp = at.getTime();
  if (!Number.isFinite(stamp)) return new Date(now);
  if (stamp < floor.getTime()) return floor;
  if (stamp > ceiling.getTime()) return ceiling;
  return at;
}

/**
 * Stores a batch of behaviour. Repeats are free — the app retries a batch it
 * cannot see land, and the key it generated the first time says it is the same
 * listen. Nothing here refuses a row: the store trims its own oldest instead.
 */
export async function ingest(userId, { events, songs }) {
  const now = Date.now();
  const floor = new Date(now - MAX_EVENT_AGE_DAYS * MS_DAY);
  const ceiling = new Date(now + MAX_FUTURE_SKEW_MINUTES * MS_MINUTE);

  // A batch that repeats a key keeps its last row, so one send cannot store twice.
  const batch = new Map();
  for (const { eid, kind, songId, q, w, pct, at } of events) {
    batch.set(eid, {
      kind,
      songId: songId ?? null,
      q: q ?? null,
      w,
      pct: pct ?? null,
      at: clampAt(at, floor, ceiling, now),
    });
  }

  const keys = [...batch.keys()];
  const stored = await HistoryEvent.find({
    user: userId,
    eid: mongoose.trusted({ $in: keys }),
  })
    .select("eid")
    .lean();
  const held = new Set(stored.map((row) => row.eid));
  const fresh = keys.filter((eid) => !held.has(eid));

  // Repeats inside the batch and keys the log already has both count as duplicates.
  let duplicates = events.length - fresh.length;
  let rejected = 0;
  let accepted = 0;

  if (fresh.length) {
    // Unordered, so one row the server dislikes cannot block the rest of the session.
    const written = await HistoryEvent.bulkWrite(
      fresh.map((eid) => ({
        updateOne: {
          filter: { user: userId, eid },
          update: { $set: batch.get(eid) },
          upsert: true,
        },
      })),
      { ordered: false }
    );
    for (const error of written.writeErrors ?? []) {
      if (duplicate(error)) duplicates += 1;
      else rejected += 1;
    }
    accepted = written.upsertedCount + written.modifiedCount;
  }

  await rememberSongs(userId, songs, now);
  await trim(userId);

  return { accepted, duplicates, rejected };
}

/**
 * Tracks the events named, so a log entry still resolves to a playable track
 * long after the app forgot where it found it. A repeat refreshes the snapshot
 * and moves the last-seen mark forward, never the first.
 */
async function rememberSongs(userId, songs, now) {
  const fresh = new Map();
  for (const { songId, song } of songs) fresh.set(songId, song);
  if (!fresh.size) return;

  const at = new Date(now);
  try {
    await KnownSong.bulkWrite(
      [...fresh].map(([songId, song]) => ({
        updateOne: {
          filter: { user: userId, songId },
          update: {
            $set: { song },
            $setOnInsert: { firstSeenAt: at },
            $max: { lastSeenAt: at },
            $inc: { seenCount: 1 },
          },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  } catch (error) {
    // A concurrent batch can win the same row with the same snapshot.
    const errors = error?.writeErrors?.length ? error.writeErrors : [error];
    if (!errors.every(duplicate)) throw error;
  }
}

/** Past the cap the oldest rows go — the store never refuses the next event. */
async function trim(userId) {
  await Promise.all([
    dropOldest(HistoryEvent, userId, MAX_EVENTS_KEPT, { at: 1, _id: 1 }),
    dropOldest(KnownSong, userId, MAX_SONGS_KEPT, { lastSeenAt: 1, _id: 1 }),
  ]);
}

async function dropOldest(Model, userId, cap, oldestFirst) {
  const held = await Model.countDocuments({ user: userId });
  if (held <= cap) return;

  const stale = await Model.find({ user: userId })
    .sort(oldestFirst)
    .limit(held - cap)
    .select("_id")
    .lean();
  if (!stale.length) return;

  await Model.deleteMany({
    user: userId,
    _id: mongoose.trusted({ $in: stale.map((row) => row._id) }),
  });
}

/**
 * The log, read back as the facts a taste model needs — scores weighted by how
 * recent they were, nothing interpreted. The app owns what a mood is.
 */
export async function readTaste(userId) {
  const uid = new mongoose.Types.ObjectId(userId);

  const [scored, byAttribute, total, oldest, searched] = await Promise.all([
    // Per track: the shape the app reads, joined to the snapshot that makes it playable.
    HistoryEvent.aggregate([
      { $match: { user: uid, ...HAS_SONG } },
      { $addFields: { decay: DECAY } },
      {
        $group: {
          _id: "$songId",
          plays: { $sum: { $cond: [{ $in: ["$kind", PLAYED] }, 1, 0] } },
          skips: { $sum: { $cond: [{ $eq: ["$kind", "skip"] }, 1, 0] } },
          score: { $sum: "$decay" },
          last: { $max: "$at" },
        },
      },
      { $sort: { score: -1, last: -1 } },
      { $limit: MAX_HEARD },
      { $addFields: { sid: "$_id" } },
      snapshotJoin(uid),
      {
        $project: {
          _id: 0,
          sid: "$_id",
          plays: 1,
          skips: 1,
          last: 1,
          score: { $round: ["$score", 3] },
          song: { $arrayElemAt: ["$hit.song", 0] },
        },
      },
    ]),

    // Per credit: the same weights, grouped by what the cached catalogue says.
    HistoryEvent.aggregate([
      { $match: { user: uid, ...HAS_SONG } },
      { $addFields: { decay: DECAY, sid: "$songId" } },
      snapshotJoin(uid),
      { $unwind: "$hit" },
      {
        $facet: {
          artists: [
            { $group: { _id: "$hit.song.artist", score: { $sum: "$decay" } } },
            { $match: { _id: { $gt: "" } } },
            { $sort: { score: -1 } },
            { $limit: MAX_ARTISTS },
            { $project: { _id: 0, name: "$_id", score: { $round: ["$score", 2] } } },
          ],
          languages: [
            { $group: { _id: "$hit.song.language", score: { $sum: "$decay" } } },
            { $match: { _id: { $gt: "" } } },
            { $sort: { score: -1 } },
            { $limit: MAX_LANGUAGES },
            { $project: { _id: 0, name: "$_id", score: { $round: ["$score", 2] } } },
          ],
        },
      },
    ]),

    HistoryEvent.countDocuments({ user: userId }),
    HistoryEvent.findOne({ user: userId }).sort({ at: 1 }).select("at").lean(),
    HistoryEvent.find({ user: userId, q: mongoose.trusted({ $ne: null }) })
      .sort({ at: -1 })
      .limit(MAX_QUERIES)
      .select("q at")
      .lean(),
  ]);

  return {
    events: total,
    since: oldest?.at ?? null,
    songs: scored
      .filter((row) => row.song)
      .slice(0, MAX_PLAYABLE)
      .map((row) => toSong(row.song)),
    heard: scored.map(({ sid, plays, skips, score, last }) => ({
      sid,
      plays,
      skips,
      score,
      last,
    })),
    artists: byAttribute[0]?.artists ?? [],
    languages: byAttribute[0]?.languages ?? [],
    queries: searched.map((row) => ({ q: row.q, at: row.at })),
  };
}

/** Starts over: the log and the cached catalogue both go, the account stays. */
export async function clearAll(userId) {
  const [events, songs] = await Promise.all([
    HistoryEvent.deleteMany({ user: userId }),
    KnownSong.deleteMany({ user: userId }),
  ]);

  return { removed: { events: events.deletedCount, songs: songs.deletedCount } };
}
