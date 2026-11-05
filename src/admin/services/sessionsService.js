import {
  escapeRegex,
  sessions,
  toObjectId,
  users,
} from "../lib/collections.js";
import { AppError } from "../lib/async.js";
import { clearCache } from "../lib/cache.js";
import { lookupIp } from "../lib/geo.js";
import { parseUserAgent } from "../lib/ua.js";

function decorate(row, userMap) {
  const parsed = parseUserAgent(row.userAgent);
  const user = userMap.get(String(row.user));
  return {
    id: String(row._id),
    user: user
      ? {
          id: String(user._id),
          name: user.name ?? null,
          email: user.email ?? null,
          phone: user.phone ?? null,
        }
      : null,
    ip: row.ip,
    ...lookupIp(row.ip),
    remember: Boolean(row.remember),
    active: row.expiresAt ? new Date(row.expiresAt) > new Date() : false,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    userAgent: row.userAgent ?? null,
    ...parsed,
  };
}

export async function listSessions(options = {}) {
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
  const search = String(options.q ?? "").trim().slice(0, 80);
  const active = String(options.active ?? "all");
  const now = new Date();

  const match = {};
  if (active === "active") match.expiresAt = { $gt: now };
  if (active === "expired") match.expiresAt = { $lte: now };

  if (search) {
    const regex = new RegExp(escapeRegex(search), "i");
    const matchingUsers = await users()
      .find(
        { $or: [{ name: regex }, { email: regex }, { phone: regex }] },
        { projection: { _id: 1 } }
      )
      .limit(500)
      .toArray();
    const ids = matchingUsers.map((row) => row._id);
    if (!ids.length) {
      return {
        items: [],
        total: 0,
        page: 1,
        pages: 1,
        limit,
        stats: await sessionStats(),
      };
    }
    match.user = { $in: ids };
  }

  const [total, rows, stats] = await Promise.all([
    sessions().countDocuments(match),
    sessions()
      .find(match)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray(),
    sessionStats(),
  ]);

  const userIds = [...new Set(rows.map((row) => row.user))];
  const userRows = userIds.length
    ? await users()
        .find(
          { _id: { $in: userIds } },
          { projection: { passwordHash: 0, __v: 0 } }
        )
        .toArray()
    : [];
  const userMap = new Map(userRows.map((row) => [String(row._id), row]));
  const pages = Math.max(1, Math.ceil(total / limit));

  return {
    items: rows.map((row) => decorate(row, userMap)),
    total,
    page: Math.min(page, pages),
    pages,
    limit,
    stats,
    range: { active },
  };
}

async function sessionStats() {
  const now = new Date();
  const [total, active, remembered] = await Promise.all([
    sessions().countDocuments({}),
    sessions().countDocuments({ expiresAt: { $gt: now } }),
    sessions().countDocuments({ remember: true }),
  ]);
  return { total, active, expired: total - active, remembered };
}

export async function deleteSession(id, confirm) {
  const sid = toObjectId(id, "session id");
  if (String(confirm ?? "").trim().toUpperCase() !== "DELETE") {
    throw new AppError(400, 'Type "DELETE" to revoke this session.');
  }

  const row = await sessions().findOne({ _id: sid });
  if (!row) throw new AppError(404, "That session no longer exists.");

  await sessions().deleteOne({ _id: sid });
  clearCache();
  return { deleted: true, sessionId: String(sid), user: String(row.user) };
}
