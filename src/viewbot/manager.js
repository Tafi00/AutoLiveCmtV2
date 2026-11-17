// Quản lý nhiều phiên tăng mắt: mỗi phiên = 1 group livestream + N socket.
import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { Viewer } from "./client.js";
import { SignalRViewer } from "./client-signalr.js";
import { HttpViewer } from "./client-http.js";
import { resolvePlatform, extractHub } from "./platforms.js";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
];

const MAX_BOTS = 20000;
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// "ip:port:user:pass" | "ip:port" | "socks5://ip:port:user:pass"
export function parseProxyLine(line) {
  let raw = String(line || "").trim();
  if (!raw || raw.startsWith("#")) return null;
  let scheme = "http";
  const schemeMatch = /^(https?|socks5h?|socks4):\/\//i.exec(raw);
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase().replace("socks5h", "socks5");
    raw = raw.slice(schemeMatch[0].length);
  }
  const parts = raw.split(":");
  if (parts.length === 2) return `${scheme}://${parts[0]}:${parts[1]}`;
  if (parts.length === 3) return `${scheme}://${parts[2]}@${parts[0]}:${parts[1]}`;
  if (parts.length === 4) return `${scheme}://${parts[2]}:${parts[3]}@${parts[0]}:${parts[1]}`;
  return null;
}

// Proxy xoay vòng theo session: "host:port:user-session-{i}:pass" -> mỗi mắt một session/IP.
export function expandProxies(list, count) {
  if (!list.length) return [];
  if (!list.some((item) => item.includes("{i}") || item.includes("{rand}"))) return list;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const base = list[i % list.length];
    out.push(
      base
        .replace(/\{i\}/g, String(i + 1))
        .replace(/\{rand\}/g, Math.random().toString(36).slice(2, 10)),
    );
  }
  return [...new Set(out)];
}

export function parseProxyList(input) {
  const rows = Array.isArray(input) ? input : String(input || "").split(/[\s,]+/);
  const out = [];
  for (const row of rows) {
    const parsed = parseProxyLine(row);
    if (parsed && !out.includes(parsed)) out.push(parsed);
  }
  return out;
}

export class ViewbotManager {
  constructor() {
    this.jobs = new Map();
    this.agents = new Map();
    this.sequence = 0;
  }

