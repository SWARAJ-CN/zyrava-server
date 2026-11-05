import { visits } from "../lib/collections.js";
import { parseUserAgent } from "../lib/ua.js";

export async function groupCounts(collection, match, expression, limit = 10) {
  const rows = await collection
    .aggregate([
      { $match: match },
      { $group: { _id: expression, count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: limit },
    ])
    .toArray();

  return rows.map((row) => ({
    name: row._id === null || row._id === undefined || row._id === "" ? "Unknown" : String(row._id),
    count: row.count,
  }));
}

export async function uniqueCount(collection, match, field) {
  const rows = await collection
    .aggregate([{ $match: match }, { $group: { _id: `$${field}` } }, { $count: "value" }])
    .toArray();
  return rows[0]?.value ?? 0;
}

function top(map, limit = 8) {
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/**
 * zyrava-server stores only the raw user agent. Device, browser and OS are
 * derived here at read time so a parser upgrade immediately improves history
 * without rewriting a single visit row.
 */
export async function userAgentBreakdown(match, limit = 8) {
  const rows = await visits()
    .aggregate([{ $match: match }, { $group: { _id: "$userAgent", count: { $sum: 1 } } }])
    .toArray();

  const device = new Map();
  const browser = new Map();
  const os = new Map();

  for (const row of rows) {
    const parsed = parseUserAgent(row._id);
    device.set(parsed.device, (device.get(parsed.device) ?? 0) + row.count);
    browser.set(parsed.browser, (browser.get(parsed.browser) ?? 0) + row.count);
    os.set(parsed.os, (os.get(parsed.os) ?? 0) + row.count);
  }

  return {
    devices: top(device, limit),
    browsers: top(browser, limit),
    operatingSystems: top(os, limit),
    uniqueAgents: rows.length,
  };
}
