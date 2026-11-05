import { adminEnv } from "../env.js";
import { dbStatus } from "../../config/db.js";
import {
  historyEvents,
  knownSongs,
  likedSongs,
  playlists,
  sessions,
  users,
  visits,
} from "../lib/collections.js";
import { withCache } from "../lib/cache.js";
import { fillDaily, resolveRange, startOfUtcDay } from "../lib/dates.js";
import { countryName, lookupIp } from "../lib/geo.js";
import { parseUserAgent } from "../lib/ua.js";
import { groupCounts, uniqueCount, userAgentBreakdown } from "./breakdowns.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const PLAYED = ["play", "complete", "deep"];

function change(current, previous) {
  if (!previous) return current ? 100 : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function visitRow(row) {
  const parsed = parseUserAgent(row.userAgent);
  return {
    id: String(row._id),
    clientId: row.clientId,
    ip: row.ip,
    ...lookupIp(row.ip),
    source: row.source ?? "direct",
    medium: row.medium ?? null,
    campaign: row.campaign ?? null,
    referrer: row.referrer ?? null,
    path: row.path,
    language: row.language ?? null,
    userAgent: row.userAgent ?? null,
    ...parsed,
    createdAt: row.createdAt,
  };
}

/** The dashboard now runs inside zyrava-server, so health is local. */
function localHealth() {
  const db = dbStatus();
  return {
    url: "same process",
    ok: db === "up",
    status: db === "up" ? 200 : 503,
    responseMs: 0,
    db,
    uptime: Math.round(process.uptime()),
    error: null,
  };
}

export async function getOverview(rangeValue) {
  const range = resolveRange(rangeValue);
  const start = range.start;
  const end = range.end;
  const today = startOfUtcDay(end);
  const weekAgo = new Date(end.getTime() - 7 * DAY_MS);
  const monthAgo = new Date(end.getTime() - 30 * DAY_MS);
  const span = end.getTime() - start.getTime();
  const previousStart = new Date(start.getTime() - span);

  return withCache(`overview:${range.value}`, adminEnv.cacheTtlMs, async () => {
    const [
      totalUsers,
      newUsers,
      newUsersToday,
      newUsers7d,
      activeUsers30d,
      previousUsers,
      totalVisits,
      rangeVisits,
      visitsToday,
      visits7d,
      previousVisits,
      uniqueVisitors,
      totalLikes,
      totalPlaylists,
      totalEvents,
      totalKnownSongs,
      activeSessions,
      totalSessions,
      totalPlays,
      totalSearches,
      userSeries,
      visitSeries,
      locationRows,
      sourceRows,
      campaignRows,
      cityRows,
      agentBreakdown,
      recentUsers,
      recentVisitRows,
    ] = await Promise.all([
      users().countDocuments({}),
      users().countDocuments({ createdAt: { $gte: start } }),
      users().countDocuments({ createdAt: { $gte: today } }),
      users().countDocuments({ createdAt: { $gte: weekAgo } }),
      users().countDocuments({ lastLoginAt: { $gte: monthAgo } }),
      users().countDocuments({ createdAt: { $gte: previousStart, $lt: start } }),
      visits().countDocuments({}),
      visits().countDocuments({ createdAt: { $gte: start } }),
      visits().countDocuments({ createdAt: { $gte: today } }),
      visits().countDocuments({ createdAt: { $gte: weekAgo } }),
      visits().countDocuments({ createdAt: { $gte: previousStart, $lt: start } }),
      uniqueCount(visits(), { createdAt: { $gte: start } }, "clientId"),
      likedSongs().countDocuments({}),
      playlists().countDocuments({}),
      historyEvents().countDocuments({}),
      knownSongs().countDocuments({}),
      sessions().countDocuments({ expiresAt: { $gt: end } }),
      sessions().countDocuments({}),
      historyEvents().countDocuments({ kind: { $in: PLAYED } }),
      historyEvents().countDocuments({ q: { $ne: null } }),
      users()
        .aggregate([
          { $match: { createdAt: { $gte: start } } },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
              users: { $sum: 1 },
            },
          },
        ])
        .toArray(),
      visits()
        .aggregate([
          { $match: { createdAt: { $gte: start } } },
          {
            $group: {
              _id: {
                day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                client: "$clientId",
              },
              count: { $sum: 1 },
            },
          },
          {
            $group: {
              _id: "$_id.day",
              visits: { $sum: "$count" },
              visitors: { $sum: 1 },
            },
          },
        ])
        .toArray(),
      groupCounts(visits(), { createdAt: { $gte: start }, country: { $ne: null } }, "$country", 8),
      groupCounts(visits(), { createdAt: { $gte: start } }, { $ifNull: ["$source", "direct"] }, 8),
      groupCounts(
        visits(),
        { createdAt: { $gte: start }, campaign: { $nin: [null, ""] } },
        "$campaign",
        6
      ),
      visits()
        .aggregate([
          { $match: { createdAt: { $gte: start }, city: { $nin: [null, ""] } } },
          {
            $group: {
              _id: { city: "$city", region: "$region", country: "$country" },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 6 },
        ])
        .toArray(),
      userAgentBreakdown({ createdAt: { $gte: start } }, 8),
      users()
        .find({}, { projection: { passwordHash: 0, __v: 0 } })
        .sort({ createdAt: -1 })
        .limit(5)
        .toArray(),
      visits().find({}).sort({ createdAt: -1 }).limit(6).toArray(),
    ]);

    const userDays = fillDaily(userSeries, start, end, { users: 0 });
    const visitDays = fillDaily(visitSeries, start, end, { visits: 0, visitors: 0 });
    const series = userDays.map((day, index) => ({
      date: day.date,
      users: day.users ?? 0,
      visits: visitDays[index]?.visits ?? 0,
      visitors: visitDays[index]?.visitors ?? 0,
    }));

    return {
      range: { value: range.value, label: range.label, start, end },
      generatedAt: new Date(),
      kpis: {
        totalUsers,
        newUsers,
        newUsersToday,
        newUsers7d,
        activeUsers30d,
        totalVisits,
        rangeVisits,
        visitsToday,
        uniqueVisitors,
        totalLikes,
        totalPlaylists,
        totalEvents,
        activeSessions,
        totalSessions,
        totalPlays,
        totalSearches,
      },
      changes: {
        users: change(newUsers, previousUsers),
        visits: change(rangeVisits, previousVisits),
      },
      series,
      locations: locationRows.map((row) => ({
        country: row.name,
        countryName: countryName(row.name) ?? row.name,
        count: row.count,
      })),
      sources: sourceRows,
      campaigns: campaignRows,
      cities: cityRows.map((row) => ({
        city: row._id.city ?? "Unknown",
        region: row._id.region ?? null,
        country: row._id.country ?? null,
        count: row.count,
      })),
      devices: agentBreakdown.devices,
      browsers: agentBreakdown.browsers,
      operatingSystems: agentBreakdown.operatingSystems,
      recentUsers: recentUsers.map((user) => ({
        id: String(user._id),
        name: user.name ?? null,
        email: user.email ?? null,
        phone: user.phone ?? null,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt ?? null,
      })),
      recentVisits: recentVisitRows.map(visitRow),
      server: localHealth(),
      totals: {
        totalKnownSongs,
        totalSessions,
      },
    };
  });
}
