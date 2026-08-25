export const PLATFORMS = Object.freeze({
  gosh: Object.freeze({
    id: "gosh",
    name: "Gosh",
    homeUrl: "https://gosh6.app/",
    profileUrl: "https://gosh6.app/streamer-dashboard/settings/profile",
    hostPattern: /(^|\.)gosh6\.app$/i,
    roomPathPattern: /^\/(?:[a-z]{2}(?:-[A-Za-z]+)?\/)?\d+/,
  }),
  loco: Object.freeze({
    id: "loco",
    name: "Loco",
    homeUrl: "https://loco.com/",
    profileUrl: "https://loco.com/user/profile",
    hostPattern: /(^|\.)loco\.com$/i,
    roomPathPattern: /^\/(?:stream|streamers)\//i,
  }),
});

export function normalizePlatform(value, fallback = "gosh") {
  const id = String(value || fallback).toLowerCase();
  if (!PLATFORMS[id]) throw new Error("Nền tảng không được hỗ trợ.");
  return id;
}

export function platformFromUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    return null;
  }
  return Object.values(PLATFORMS).find((platform) => platform.hostPattern.test(url.hostname))?.id || null;
}

export function normalizeChannelUrl(value, { allowEmpty = true, platform } = {}) {
  const input = String(value ?? "").trim();
  if (!input && allowEmpty) return "";

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("URL phòng live không hợp lệ.");
  }
  const detectedPlatform = platformFromUrl(url.href);
  if (url.protocol !== "https:" || !detectedPlatform) {
    throw new Error("Chỉ chấp nhận URL HTTPS của Gosh hoặc Loco.");
  }
  if (platform && detectedPlatform !== normalizePlatform(platform)) {
    throw new Error("URL phòng live không khớp nền tảng đã chọn.");
  }
  if (!PLATFORMS[detectedPlatform].roomPathPattern.test(url.pathname)) {
    throw new Error(`URL chưa phải phòng live hợp lệ của ${PLATFORMS[detectedPlatform].name}.`);
  }
  url.hash = "";
  return url.toString();
}

export function assertPlatformUrl(value, platform) {
  const definition = PLATFORMS[normalizePlatform(platform)];
  const url = new URL(value || definition.homeUrl);
  if (url.protocol !== "https:" || !definition.hostPattern.test(url.hostname)) {
    throw new Error(`Chỉ có thể mở trang HTTPS thuộc ${definition.name}.`);
  }
  return url.toString();
}

export function getLocoStreamId(value) {
  try {
    const match = new URL(value).pathname.match(/^\/stream\/([a-f0-9-]{20,})/i);
    return match?.[1] || "";
  } catch {
    return "";
  }
}
