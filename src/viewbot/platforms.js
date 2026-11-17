// Cấu hình từng site livestream dùng chung một backend (royalcloud).
// Mỗi site: origin trang web + API chi tiết + endpoint socket.io.
export const VIEWBOT_PLATFORMS = {
  qq88: {
    id: "qq88",
    name: "QQ88 Live",
    origin: "https://www.qq88live.live",
    apiBase: "https://live-qq-api.royalcloud.work/api",
    socketUrl: "wss://live-qq-api.royalcloud.work/socket.io/?EIO=4&transport=websocket",
    linkPattern: /\/(?:live|live-mobile)\/([^/?#]+)/i,
  },
  mb66: {
    id: "mb66",
    name: "MB66 Live",
    origin: "https://mb66-live.pages.dev",
    apiBase: "https://live-mb66-apiclient.attcloud.org/api",
    socketUrl: "https://live-mb66-apiws.attcloud.org/livestream",
    kind: "signalr",
    linkPattern: /\/(?:live|live-mobile)\/([^/?#]+)/i,
  },
  coichua: {
    id: "coichua",
    name: "Coichua TV",
    origin: "https://coichua.com",
    apiBase: "https://api.chuavien.net",
    kind: "http",
    // /d/Room/<matchId>/<profileId> hoặc /d/History/<matchId>/<profileId>
    linkPattern: /\/(?:d|m)\/(?:Room|History|Broadcast)\/([0-9a-f]{16,32})\/(\d{3,12})/i,
  },
  hi88: {
    id: "hi88",
    name: "Hi88 Live",
    origin: "https://www.hi88live.live",
    apiBase: "https://live-hi-api.royalcloud.work/api",
    socketUrl: "wss://live-hi-api.royalcloud.work/socket.io/?EIO=4&transport=websocket",
    linkPattern: /\/(?:live|live-mobile)\/([^/?#]+)/i,
  },
};

export function platformList() {
  return Object.values(VIEWBOT_PLATFORMS).map(({ id, name, origin, kind }) => ({ id, name, origin, kind: kind || "socketio" }));
}

export function resolvePlatform(id, url) {
  if (id && VIEWBOT_PLATFORMS[id]) return VIEWBOT_PLATFORMS[id];
  if (url) {
    const host = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return "";
      }
    })();
    if (/hi88/i.test(host)) return VIEWBOT_PLATFORMS.hi88;
    if (/mb66/i.test(host)) return VIEWBOT_PLATFORMS.mb66;
    if (/coichua/i.test(host)) return VIEWBOT_PLATFORMS.coichua;
    if (/qq88/i.test(host)) return VIEWBOT_PLATFORMS.qq88;
  }
  return null;
}

// "https://www.qq88live.live/live/QQ88live-bunny" -> "QQ88live-bunny"
export function extractHub(url, platform) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) return raw.split(/[/?#]/)[0];
  const match = platform?.linkPattern?.exec(raw);
  if (!match) return "";
  if (match[2]) return `${match[1]}:${match[2]}`; // coichua: matchId:profileId
  return decodeURIComponent(match[1]);
}
