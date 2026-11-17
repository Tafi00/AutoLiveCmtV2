// Mắt xem cho coichua.com — cơ chế HTTP, không phải socket.
// Trang phòng gọi: GET /v1/members/fingerprint (đặt cookie) rồi
// GET /v1/schedules/broadcaster/watch/<match_id>/<profile_id> mỗi 3 phút.
// Server đếm view theo fingerprint + IP, nên mỗi proxy = 1 mắt thật.
import https from "node:https";
import http from "node:http";
import crypto from "node:crypto";

const WATCH_INTERVAL_MS = 180000; // 3 phút, khớp interval của trang thật
const RETRY_MS = 30000;

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString("hex");
}

// GET đơn giản, giữ cookie thủ công để mỗi mắt là một phiên riêng
function get(url, { agent, headers = {}, jar }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === "http:" ? http : https;
    const cookie = jar.cookies ? Object.entries(jar.cookies).map(([k, v]) => `${k}=${v}`).join("; ") : "";
    const request = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === "http:" ? 80 : 443),
        path: target.pathname + target.search,
        method: "GET",
        agent,
        headers: {
          Accept: "application/json, text/plain, */*",
          ...(cookie ? { Cookie: cookie } : {}),
          ...headers,
        },
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () => {
          for (const raw of response.headers["set-cookie"] || []) {
            const [pair] = raw.split(";");
            const index = pair.indexOf("=");
            if (index > 0) jar.cookies[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
          }
          let parsed = null;
          try {
            parsed = JSON.parse(body);
          } catch {
            // response không phải JSON, caller tự xử lý
          }
          resolve({ status: response.statusCode, body: parsed, raw: body });
        });
      },
    );
    request.setTimeout(15000, () => request.destroy(new Error("request timeout")));
    request.on("error", reject);
    request.end();
  });
}

export class HttpViewer {
  #config;
  #joined = false;
  #stopped = false;
  #watchTimer = null;
  #joinTimer = null;
  #hooks;

  constructor({ platform, hub, userAgent, agent, onJoin, onDrop, onCount, onError }) {
    this.#config = { platform, hub, userAgent, agent };
    this.#hooks = { onJoin, onDrop, onCount, onError };
    this.jar = { cookies: {} };
    // hub dạng "matchId:profileId"
    const [matchId, profileId] = String(hub).split(":");
    this.matchId = matchId;
    this.profileId = profileId;
  }

  get connected() {
    return this.#joined;
  }

  get joined() {
    return this.#joined;
  }

  start() {
    this.#stopped = false;
    void this.#run();
    return this;
  }

  stop() {
    this.#stopped = true;
    clearInterval(this.#watchTimer);
    clearInterval(this.#joinTimer);
    if (this.#joined) {
      this.#joined = false;
      this.#hooks.onDrop?.(this);
    }
  }

  #headers() {
    return {
      Origin: this.#config.platform.origin,
      Referer: `${this.#config.platform.origin}/d/Room/${this.matchId}/${this.profileId}`,
      "User-Agent": this.#config.userAgent,
    };
  }

  async #run() {
    const api = this.#config.platform.apiBase;
    const agent = this.#config.agent;

    while (!this.#stopped) {
      try {
        // fingerprint đặt cookie AWSALB + định danh phiên
        await get(`${api}/v1/members/fingerprint`, { agent, headers: this.#headers(), jar: this.jar });
        const ok = await this.#watch();
        if (!ok) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
          continue;
        }
        break;
      } catch (error) {
        this.#hooks.onError?.(error);
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
      }
    }
    if (this.#stopped) return;

    this.#watchTimer = setInterval(() => {
      if (this.#stopped) return;
      void this.#watch();
    }, WATCH_INTERVAL_MS + Math.floor(Math.random() * 15000));
    this.#watchTimer.unref?.();

    // đọc số mắt server báo để hiển thị trên dashboard
    this.#joinTimer = setInterval(() => {
      if (this.#stopped) return;
      void this.#pollViews();
    }, 45000);
    this.#joinTimer.unref?.();
    void this.#pollViews();
  }

  async #watch() {
    const api = this.#config.platform.apiBase;
    try {
      const response = await get(`${api}/v1/schedules/broadcaster/watch/${this.matchId}/${this.profileId}`, {
        agent: this.#config.agent,
        headers: this.#headers(),
        jar: this.jar,
      });
      if (response.status !== 200) {
        // 403 = WAF chặn IP (thường là proxy datacenter) — không tính là đã vào phòng
        this.#hooks.onError?.(new Error(`watch ${response.status}`));
        return false;
      }
      if (!this.#joined) {
        this.#joined = true;
        this.#hooks.onJoin?.(this);
      }
      return true;
    } catch (error) {
      this.#hooks.onError?.(error);
      return false;
    }
  }

  async #pollViews() {
    const api = this.#config.platform.apiBase;
    try {
      const response = await get(
        `${api}/v1/schedules/match/${this.matchId}/${this.profileId}?language=vi`,
        { agent: this.#config.agent, headers: this.#headers(), jar: this.jar },
      );
      const views = response.body?.result?.broadcasters?.views;
      if (Number.isFinite(Number(views))) this.#hooks.onCount?.(Number(views));
    } catch {
      // lỗi mạng lúc poll không ảnh hưởng tới watch
    }
  }
}

export const randomViewerTag = () => randomHex(8);
