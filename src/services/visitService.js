import geoip from "geoip-lite";
import { Visit } from "../models/Visit.js";

/**
 * Referrer hosts whose own name is not the channel they are known by. Anything
 * else falls back to the middle label of the host, which already reads as
 * `instagram`, `youtube`, `linkedin` and friends.
 */
const ODD_HOSTS = new Map([
  ["youtu.be", "youtube"],
  ["wa.me", "whatsapp"],
  ["fb.me", "facebook"],
  ["t.me", "telegram"],
  ["t.co", "x"],
  ["x.com", "x"],
  ["lnkd.in", "linkedin"],
  ["discord.gg", "discord"],
  ["beacons.ai", "beacons"],
  ["lit.link", "litlink"],
  ["taplink.st", "taplink"],
  ["bit.ly", "bitly"],
  ["dlvr.it", "dlvr"],
  ["pin.it", "pinterest"],
]);

/** Loopback and the private ranges resolve to nothing useful, so skip them. */
const PRIVATE =
  /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

/** `::ffff:1.2.3.4` is `1.2.3.4` wearing a different coat; keep one shape. */
function clientIp(req) {
  const ip = (req.ip ?? "").trim();
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

/** Second-level chunks that are part of the address, not the brand. */
const SUFFIXES = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "or", "in", "ne"]);

function channelFrom(referrer) {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    if (!host) return null;
    if (ODD_HOSTS.has(host)) return ODD_HOSTS.get(host);
    const labels = host.split(".");
    if (labels.length < 2) return null;
    let index = labels.length - 2;
    if (SUFFIXES.has(labels[index]) && index > 0) index -= 1;
    return labels[index].slice(0, 48) || null;
  } catch {
    // A referrer the URL parser disliked is a visit with no known origin.
    return null;
  }
}

/**
 * Where the click came from. A tagged link answers the question outright, so
 * it beats the referrer — which Instagram, WhatsApp and most in-app browsers
 * strip before the page ever opens.
 */
export function attribute({ path, referrer }) {
  let params = new URLSearchParams();
  try {
    params = new URL(path, "http://zyrava.local").searchParams;
  } catch {
    /* A path the URL parser disliked still gets a source, just no tags. */
  }

  const tag = (key) => (params.get(key) ?? "").trim().slice(0, 120) || undefined;
  const source = (tag("utm_source") ?? "").toLowerCase() || channelFrom(referrer) || "direct";

  return { source, medium: tag("utm_medium"), campaign: tag("utm_campaign") };
}

/**
 * One row per arrival. Never awaited by the route: the visitor's first paint
 * does not wait on a database, and a lost write is not their problem.
 */
export async function recordVisit(req, { clientId, path, referrer }) {
  const ip = clientIp(req);
  const geo = ip && !PRIVATE.test(ip) ? geoip.lookup(ip) : null;
  const accept = (req.get("accept-language") ?? "").split(",")[0]?.trim() ?? "";

  return Visit.create({
    clientId,
    ip,
    country: geo?.country,
    region: geo?.region,
    city: geo?.city,
    ...attribute({ path, referrer }),
    referrer,
    path: path.slice(0, 300),
    userAgent: (req.get("user-agent") ?? "").slice(0, 300),
    language: accept.slice(0, 12),
  });
}
