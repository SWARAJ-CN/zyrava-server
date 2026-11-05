import geoip from "geoip-lite";

const PRIVATE =
  /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|fc|fd|fe80)/;

const regionNames =
  typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;

export function cleanIp(value) {
  const ip = String(value ?? "").trim();
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

export function lookupIp(value) {
  const ip = cleanIp(value);
  if (!ip) return { ip: null, country: null, countryName: null, region: null, city: null };
  if (PRIVATE.test(ip)) {
    return { ip, country: null, countryName: null, region: null, city: null };
  }

  const found = geoip.lookup(ip);
  return {
    ip,
    country: found?.country || null,
    countryName: countryName(found?.country),
    region: found?.region || null,
    city: found?.city || null,
  };
}

export function countryName(code) {
  if (!code) return null;
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}
