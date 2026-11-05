import { UAParser } from "ua-parser-js";

const BOT = /bot|crawler|spider|slurp|bingpreview|headless|lighthouse|facebookexternalhit|whatsapp|telegrambot/i;

const DEVICE_LABELS = {
  mobile: "Mobile",
  tablet: "Tablet",
  console: "Console",
  smarttv: "Smart TV",
  wearable: "Wearable",
  embedded: "Embedded",
};

export function parseUserAgent(value) {
  const ua = String(value ?? "").trim();
  if (!ua) return { device: "Unknown", browser: "Unknown", os: "Unknown", browserVersion: null };

  const result = new UAParser(ua).getResult();
  const browser = result.browser.name || "Unknown";
  const os = result.os.name || "Unknown";
  const browserVersion = result.browser.version || null;

  if (BOT.test(ua)) {
    return { device: "Bot", browser: browser === "Unknown" ? "Bot" : browser, os, browserVersion };
  }

  const device = DEVICE_LABELS[result.device.type] || "Desktop";
  return { device, browser, os, browserVersion };
}
