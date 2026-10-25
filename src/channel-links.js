import { normalizeChannelUrl, platformFromUrl, PLATFORMS } from "./platforms.js";

const PLATFORM_IDS = Object.keys(PLATFORMS);

export const MAX_CHANNEL_LINKS = 20;

export function emptyPlatformMap(fill) {
  return Object.fromEntries(PLATFORM_IDS.map((platform) => [platform, fill()]));
}

function channelLinkEntries(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return String(value).split(/\r?\n/);
}

export function normalizePlatformLinks(value, platform) {
  const links = [];
  for (const entry of channelLinkEntries(value)) {
    const raw = String(entry ?? "").trim();
    if (!raw) continue;
    const normalized = normalizeChannelUrl(raw, { platform });
    if (!links.includes(normalized)) links.push(normalized);
  }
  if (links.length > MAX_CHANNEL_LINKS) {
    throw new Error(`Mỗi website chỉ được thêm tối đa ${MAX_CHANNEL_LINKS} link live.`);
  }
  return links;
}

export function normalizeChannelLinks(value, legacyChannelUrls = "") {
  const links = emptyPlatformMap(() => []);
  const hasObjectValue = value && typeof value === "object" && !Array.isArray(value);
  if (hasObjectValue) {
    for (const platform of PLATFORM_IDS) {
      links[platform] = normalizePlatformLinks(value[platform], platform);
    }
  } else if (value !== null && value !== undefined && String(value).trim()) {
    const normalized = normalizeChannelUrl(value);
    const platform = platformFromUrl(normalized);
    if (platform) links[platform] = [normalized];
  }

  if (legacyChannelUrls && typeof legacyChannelUrls === "object" && !Array.isArray(legacyChannelUrls)) {
    for (const platform of PLATFORM_IDS) {
      if (links[platform].length) continue;
      links[platform] = normalizePlatformLinks(legacyChannelUrls[platform], platform);
    }
  } else {
    const legacy = String(legacyChannelUrls ?? "").trim();
    if (legacy) {
      const normalized = normalizeChannelUrl(legacy);
      const platform = platformFromUrl(normalized);
      if (platform && !links[platform].length) links[platform] = [normalized];
    }
  }
  return links;
}
