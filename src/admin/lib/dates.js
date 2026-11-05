/**
 * The dashboard speaks in named ranges instead of raw dates. `all` is capped
 * to one year so a free-tier Mongo never has to scan an unbounded collection
 * just to paint a chart.
 */
export const RANGE_OPTIONS = [
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "all", label: "Last 12 months", days: 365 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function resolveRange(value) {
  const option = RANGE_OPTIONS.find((entry) => entry.value === value) ?? RANGE_OPTIONS[1];
  const end = new Date();
  const firstDay = startOfUtcDay(new Date(end.getTime() - (option.days - 1) * DAY_MS));
  return { ...option, start: firstDay, end };
}

export function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Turns sparse `{ _id: "2026-11-05", ... }` aggregation rows into a dense
 * daily series so charts never draw gaps or lie about scale.
 */
export function fillDaily(rows, start, end, defaults = {}) {
  const byDay = new Map(rows.map((row) => [row._id, row]));
  const out = [];
  const cursor = startOfUtcDay(start);
  const last = startOfUtcDay(end);

  while (cursor.getTime() <= last.getTime()) {
    const key = dayKey(cursor);
    const row = byDay.get(key) ?? {};
    out.push({ date: key, ...defaults, ...row, _id: undefined });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export function dailyMatch(field, start) {
  return { [field]: { $gte: start } };
}
