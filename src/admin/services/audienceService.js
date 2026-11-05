import { adminEnv } from "../env.js";
import { visits } from "../lib/collections.js";
import { withCache } from "../lib/cache.js";
import { fillDaily, resolveRange } from "../lib/dates.js";
import { countryName } from "../lib/geo.js";
import { groupCounts, uniqueCount, userAgentBreakdown } from "./breakdowns.js";

async function groupWithVisitors(match, expression, limit = 10) {
  const rows = await visits()
    .aggregate([
      { $match: match },
      { $group: { _id: { value: expression, client: "$clientId" } } },
      {
        $group: {
          _id: "$_id.value",
          visits: { $sum: 1 },
          visitors: { $sum: 1 },
        },
      },
      { $sort: { visits: -1, _id: 1 } },
      { $limit: limit },
    ])
    .toArray();

  return rows.map((row) => ({
    name:
      row._id === null || row._id === undefined || row._id === ""
        ? "Unknown"
        : String(row._id),
    count: row.visits,
    visitors: row.visitors,
  }));
}

export async function getAudience(rangeValue) {
  const range = resolveRange(rangeValue);
  const match = { createdAt: { $gte: range.start } };

  return withCache(`audience:${range.value}`, adminEnv.cacheTtlMs, async () => {
    const [
      totalVisits,
      uniqueVisitors,
      totalCountries,
      totalCities,
      totalSources,
      totalCampaigns,
      timelineRows,
      sourceRows,
      mediumRows,
      campaignRows,
      countryRows,
      regionRows,
      cityRows,
      referrerRows,
      pathRows,
      languageRows,
      agents,
    ] = await Promise.all([
      visits().countDocuments(match),
      uniqueCount(visits(), match, "clientId"),
      uniqueCount(visits(), { ...match, country: { $ne: null } }, "country"),
      uniqueCount(visits(), { ...match, city: { $ne: null } }, "city"),
      uniqueCount(visits(), { ...match, source: { $ne: null } }, "source"),
      uniqueCount(visits(), { ...match, campaign: { $ne: null } }, "campaign"),
      visits()
        .aggregate([
          { $match: match },
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
      groupWithVisitors(match, { $ifNull: ["$source", "direct"] }, 12),
      groupCounts(visits(), { ...match, medium: { $nin: [null, ""] } }, "$medium", 10),
      groupCounts(visits(), { ...match, campaign: { $nin: [null, ""] } }, "$campaign", 12),
      groupWithVisitors(match, { $ifNull: ["$country", "Unknown"] }, 15),
      visits()
        .aggregate([
          { $match: { ...match, region: { $nin: [null, ""] } } },
          { $group: { _id: { region: "$region", country: "$country" }, count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 12 },
        ])
        .toArray(),
      visits()
        .aggregate([
          { $match: { ...match, city: { $nin: [null, ""] } } },
          {
            $group: {
              _id: { city: "$city", region: "$region", country: "$country" },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 15 },
        ])
        .toArray(),
      groupCounts(visits(), match, { $ifNull: ["$referrer", "Direct / none"] }, 12),
      groupCounts(visits(), match, "$path", 15),
      groupCounts(visits(), { ...match, language: { $nin: [null, ""] } }, "$language", 10),
      userAgentBreakdown(match, 10),
    ]);

    const timeline = fillDaily(timelineRows, range.start, range.end, {
      visits: 0,
      visitors: 0,
    });

    return {
      range: { value: range.value, label: range.label, start: range.start, end: range.end },
      totals: {
        visits: totalVisits,
        visitors: uniqueVisitors,
        countries: totalCountries,
        cities: totalCities,
        sources: totalSources,
        campaigns: totalCampaigns,
      },
      timeline,
      sources: sourceRows.map((row) => ({
        ...row,
        name: row.name === "direct" ? "Direct" : row.name,
      })),
      mediums: mediumRows,
      campaigns: campaignRows,
      countries: countryRows.map((row) => ({
        code: row.name === "Unknown" ? null : row.name,
        name: row.name === "Unknown" ? "Unknown" : countryName(row.name) ?? row.name,
        count: row.count,
        visitors: row.visitors,
      })),
      regions: regionRows.map((row) => ({
        region: row._id.region,
        country: row._id.country,
        countryName: countryName(row._id.country),
        count: row.count,
      })),
      cities: cityRows.map((row) => ({
        city: row._id.city,
        region: row._id.region,
        country: row._id.country,
        countryName: countryName(row._id.country),
        count: row.count,
      })),
      referrers: referrerRows.map((row) => ({
        ...row,
        name: row.name === "Direct / none" ? "Direct / none" : row.name,
      })),
      landingPages: pathRows.map((row) => ({
        ...row,
        name: row.name.length > 80 ? `${row.name.slice(0, 80)}…` : row.name,
        fullPath: row.name,
      })),
      languages: languageRows,
      devices: agents.devices,
      browsers: agents.browsers,
      operatingSystems: agents.operatingSystems,
    };
  });
}