  #agentFor(proxy) {
    if (!proxy) return undefined;
    if (!this.agents.has(proxy)) {
      this.agents.set(proxy, /^socks/i.test(proxy) ? new SocksProxyAgent(proxy) : new HttpsProxyAgent(proxy));
    }
    return this.agents.get(proxy);
  }

  start({ platform: platformId, url, hub, bots, ramp, proxies }) {
    const platform = resolvePlatform(platformId, url);
    if (!platform) throw new Error("Nền tảng không hợp lệ (qq88 | hi88)");
    const room = String(hub || "").trim() || extractHub(url, platform);
    if (!room) throw new Error("Thiếu link live hoặc mã phòng (hub)");

    const target = Math.max(1, Math.min(MAX_BOTS, Number(bots) || 50));
    const rate = Math.max(1, Math.min(2000, Number(ramp) || 5));
    const proxyList = expandProxies(parseProxyList(proxies), target);
    const key = `${platform.id}:${room}`;

    const existing = this.jobs.get(key);
    if (existing) this.stop(key);

    const job = {
      id: key,
      platform: platform.id,
      platformName: platform.name,
      hub: room,
      target,
      ramp: rate,
      proxies: proxyList,
      viewers: [],
      launched: 0,
      joined: 0,
      drops: 0,
      errors: 0,
      count: null,
      startedAt: Date.now(),
      rampTimer: null,
    };

    const launch = () => {
      const index = job.launched++;
      const proxy = proxyList.length ? proxyList[index % proxyList.length] : null;
      const ViewerClass =
        platform.kind === "signalr" ? SignalRViewer : platform.kind === "http" ? HttpViewer : Viewer;
      const viewer = new ViewerClass({
        platform,
        hub: room,
        userAgent: pick(USER_AGENTS),
        agent: this.#agentFor(proxy),
        onJoin: () => {
          job.joined += 1;
        },
        onDrop: () => {
          job.drops += 1;
        },
        onCount: (value) => {
          job.count = value;
        },
        onError: () => {
          job.errors += 1;
        },
      });
      viewer.start();
      job.viewers.push(viewer);
    };

    const perTick = Math.max(1, Math.round(rate / 4));
    job.rampTimer = setInterval(() => {
      for (let i = 0; i < perTick && job.launched < target; i += 1) launch();
      if (job.launched >= target) clearInterval(job.rampTimer);
    }, 250);
    job.rampTimer.unref?.();

    this.jobs.set(key, job);
    return this.#snapshot(job);
  }

  stop(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    clearInterval(job.rampTimer);
    for (const viewer of job.viewers) viewer.stop();
    this.jobs.delete(id);
    return true;
  }

  stopAll() {
    for (const id of [...this.jobs.keys()]) this.stop(id);
  }

  #snapshot(job) {
    const live = job.viewers.reduce((total, viewer) => total + (viewer.joined ? 1 : 0), 0);
    return {
      id: job.id,
      platform: job.platform,
      platformName: job.platformName,
      hub: job.hub,
      url: job.hub,
      target: job.target,
      launched: job.launched,
      live,
      joined: job.joined,
      drops: job.drops,
      errors: job.errors,
      count: job.count,
      proxies: job.proxies.length,
      startedAt: job.startedAt,
      uptimeSeconds: Math.floor((Date.now() - job.startedAt) / 1000),
    };
  }

  status() {
    return [...this.jobs.values()].map((job) => this.#snapshot(job));
  }

  // số người xem server đang báo cho group, đọc thẳng từ API chi tiết
  async viewerCount(platformId, hub) {
    const platform = resolvePlatform(platformId);
    if (!platform) throw new Error("Nền tảng không hợp lệ");
    const room = String(hub || "").trim();
    if (!room) throw new Error("Thiếu mã phòng");

    if (platform.kind === "http") {
      const [matchId, profileId] = room.split(":");
      if (!matchId || !profileId) throw new Error("Cần dạng matchId:profileId");
      const response = await fetch(
        `${platform.apiBase}/v1/schedules/match/${matchId}/${profileId}?language=vi`,
        { headers: { Origin: platform.origin, Referer: `${platform.origin}/`, "User-Agent": USER_AGENTS[0] } },
      );
      if (!response.ok) throw new Error(`API trả về ${response.status}`);
      const payload = await response.json();
      const broadcaster = payload?.result?.broadcasters || {};
      return {
        hub: room,
        platform: platform.id,
        viewer: Number(broadcaster.views) || 0,
        isStreaming: Boolean(broadcaster.is_live),
        title: payload?.result?.match?.name || "",
      };
    }

    const response = await fetch(`${platform.apiBase}/livestreams/detail/${encodeURIComponent(room)}`, {
      headers: { Origin: platform.origin, "User-Agent": USER_AGENTS[0], Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`API trả về ${response.status}`);
    const payload = await response.json();
    return {
      hub: room,
      platform: platform.id,
      viewer: Number(payload?.data?.viewer) || 0,
      isStreaming: Boolean(payload?.data?.isStreaming),
      title: payload?.data?.title || "",
    };
  }

  // kiểm tra proxy: đo IP thoát thật để biết được bao nhiêu mắt khác nhau
  async checkProxies(input, { limit = 200, concurrency = 20, timeout = 8000, repeat = 0 } = {}) {
    const base = expandProxies(parseProxyList(input), Number(limit) || 200).slice(0, Number(limit) || 200);
    // proxy xoay vòng (1 dòng): đo nhiều lần để biết IP có đổi không
    const repeats = Number(repeat) || (base.length === 1 ? 10 : 1);
    const list = [];
    for (const proxy of base) for (let i = 0; i < repeats; i += 1) list.push(proxy);
    const rows = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < list.length) {
        const proxy = list[cursor++];
        const started = Date.now();
        try {
          const agent = this.#agentFor(proxy);
          const ip = await new Promise((resolve, reject) => {
            const request = https.request(
              { hostname: "api.ipify.org", path: "/?format=json", method: "GET", agent, timeout },
              (response) => {
                let body = "";
                response.on("data", (chunk) => (body += chunk));
                response.on("end", () => {
                  try {
                    resolve(String(JSON.parse(body).ip || ""));
                  } catch {
                    reject(new Error("bad response"));
                  }
                });
              },
            );
            request.on("timeout", () => request.destroy(new Error("timeout")));
            request.on("error", reject);
            request.end();
          });
          rows.push({ proxy, ip, ms: Date.now() - started, ok: Boolean(ip) });
        } catch (error) {
          rows.push({ proxy, ip: "", ms: Date.now() - started, ok: false, error: error.message });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, list.length || 1) }, worker));
    const uniqueIps = new Set(rows.filter((row) => row.ok && row.ip).map((row) => row.ip));
    return {
      checked: rows.length,
      alive: rows.filter((row) => row.ok).length,
      uniqueIps: uniqueIps.size,
      rows: rows.sort((a, b) => Number(b.ok) - Number(a.ok)),
    };
  }

  // danh sách livestream đang có trên trang chủ của site
  async listStreams(platformId) {
    const platform = resolvePlatform(platformId);
    if (!platform) throw new Error("Nền tảng không hợp lệ");

    if (platform.kind === "http") {
      const response = await fetch(`${platform.apiBase}/v2/schedules/live/list/1?limit=50&language=vi`, {
        headers: { Origin: platform.origin, Referer: `${platform.origin}/`, "User-Agent": USER_AGENTS[0] },
      });
      if (!response.ok) throw new Error(`API trả về ${response.status}`);
      const payload = await response.json();
      const rows = payload?.collections?.live || [];
      return rows.map((row) => {
        const broadcaster = row.broadcasters || {};
        return {
          hub: `${row.match_id}:${broadcaster.profile_id}`,
          name: broadcaster.nickname || row.match_id,
          isStreaming: Boolean(broadcaster.is_live),
          followers: Number(broadcaster.followers) || 0,
          thumbnail: broadcaster.cover || "",
        };
      });
    }

    const response = await fetch(`${platform.apiBase}/livestreams/hot`, {
      headers: { Origin: platform.origin, "User-Agent": USER_AGENTS[0], Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`API trả về ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return rows.map((row) => ({
      hub: row.streamId,
      name: row.displayName || row.streamId,
      isStreaming: Boolean(row.isStreaming),
      followers: Number(row.followers) || 0,
      thumbnail: row.thumbnail || "",
    }));
  }
}
