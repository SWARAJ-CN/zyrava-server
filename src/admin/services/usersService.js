import {
  escapeRegex,
  historyEvents,
  knownSongs,
  likedSongs,
  playlists,
  PUBLIC_USER_PROJECTION,
  sessions,
  toObjectId,
  users,
} from "../lib/collections.js";
import { AppError } from "../lib/async.js";
import { clearCache } from "../lib/cache.js";
import { lookupIp } from "../lib/geo.js";
import { parseUserAgent } from "../lib/ua.js";

const PLAYED = ["play", "complete", "deep"];
const DAY_MS = 24 * 60 * 60 * 1000;

function countMap(rows) {
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

async function countsByUser(collection, userIds) {
  if (!userIds.length) return new Map();
  const rows = await collection
    .aggregate([
      { $match: { user: { $in: userIds } } },
      { $group: { _id: "$user", count: { $sum: 1 } } },
    ])
    .toArray();
  return countMap(rows);
}

async function latestSessions(userIds) {
  if (!userIds.length) return new Map();
  const now = new Date();
  const rows = await sessions()
    .aggregate([
      { $match: { user: { $in: userIds } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$user",
          ip: { $first: "$ip" },
          userAgent: { $first: "$userAgent" },
          createdAt: { $first: "$createdAt" },
          remember: { $first: "$remember" },
          active: {
            $max: {
              $cond: [{ $gt: ["$expiresAt", now] }, 1, 0],
            },
          },
        },
      },
    ])
    .toArray();
  return new Map(rows.map((row) => [String(row._id), row]));
}

function songSnapshot(song) {
  if (!song) return null;
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

function publicUser(user) {
  return {
    id: String(user._id),
    name: user.name ?? null,
    email: user.email ?? null,
    phone: user.phone ?? null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt ?? null,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

function parseSession(row) {
  const parsed = parseUserAgent(row.userAgent);
  return {
    id: String(row._id),
    ip: row.ip,
    ...lookupIp(row.ip),
    remember: Boolean(row.remember),
    active: row.expiresAt ? new Date(row.expiresAt) > new Date() : false,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    ...parsed,
  };
}

export async function listUsers({ page = 1, limit = 20, q = "", sort = "newest", type = "all" }) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const search = String(q ?? "").trim().slice(0, 80);
  const match = {};

  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    match.$or = [{ name: regex }, { email: regex }, { phone: regex }];
  }

  if (type === "email") match.email = { $ne: null };
  if (type === "phone") match.phone = { $ne: null };

  const sortSpec =
    sort === "oldest"
      ? { createdAt: 1, _id: 1 }
      : sort === "active"
        ? { lastLoginAt: -1, createdAt: -1 }
        : { createdAt: -1, _id: -1 };

  const total = await users().countDocuments(match);
  const pages = Math.max(1, Math.ceil(total / safeLimit));
  const currentPage = Math.min(safePage, pages);
  const rows = await users()
    .find(match, { projection: PUBLIC_USER_PROJECTION })
    .sort(sortSpec)
    .skip((currentPage - 1) * safeLimit)
    .limit(safeLimit)
    .toArray();

  const ids = rows.map((row) => row._id);
  const [likes, playlistsByUser, events, sessionTotals, latest] = await Promise.all([
    countsByUser(likedSongs(), ids),
    countsByUser(playlists(), ids),
    countsByUser(historyEvents(), ids),
    countsByUser(sessions(), ids),
    latestSessions(ids),
  ]);

  const activeRows =
    ids.length === 0
      ? []
      : await sessions()
          .aggregate([
            { $match: { user: { $in: ids }, expiresAt: { $gt: new Date() } } },
            { $group: { _id: "$user", count: { $sum: 1 } } },
          ])
          .toArray();
  const activeMap = countMap(activeRows);

  const items = rows.map((user) => {
    const session = latest.get(String(user._id));
    const location = lookupIp(session?.ip);
    const device = parseUserAgent(session?.userAgent);
    return {
      ...publicUser(user),
      sessionCount: sessionTotals.get(String(user._id)) ?? 0,
      activeSessions: activeMap.get(String(user._id)) ?? 0,
      likedCount: likes.get(String(user._id)) ?? 0,
      playlistCount: playlistsByUser.get(String(user._id)) ?? 0,
      eventCount: events.get(String(user._id)) ?? 0,
      lastIp: location.ip,
      location,
      device: device.device,
      browser: device.browser,
      os: device.os,
      lastSeenAt: session?.createdAt ?? null,
    };
  });

  return { items, total, page: currentPage, pages, limit: safeLimit };
}

export async function getUser(id) {
  const uid = toObjectId(id, "user id");
  const user = await users().findOne({ _id: uid }, { projection: PUBLIC_USER_PROJECTION });
  if (!user) throw new AppError(404, "That account no longer exists.");

  const monthAgo = new Date(Date.now() - 30 * DAY_MS);

  const [
    sessionTotal,
    sessionActive,
    sessionRows,
    likeTotal,
    likeRows,
    playlistTotal,
    playlistRows,
    eventTotal,
    playTotal,
    searchTotal,
    firstEvent,
    lastEvent,
    kindRows,
    topSongRows,
    topArtistRows,
    searchRows,
    recentEventRows,
    knownTotal,
    knownLatest,
    likedOldest,
    eventDays,
  ] = await Promise.all([
    sessions().countDocuments({ user: uid }),
    sessions().countDocuments({ user: uid, expiresAt: { $gt: new Date() } }),
    sessions().find({ user: uid }).sort({ createdAt: -1 }).limit(20).toArray(),
    likedSongs().countDocuments({ user: uid }),
    likedSongs().find({ user: uid }).sort({ createdAt: -1 }).limit(24).toArray(),
    playlists().countDocuments({ user: uid }),
    playlists().find({ user: uid }).sort({ createdAt: -1 }).toArray(),
    historyEvents().countDocuments({ user: uid }),
    historyEvents().countDocuments({ user: uid, kind: { $in: PLAYED } }),
    historyEvents().countDocuments({ user: uid, q: { $ne: null } }),
    historyEvents().findOne({ user: uid }, { sort: { at: 1 }, projection: { at: 1 } }),
    historyEvents().findOne({ user: uid }, { sort: { at: -1 }, projection: { at: 1 } }),
    historyEvents()
      .aggregate([
        { $match: { user: uid } },
        { $group: { _id: "$kind", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .toArray(),
    historyEvents()
      .aggregate([
        { $match: { user: uid, songId: { $ne: null } } },
        {
          $group: {
            _id: "$songId",
            plays: { $sum: { $cond: [{ $in: ["$kind", PLAYED] }, 1, 0] } },
            skips: { $sum: { $cond: [{ $eq: ["$kind", "skip"] }, 1, 0] } },
            events: { $sum: 1 },
            last: { $max: "$at" },
          },
        },
        { $sort: { plays: -1, events: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: "known_songs",
            let: { sid: "$_id" },
            pipeline: [
              { $match: { $expr: { $and: [{ $eq: ["$user", uid] }, { $eq: ["$songId", "$$sid"] }] } } },
              { $limit: 1 },
              { $project: { _id: 0, song: 1 } },
            ],
            as: "hit",
          },
        },
        {
          $project: {
            _id: 0,
            songId: "$_id",
            plays: 1,
            skips: 1,
            events: 1,
            last: 1,
            song: { $arrayElemAt: ["$hit.song", 0] },
          },
        },
      ])
      .toArray(),
    historyEvents()
      .aggregate([
        { $match: { user: uid, songId: { $ne: null } } },
        {
          $lookup: {
            from: "known_songs",
            let: { sid: "$songId" },
            pipeline: [
              { $match: { $expr: { $and: [{ $eq: ["$user", uid] }, { $eq: ["$songId", "$$sid"] }] } } },
              { $limit: 1 },
              { $project: { _id: 0, song: 1 } },
            ],
            as: "hit",
          },
        },
        { $unwind: "$hit" },
        {
          $group: {
            _id: "$hit.song.artist",
            plays: { $sum: { $cond: [{ $in: ["$kind", PLAYED] }, 1, 0] } },
            events: { $sum: 1 },
          },
        },
        { $match: { _id: { $nin: [null, ""] } } },
        { $sort: { plays: -1, events: -1 } },
        { $limit: 8 },
        { $project: { _id: 0, name: "$_id", plays: 1, events: 1 } },
      ])
      .toArray(),
    historyEvents()
      .find({ user: uid, q: { $ne: null } })
      .sort({ at: -1 })
      .limit(12)
      .project({ q: 1, at: 1 })
      .toArray(),
    historyEvents().find({ user: uid }).sort({ at: -1 }).limit(20).toArray(),
    knownSongs().countDocuments({ user: uid }),
    knownSongs().findOne({ user: uid }, { sort: { lastSeenAt: -1 } }),
    likedSongs().findOne({ user: uid }, { sort: { createdAt: 1 }, projection: { createdAt: 1 } }),
    historyEvents()
      .aggregate([
        { $match: { user: uid, at: { $gte: monthAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$at" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
  ]);

  const session = sessionRows[0];
  const location = lookupIp(session?.ip);
  const parsed = parseUserAgent(session?.userAgent);

  const eventSongIds = [...new Set(recentEventRows.map((row) => row.songId).filter(Boolean))];
  const eventSongs =
    eventSongIds.length > 0
      ? await knownSongs().find({ user: uid, songId: { $in: eventSongIds } }).toArray()
      : [];
  const songById = new Map(eventSongs.map((row) => [row.songId, row.song]));

  return {
    user: publicUser(user),
    stats: {
      sessions: sessionTotal,
      activeSessions: sessionActive,
      likes: likeTotal,
      playlists: playlistTotal,
      events: eventTotal,
      plays: playTotal,
      searches: searchTotal,
      knownSongs: knownTotal,
      playlistSongs: playlistRows.reduce((sum, list) => sum + (list.songs?.length ?? 0), 0),
      firstEventAt: firstEvent?.at ?? null,
      lastEventAt: lastEvent?.at ?? null,
      firstLikeAt: likedOldest?.createdAt ?? null,
      lastKnownSongAt: knownLatest?.lastSeenAt ?? null,
    },
    location,
    device: parsed,
    sessions: sessionRows.map(parseSession),
    liked: likeRows.map((row) => ({
      id: String(row._id),
      song: songSnapshot(row.song),
      savedAt: row.createdAt,
    })),
    playlists: playlistRows.map((row) => ({
      id: String(row._id),
      key: row.key,
      name: row.name,
      songCount: row.songs?.length ?? 0,
      preview: (row.songs ?? []).slice(0, 5).map(songSnapshot),
      createdAt: row.createdAt,
    })),
    eventKinds: kindRows.map((row) => ({ kind: row._id, count: row.count })),
    topSongs: topSongRows.map((row) => ({
      songId: row.songId,
      plays: row.plays,
      skips: row.skips,
      events: row.events,
      last: row.last,
      song: songSnapshot(row.song),
    })),
    topArtists: topArtistRows,
    searches: searchRows.map((row) => ({ q: row.q, at: row.at })),
    recentEvents: recentEventRows.map((row) => ({
      id: String(row._id),
      eid: row.eid,
      kind: row.kind,
      songId: row.songId ?? null,
      q: row.q ?? null,
      w: row.w ?? 1,
      pct: row.pct ?? null,
      at: row.at,
      song: songSnapshot(songById.get(row.songId)),
    })),
    activity: eventDays.map((row) => ({ date: row._id, count: row.count })),
  };
}

export async function deleteUser(id, confirm) {
  const uid = toObjectId(id, "user id");
  const user = await users().findOne({ _id: uid });
  if (!user) throw new AppError(404, "That account no longer exists.");
  if (String(confirm ?? "").trim().toUpperCase() !== "DELETE") {
    throw new AppError(400, 'Type "DELETE" to confirm this irreversible action.');
  }

  const [sessionResult, likeResult, playlistResult, eventResult, knownResult] = await Promise.all([
    sessions().deleteMany({ user: uid }),
    likedSongs().deleteMany({ user: uid }),
    playlists().deleteMany({ user: uid }),
    historyEvents().deleteMany({ user: uid }),
    knownSongs().deleteMany({ user: uid }),
  ]);

  const removedUser = await users().deleteOne({ _id: uid });
  if (!removedUser.deletedCount) {
    throw new AppError(409, "The account disappeared before it could be deleted.");
  }

  clearCache();
  return {
    deleted: true,
    user: publicUser(user),
    removed: {
      sessions: sessionResult.deletedCount,
      likedSongs: likeResult.deletedCount,
      playlists: playlistResult.deletedCount,
      historyEvents: eventResult.deletedCount,
      knownSongs: knownResult.deletedCount,
    },
  };
}

export async function revokeUserSessions(id, confirm) {
  const uid = toObjectId(id, "user id");
  if (String(confirm ?? "").trim().toUpperCase() !== "REVOKE") {
    throw new AppError(400, 'Type "REVOKE" to sign this account out everywhere.');
  }
  const result = await sessions().deleteMany({ user: uid });
  clearCache();
  return { revoked: result.deletedCount };
}
