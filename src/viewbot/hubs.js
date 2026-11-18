// Quản lý các máy phụ (hub) chạy tăng mắt từ xa.
// Master giữ registry hub + token, mở WebSocket /api/hubs/ws để hub kết nối vào,
// đẩy job xuống hub và nhận lại số liệu từng giây.
import crypto from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { WebSocketServer } from "ws";

const HEARTBEAT_TIMEOUT = 45000;
const PROTOCOL_VERSION = 1;

export function hubInstallScripts({ baseUrl, token, name }) {
  const sh = `curl -fsSL "${baseUrl}/api/hubs/install.sh?token=${token}&name=${encodeURIComponent(name)}" | sh`;
  const ps = `irm "${baseUrl}/api/hubs/install.ps1?token=${token}&name=${encodeURIComponent(name)}" | iex`;
  return { sh, ps };
}

export class HubManager {
  #file;
  #hubs = new Map();
  #wss = null;
  #heartbeat = null;
  #listeners = new Set();
  #telegramListeners = new Set();

  constructor({ dataDirectory }) {
    this.#file = join(dataDirectory, "hubs.json");
  }

  async init() {
    await mkdir(dirname(this.#file), { recursive: true });
    try {
      const raw = JSON.parse(await readFile(this.#file, "utf8"));
      for (const hub of raw?.hubs || []) {
        if (!hub?.id || !hub?.token) continue;
        this.#hubs.set(hub.id, {
          id: hub.id,
          name: hub.name || hub.id,
          token: hub.token,
          createdAt: hub.createdAt || Date.now(),
          online: false,
          socket: null,
          lastSeen: 0,
          stats: null,
          jobs: new Map(),
        });
      }
    } catch {
      // chưa có file, bắt đầu rỗng
    }
  }

  async #persist() {
    const hubs = [...this.#hubs.values()].map(({ id, name, token, createdAt }) => ({ id, name, token, createdAt }));
    await writeFile(this.#file, `${JSON.stringify({ hubs }, null, 2)}\n`, "utf8");
  }

  onChange(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onTelegramEvent(listener) {
    this.#telegramListeners.add(listener);
    return () => this.#telegramListeners.delete(listener);
  }

  #emitTelegram(hub, event) {
    for (const listener of this.#telegramListeners) {
      try {
        listener(hub.id, event);
      } catch {
        // bỏ qua listener lỗi
      }
    }
  }

  #emit() {
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        // listener lỗi thì bỏ qua, không làm sập hub
      }
    }
  }

