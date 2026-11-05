import { escapeRegex, visits } from "../lib/collections.js";
import { resolveRange } from "../lib/dates.js";
import { countryName, lookupIp } from "../lib/geo.js";
import { parseUserAgent } from "../lib/ua.js";
import { groupCounts, uniqueCount } from "./breakdowns.js";

function buildMatch({ range = "30d", q = "", source = "", country = "" }) {
  const resolved = resolveRange(range);
  const match = { createdAt: { $gte: resolved.start } };
  const search = String(q ?? "").trim().slice(0, 80);

  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    match.$or = [
      { ip: regex },
      { city: regex },
      { region: regex },
      { country: regex },
      { source: regex },
      { medium: regex },
      { campaign: regex },
      { path: regex },
      { referrer: regex },
      { clientId: regex },
    ];
  }

  if (source) match.source = source;
  if (country) match.country = country;

  return { match, range: resolved };
}

export async function listVisits(options = {}) {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
  const { match, range } = buildMatch(options);

  const total = await visits().countDocuments(match);
  const pages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(page, pages);

  const [rows, visitors, countries] = await Promise.all([
    visits()
      .find(match)
      .sort({ createdAt: -1, _id: -1 })
      .skip((currentPage - 1) * limit)
      .limit(limit)
      .toArray(),
    uniqueCount(visits(), match, "clientId"),
    uniqueCount(visits(), { ...match, country: { $ne: null } }, "country"),
  ]);

  return {
    items: rows.map((row) => {
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
    }),
    total,
    page: currentPage,
    pages,
    limit,
    range: { value: range.value, label: range.label, start: range.start, end: range.end },
    stats: { total, visitors, countries },
  };
}

export async function getVisitMeta() {
  const [sources, countries, campaigns, mediums] = await Promise.all([
    groupCounts(visits(), {}, { $ifNull: ["$source", "direct"] }, 100),
    groupCounts(visits(), { country: { $ne: null } }, "$country", 250),
    groupCounts(visits(), { campaign: { $nin: [null, ""] } }, "$campaign", 100),
    groupCounts(visits(), { medium: { $nin: [null, ""] } }, "$medium", 50),
  ]);

  return {
    sources: sources.map((row) => ({ value: row.name, label: row.name, count: row.count })),
    countries: countries.map((row) => ({
      value: row.name,
      label: countryName(row.name) ?? row.name,
      countryName: countryName(row.name) ?? row.name,
      count: row.count,
    })),
    campaigns: campaigns.map((row) => row.name),
    mediums: mediums.map((row) => row.name),
  };
}
