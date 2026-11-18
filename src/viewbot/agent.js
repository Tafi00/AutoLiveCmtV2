#!/usr/bin/env node
// Runtime cho máy phụ (hub). Máy này chỉ mở socket tăng mắt, không cần data nền.
//   node agent.js --master http://192.168.1.10:4317 --token <hub-token> [--name may-2]
// Master đẩy job xuống qua WebSocket /api/hubs/ws.
import os from "node:os";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { ViewbotManager } from "./src/viewbot/manager.js";

const args = (() => {
  const out = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith("--")) {
      out[key] = value;
      i += 1;
    } else out[key] = true;
  }
  return out;
})();

const MASTER = String(args.master || "").replace(/\/$/, "");
const TOKEN = String(args.token || "");
const NAME = String(args.name || os.hostname());
if (!MASTER || !TOKEN) {
  console.error("Thiếu --master hoặc --token. Ví dụ: node agent.js --master http://1.2.3.4:4317 --token abc");
  process.exit(1);
}

const manager = new ViewbotManager();

// ---- Telegram runner (cần python + telethon trên máy hub) ----
const TELEGRAM_PY = (() => {
  const candidates = [process.env.TELEGRAM_PYTHON, "python3", "python"].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-c", "import telethon"], { timeout: 6000 });
    if (probe.status === 0) return candidate;
  }
  return "";
})();
let tgProcess = null;
let tgJob = null;
const localJobs = new Map(); // jobId (master) -> jobId (local manager)
let socket = null;
let attempt = 0;
let closed = false;

function wsUrl() {
  const base = MASTER.replace(/^http/, "ws");
  return `${base}/api/hubs/ws?token=${encodeURIComponent(TOKEN)}`;
}

function send(message) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function totals() {
  let live = 0;
  let sockets = 0;
  for (const job of manager.status()) {
    live += job.live;
    sockets += job.live;
  }
  return { live, sockets };
}

function connect() {
  socket = new WebSocket(wsUrl(), { perMessageDeflate: false });

  socket.on("open", () => {
    attempt = 0;
    console.log(`[hub] kết nối master ${MASTER}`);
    send({
      type: "hello",
      name: NAME,
      version: "1.0.0",
      node: process.version,
      platform: `${os.platform()} ${os.arch()}`,
      cpu: os.cpus()?.length || 0,
      telegram: Boolean(TELEGRAM_PY),
    });
  });

  socket.on("message", (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (message.type === "job_start") startJob(message);
    else if (message.type === "job_stop") stopJob(message.id);
    else if (message.type === "tg_start") startTelegramJob(message);
    else if (message.type === "tg_adjust") adjustTelegram(message.target);
    else if (message.type === "tg_stop") stopTelegram();
  });

  socket.on("close", () => {
    if (closed) return;
    for (const [remoteId, localId] of localJobs) {
      manager.stop(localId);
      localJobs.delete(remoteId);
    }
    attempt = Math.min(attempt + 1, 7);
    const delay = Math.min(30000, 1000 * 2 ** attempt) + Math.random() * 1000;
    console.log(`[hub] mất kết nối master — thử lại sau ${Math.round(delay / 1000)}s`);
    // timer này phải giữ process sống, nếu unref thì agent tự thoát khi rớt mạng
    setTimeout(connect, delay);
  });

  socket.on("error", () => {
    // để sự kiện close lo phần reconnect
  });
}

function startJob(message) {
  const { id, platform, room, bots, ramp, proxies } = message;
  if (localJobs.has(id)) manager.stop(localJobs.get(id));
  try {
    const job = manager.start({
      platform,
      hub: room,
      bots,
      ramp,
      proxies: Array.isArray(proxies) ? proxies.join("\n") : proxies || "",
    });
    localJobs.set(id, job.id);
    console.log(`[hub] nhận job ${id} → ${job.target} mắt`);
  } catch (error) {
    send({ type: "job_done", id, error: error.message });
  }
}

function stopJob(id) {
  const localId = localJobs.get(id);
  if (localId) manager.stop(localId);
  localJobs.delete(id);
  send({ type: "job_done", id });
}

async function startTelegramJob(message) {
  stopTelegram();
  if (!TELEGRAM_PY) {
    send({ type: "tg_error", error: "Hub chưa có python + telethon (pip install telethon)" });
    return;
  }
  try {
    const dir = join(os.tmpdir(), `alc-tg-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const url = `${MASTER}/api/hubs/telegram/bundle?token=${encodeURIComponent(TOKEN)}&phones=${encodeURIComponent((message.phones || []).join(","))}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`tải accounts thất bại (${response.status})`);
    const bundle = await response.json();
    for (const [name, item] of Object.entries(bundle.files || {})) {
      const target = join(dir, name);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, item.encoding === "base64" ? Buffer.from(item.data, "base64") : item.data);
    }
    const scriptPath = join(dir, "telegram_boost.py");
    writeFileSync(scriptPath, bundle.script, "utf8");
    const proxyMap = message.proxies && typeof message.proxies === "object" ? message.proxies : {};
    const proxyFile = join(dir, "proxies.json");
    if (Object.keys(proxyMap).length) writeFileSync(proxyFile, JSON.stringify(proxyMap), "utf8");
    const args = [
      scriptPath,
      "--accounts", dir,
      "--link", message.link,
      "--concurrency", String(message.concurrency || 10),
      "--phones", (message.phones || []).join(","),
      "--delay-min", String(message.delayMin || 4),
      "--delay-max", String(message.delayMax || 20),
    ];
    if (Object.keys(proxyMap).length) args.push("--proxies", proxyFile);
    const child = spawn(TELEGRAM_PY, args, { stdio: ["pipe", "pipe", "pipe"] });
    tgProcess = child;
    tgJob = message.id;
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          send({ type: "tg_status", id: message.id, event });
        } catch {
          // bỏ dòng lỗi
        }
      }
    });
    child.on("exit", () => {
      send({ type: "tg_status", id: message.id, event: { event: "done" } });
      tgProcess = null;
    });
    try {
      child.stdin.write(`${JSON.stringify({ cmd: "set", target: message.target || message.phones?.length || 1 })}\n`);
    } catch {
      // worker chưa sẵn sàng
    }
  } catch (error) {
    send({ type: "tg_error", error: String(error.message || error).slice(0, 200) });
  }
}

function adjustTelegram(target) {
  if (!tgProcess) return;
  try {
    tgProcess.stdin.write(`${JSON.stringify({ cmd: "set", target: Number(target) || 0 })}\n`);
  } catch {
    // worker đã đóng
  }
}

function stopTelegram() {
  if (!tgProcess) return;
  try {
    tgProcess.kill("SIGTERM");
  } catch {
    // đã thoát
  }
  tgProcess = null;
  tgJob = null;
}

setInterval(() => {
  const { live, sockets } = totals();
  send({
    type: "stats",
    rss: process.memoryUsage().rss,
    load: os.loadavg()?.[0] ?? null,
    sockets,
    live,
  });
  for (const [remoteId, localId] of localJobs) {
    const job = manager.status().find((row) => row.id === localId);
    if (!job) continue;
    send({
      type: "job_status",
      id: remoteId,
      live: job.live,
      launched: job.launched,
      joined: job.joined,
      drops: job.drops,
      errors: job.errors,
      count: job.count,
    });
  }
}, 2000);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  closed = true;
  stopTelegram();
  manager.stopAll();
  socket?.close(1000, "shutdown");
  setTimeout(() => process.exit(0), 300);
}

connect();
console.log(`[hub] ${NAME} sẵn sàng, master ${MASTER}`);