  list() {
    return [...this.#hubs.values()].map((hub) => ({
      id: hub.id,
      name: hub.name,
      online: hub.online,
      lastSeen: hub.lastSeen,
      stats: hub.stats,
      jobs: [...hub.jobs.values()],
      tokenHint: `${hub.token.slice(0, 6)}…${hub.token.slice(-4)}`,
      createdAt: hub.createdAt,
    }));
  }

  get(id) {
    return this.#hubs.get(id);
  }

  async create({ name }) {
    const id = `hub_${crypto.randomBytes(4).toString("hex")}`;
    const hub = {
      id,
      name: String(name || "").trim() || id,
      token: crypto.randomBytes(18).toString("hex"),
      createdAt: Date.now(),
      online: false,
      socket: null,
      lastSeen: 0,
      stats: null,
      jobs: new Map(),
    };
    this.#hubs.set(id, hub);
    await this.#persist();
    this.#emit();
    return { id: hub.id, name: hub.name, token: hub.token };
  }

  async rotate(id) {
    const hub = this.#hubs.get(id);
    if (!hub) throw new Error("Hub không tồn tại");
    hub.token = crypto.randomBytes(18).toString("hex");
    await this.#persist();
    hub.socket?.close(4001, "token rotated");
    this.#emit();
    return { id: hub.id, token: hub.token };
  }

  async remove(id) {
    const hub = this.#hubs.get(id);
    if (!hub) return false;
    for (const job of hub.jobs.values()) this.stopJob(id, job.id);
    hub.socket?.close(4002, "hub removed");
    this.#hubs.delete(id);
    await this.#persist();
    this.#emit();
    return true;
  }

  hasToken(token) {
    return Boolean(token) && Boolean(this.#findByToken(token));
  }

  #findByToken(token) {
    for (const hub of this.#hubs.values()) if (hub.token === token) return hub;
    return null;
  }

  attach(server) {
    this.#wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", (request, socket, head) => {
      let url;
      try {
        url = new URL(request.url, "http://localhost");
      } catch {
        return;
      }
      if (url.pathname !== "/api/hubs/ws") return;
      const token = url.searchParams.get("token") || "";
      const hub = this.#findByToken(token);
      if (!hub) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }
      this.#wss.handleUpgrade(request, socket, head, (ws) => this.#accept(hub, ws));
    });
    this.#heartbeat = setInterval(() => {
      const now = Date.now();
      for (const hub of this.#hubs.values()) {
        if (hub.online && now - hub.lastSeen > HEARTBEAT_TIMEOUT) {
          hub.socket?.terminate();
          this.#markOffline(hub);
        }
      }
    }, 15000);
    this.#heartbeat.unref?.();
    return this;
  }

  #accept(hub, ws) {
    hub.socket?.close(4000, "replaced");
    hub.socket = ws;
    hub.online = true;
    hub.lastSeen = Date.now();
    ws.send(JSON.stringify({ type: "welcome", hubId: hub.id, version: PROTOCOL_VERSION }));
    this.#emit();

    ws.on("message", (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      hub.lastSeen = Date.now();
      this.#handle(hub, message);
    });

    ws.on("close", () => {
      if (hub.socket === ws) this.#markOffline(hub);
    });
    ws.on("error", () => {
      if (hub.socket === ws) this.#markOffline(hub);
    });
  }

  #markOffline(hub) {
    hub.online = false;
    hub.socket = null;
    for (const job of hub.jobs.values()) job.state = "offline";
    if (hub.telegram?.running) {
      hub.telegram.running = false;
      hub.telegram.lastError = "Máy phụ mất kết nối";
      this.#emitTelegram(hub, { event: "done" });
    }
    this.#emit();
  }

  #handle(hub, message) {
    switch (message.type) {
      case "tg_status": {
        if (!hub.telegram) hub.telegram = { running: false, joined: 0, errors: 0, target: 0, link: "", startedAt: 0 };
        const event = message.event || {};
        if (event.event === "stats") {
          if (event.joined != null) hub.telegram.joined = Number(event.joined);
          if (event.target != null) hub.telegram.target = Number(event.target);
          hub.telegram.errors = Number(event.errors) || hub.telegram.errors || 0;
        } else if (event.event === "participants") {
          hub.telegram.participants = Number(event.count) || 0;
        } else if (event.event === "done") {
          hub.telegram.running = false;
        } else if (event.event === "error") {
          hub.telegram.errors = (hub.telegram.errors || 0) + 1;
          hub.telegram.lastError = String(event.error || "").slice(0, 200);
        }
        this.#emitTelegram(hub, event);
        this.#emit();
        break;
      }
      case "tg_error": {
        if (!hub.telegram) hub.telegram = { running: false, joined: 0, errors: 0, target: 0, link: "", startedAt: 0 };
        hub.telegram.errors = (hub.telegram.errors || 0) + 1;
        hub.telegram.lastError = String(message.error || "").slice(0, 200);
        hub.telegram.running = false;
        this.#emit();
        break;
      }
      case "hello":
        hub.name = String(message.name || hub.name).slice(0, 60);
        hub.stats = {
          ...hub.stats,
          version: message.version || "",
          node: message.node || "",
          platform: message.platform || "",
          cpu: message.cpu ?? null,
          telegram: Boolean(message.telegram),
          telegramNote: String(message.telegramNote || "").slice(0, 200),
        };
        void this.#persist();
        this.#emit();
        break;
      case "caps":
        hub.stats = {
          ...(hub.stats || {}),
          telegram: Boolean(message.telegram),
          telegramNote: String(message.telegramNote || "").slice(0, 200),
        };
        this.#emit();
        break;
      case "stats":
        hub.stats = {
          ...(hub.stats || {}),
          rss: message.rss ?? null,
          cpu: message.cpu ?? null,
          load: message.load ?? null,
          sockets: message.sockets ?? null,
        };
        this.#emit();
        break;
      case "job_status": {
        const job = hub.jobs.get(message.id);
        if (job) {
          Object.assign(job, {
            live: message.live ?? job.live,
            launched: message.launched ?? job.launched,
            joined: message.joined ?? job.joined,
            drops: message.drops ?? job.drops,
            errors: message.errors ?? job.errors,
            count: message.count ?? job.count,
            state: "running",
          });
          this.#emit();
        }
        break;
      }
      case "job_done": {
        hub.jobs.delete(message.id);
        this.#emit();
        break;
      }
      default:
        break;
    }
  }

  startJob(hubId, { platform, room, bots, ramp, proxies, label }) {
    const hub = this.#hubs.get(hubId);
    if (!hub) throw new Error("Hub không tồn tại");
    if (!hub.online || !hub.socket) throw new Error(`Hub ${hub.name} đang offline`);
    const id = `${hubId}:${platform}:${room}`;
    const job = {
      id,
      hubId,
      hubName: hub.name,
      kind: "remote",
      platform,
      hub: room,
      label: label || room,
      target: bots,
      bots,
      ramp,
      proxies: Array.isArray(proxies) ? proxies.length : 0,
      launched: 0,
      live: 0,
      joined: 0,
      drops: 0,
      errors: 0,
      count: null,
      state: "starting",
      startedAt: Date.now(),
    };
    hub.jobs.set(id, job);
    hub.socket.send(
      JSON.stringify({
        type: "job_start",
        id,
        platform,
        room,
        bots,
        ramp,
        proxies: proxies || [],
      }),
    );
    this.#emit();
    return job;
  }

  stopJob(hubId, jobId) {
    const hub = this.#hubs.get(hubId);
    if (!hub) return false;
    const existing = hub.jobs.get(jobId);
    hub.jobs.delete(jobId);
    try {
      hub.socket?.send(JSON.stringify({ type: "job_stop", id: jobId }));
    } catch {
      // hub đã rớt
    }
    this.#emit();
    return Boolean(existing);
  }

  startTelegramJob(hubId, { link, phones, folders, target, concurrency = 10, delayMin = 4, delayMax = 20, proxies = {}, proxyCount = 0 }) {
    const hub = this.#hubs.get(hubId);
    if (!hub) throw new Error("Hub không tồn tại");
    if (!hub.online || !hub.socket) throw new Error(`Hub ${hub.name} đang offline`);
    if (!hub.stats?.telegram) {
      const note = hub.stats?.telegramNote ? ` (${hub.stats.telegramNote})` : "";
      throw new Error(`Hub ${hub.name} chưa sẵn sàng cho Telegram${note}. Nếu hub chạy bản agent cũ, chạy lại lệnh cài hub ở màn Máy phụ.`);
    }
    const id = `tg:${hubId}`;
    const total = phones.length;
    hub.telegram = {
      running: true,
      link,
      joined: 0,
      target: Math.min(Number(target) || total, total),
      total,
      phones: [...phones],
      proxies: proxyCount,
      participants: null,
      errors: 0,
      lastError: "",
      startedAt: Date.now(),
    };
    hub.socket.send(
      JSON.stringify({
        type: "tg_start",
        id,
        link,
        phones: folders || phones,
        target: hub.telegram.target,
        concurrency,
        delayMin,
        delayMax,
        proxies,
      }),
    );
    this.#emit();
    return hub.telegram;
  }

  adjustTelegram(hubId, target) {
    const hub = this.#hubs.get(hubId);
    if (!hub || !hub.telegram?.running) throw new Error("Hub chưa chạy phiên Telegram nào");
    hub.telegram.target = Math.max(0, Math.min(hub.telegram.total || Infinity, Number(target) || 0));
    hub.socket?.send(JSON.stringify({ type: "tg_adjust", target: hub.telegram.target }));
    this.#emit();
    return hub.telegram.target;
  }

  stopTelegramJob(hubId) {
    const hub = this.#hubs.get(hubId);
    if (!hub) return false;
    try {
      hub.socket?.send(JSON.stringify({ type: "tg_stop" }));
    } catch {
      // hub đã rớt
    }
    if (hub.telegram) hub.telegram.running = false;
    this.#emit();
    return true;
  }

  telegramStates() {
    return [...this.#hubs.values()]
      .filter((hub) => hub.telegram)
      .map((hub) => ({ hubId: hub.id, hubName: hub.name, online: hub.online, ...hub.telegram }));
  }

  stopAllJobs() {
    for (const hub of this.#hubs.values()) {
      for (const id of [...hub.jobs.keys()]) this.stopJob(hub.id, id);
    }
  }

  jobs() {
    const rows = [];
    for (const hub of this.#hubs.values()) {
      for (const job of hub.jobs.values()) {
        rows.push({
          ...job,
          uptimeSeconds: Math.floor((Date.now() - job.startedAt) / 1000),
          hubOnline: hub.online,
        });
      }
    }
    return rows;
  }

  onlineHubs() {
    return [...this.#hubs.values()].filter((hub) => hub.online && hub.socket);
  }

  close() {
    clearInterval(this.#heartbeat);
    for (const hub of this.#hubs.values()) hub.socket?.close(1001, "server shutdown");
    this.#wss?.close();
  }
}
