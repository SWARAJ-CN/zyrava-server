import { adminEnv } from "../env.js";
import {
  historyEvents,
  knownSongs,
  likedSongs,
  playlists,
  users,
} from "../lib/collections.js";
import { withCache } from "../lib/cache.js";
import { resolveRange } from "../lib/dates.js";

const PLAYED = ["play", "complete", "deep"];

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
    pageUrl: song.pageUrl ?? "",
  };
}

export async function getContent(rangeValue) {
  const range = resolveRange(rangeValue);
  const eventMatch = { at: { $gte: range.start } };

  return withCache(`content:${range.value}`, adminEnv.cacheTtlMs, async () => {
    const [
      totalLikes,
      totalPlaylists,
      playlistAgg,
      totalEvents,
      totalKnownSongs,
      totalPlays,
      totalSearches,
      uniqueLikedRows,
      topSongRows,
      topArtistRows,
      topLanguageRows,
      topPlaylistRows,
      topPlayedRows,
      searchRows,
      recentRows,
      kindRows,
    ] = await Promise.all([
      likedSongs().countDocuments({}),
      playlists().countDocuments({}),
      playlists()
        .aggregate([{ $group: { _id: null, songs: { $sum: { $size: "$songs" } } } }])
        .toArray(),
      historyEvents().countDocuments({}),
      knownSongs().countDocuments({}),
      historyEvents().countDocuments({ kind: { $in: PLAYED } }),
      historyEvents().countDocuments({ q: { $ne: null } }),
      likedSongs()
        .aggregate([{ $group: { _id: "$song.id" } }, { $count: "value" }])
        .toArray(),
      likedSongs()
        .aggregate([
          {
            $group: {
              _id: "$song.id",
              likes: { $sum: 1 },
              users: { $addToSet: "$user" },
              song: { $first: "$song" },
            },
          },
          { $sort: { likes: -1 } },
          { $limit: 12 },
          { $project: { _id: 0, likes: 1, users: { $size: "$users" }, song: 1 } },
        ])
        .toArray(),
      likedSongs()
        .aggregate([
          {
            $group: {
              _id: "$song.artist",
              likes: { $sum: 1 },
              users: { $addToSet: "$user" },
            },
          },
          { $match: { _id: { $nin: [null, ""] } } },
          { $sort: { likes: -1 } },
          { $limit: 12 },
          { $project: { _id: 0, name: "$_id", likes: 1, users: { $size: "$users" } } },
        ])
        .toArray(),
      likedSongs()
        .aggregate([
          { $group: { _id: "$song.language", count: { $sum: 1 } } },
          { $match: { _id: { $nin: [null, ""] } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
          { $project: { _id: 0, name: "$_id", count: 1 } },
        ])
        .toArray(),
      playlists()
        .aggregate([
          {
            $group: {
              _id: "$nameLower",
              name: { $first: "$name" },
              owners: { $addToSet: "$user" },
              songs: { $sum: { $size: "$songs" } },
            },
          },
          { $sort: { songs: -1, name: 1 } },
          { $limit: 12 },
          { $project: { _id: 0, name: 1, owners: { $size: "$owners" }, songs: 1 } },
        ])
        .toArray(),
      historyEvents()
        .aggregate([
          { $match: { ...eventMatch, songId: { $ne: null }, kind: { $in: PLAYED } } },
          {
            $group: {
              _id: "$songId",
              plays: { $sum: 1 },
              listeners: { $addToSet: "$user" },
              last: { $max: "$at" },
            },
          },
          { $sort: { plays: -1 } },
          { $limit: 12 },
          {
            $lookup: {
              from: "known_songs",
              let: { sid: "$_id" },
              pipeline: [
                { $match: { $expr: { $eq: ["$songId", "$$sid"] } } },
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
              listeners: { $size: "$listeners" },
              last: 1,
              song: { $arrayElemAt: ["$hit.song", 0] },
            },
          },
        ])
        .toArray(),
      historyEvents()
        .aggregate([
          { $match: { ...eventMatch, q: { $ne: null } } },
          { $group: { _id: "$q", count: { $sum: 1 }, lastAt: { $max: "$at" } } },
          { $sort: { count: -1, lastAt: -1 } },
          { $limit: 20 },
          { $project: { _id: 0, q: "$_id", count: 1, lastAt: 1 } },
        ])
        .toArray(),
      historyEvents().find(eventMatch).sort({ at: -1 }).limit(25).toArray(),
      historyEvents()
        .aggregate([
          { $match: eventMatch },
          { $group: { _id: "$kind", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ])
        .toArray(),
    ]);

    const recentUserIds = [...new Set(recentRows.map((row) => row.user))];
    const recentSongIds = [...new Set(recentRows.map((row) => row.songId).filter(Boolean))];
    const [recentUsers, recentSongs] = await Promise.all([
      recentUserIds.length
        ? users()
            .find(
              { _id: { $in: recentUserIds } },
              { projection: { passwordHash: 0, __v: 0 } }
            )
            .toArray()
        : [],
      recentSongIds.length
        ? knownSongs().find({ songId: { $in: recentSongIds } }).limit(500).toArray()
        : [],
    ]);

    const userMap = new Map(recentUsers.map((row) => [String(row._id), row]));
    const songMap = new Map();
    for (const row of recentSongs) {
      if (!songMap.has(row.songId)) songMap.set(row.songId, row.song);
    }

    return {
      range: { value: range.value, label: range.label, start: range.start, end: range.end },
      totals: {
        likes: totalLikes,
        playlists: totalPlaylists,
        playlistSongs: playlistAgg[0]?.songs ?? 0,
        events: totalEvents,
        knownSongs: totalKnownSongs,
        plays: totalPlays,
        searches: totalSearches,
        uniqueLikedSongs: uniqueLikedRows[0]?.value ?? 0,
      },
      topSongs: topSongRows.map((row) => ({
        likes: row.likes,
        users: row.users,
        song: songSnapshot(row.song),
      })),
      topArtists: topArtistRows,
      topLanguages: topLanguageRows,
      topPlaylists: topPlaylistRows,
      topPlayed: topPlayedRows.map((row) => ({
        songId: row.songId,
        plays: row.plays,
        listeners: row.listeners,
        last: row.last,
        song: songSnapshot(row.song),
      })),
      searches: searchRows,
      recentEvents: recentRows.map((row) => {
        const user = userMap.get(String(row.user));
        return {
          id: String(row._id),
          kind: row.kind,
          songId: row.songId ?? null,
          q: row.q ?? null,
          w: row.w ?? 1,
          pct: row.pct ?? null,
          at: row.at,
          song: songSnapshot(songMap.get(row.songId)),
          user: user
            ? {
                id: String(user._id),
                name: user.name ?? null,
                email: user.email ?? null,
                phone: user.phone ?? null,
              }
            : null,
        };
      }),
      eventKinds: kindRows.map((row) => ({ kind: row._id, count: row.count })),
    };
  });
}
