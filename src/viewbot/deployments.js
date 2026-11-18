// Chọn chạy job ở đâu: máy chính, một hub cụ thể, hay chia đều cho các hub đang online.
// Telegram dùng chung luồng này: mỗi máy nhận một phần tài khoản + proxy.
import { parseProxyList } from "./manager.js";
import { buildProxyMap } from "../telegram/manager.js";

const TELEGRAM = "telegram";

export class Deployments {
  constructor({ viewbot, hubs, telegram = null }) {
    this.viewbot = viewbot;
    this.hubs = hubs;
    this.telegram = telegram;
    if (telegram) {
      hubs.onTelegramEvent((hubId, event) => {
        telegram.ingestRemoteEvent(event);
        if (event.event === "done") telegram.setRemotePhones(hubId, null);
      });
    }
  }

  #local(input) {
    const job = this.viewbot.start(input);
    return { ...job, kind: "local", hubName: "Máy chính", state: "running" };
  }

  // chia số mắt cho nhiều máy, phần dư dồn về máy đầu
  static #split(bots, count) {
    const base = Math.floor(bots / count);
    const rest = bots % count;
    return Array.from({ length: count }, (_, index) => base + (index < rest ? 1 : 0));
  }

  #resolveTargets(input) {
    let targets = Array.isArray(input.targets) && input.targets.length ? [...input.targets] : [String(input.target || "main")];
    targets = [...new Set(targets.map((item) => String(item === "local" ? "main" : item)))];
    if (targets.includes("auto")) {
      const online = this.hubs.onlineHubs().map((hub) => hub.id);
      targets = targets.filter((item) => item !== "auto").concat(online);
      if (!targets.length) targets = ["main"];
      targets = [...new Set(targets)];
    }
    return targets;
  }

  async start(input) {
    if (input.platform === TELEGRAM) return this.#startTelegram(input);
    const proxyList = parseProxyList(input.proxies || "");
    input = { ...input, proxyList };
    const bots = Math.max(1, Number(input.bots) || 50);
    const targets = this.#resolveTargets(input);

    if (targets.length === 1) return this.#startOne(targets[0], input, bots);

    // nhiều máy: chia đều, mỗi máy một job riêng
    const shares = Deployments.#split(bots, targets.length);
    const jobs = [];
    const notes = [];
    targets.forEach((target, index) => {
      const shareBots = shares[index];
      if (shareBots <= 0) return;
      try {
        const part = this.#startOne(target, { ...input, bots: shareBots, ramp: Math.max(1, Math.round((Number(input.ramp) || 5) / targets.length)) }, shareBots);
        jobs.push(...part.jobs);
      } catch (error) {
        notes.push(`${target}: ${error.message}`);
      }
    });
    if (!jobs.length) throw new Error(notes.join("; ") || "Không khởi động được máy nào");
    return { jobs, mode: "multi", note: `Chia ${bots} mắt cho ${targets.length} máy${notes.length ? ` (lỗi: ${notes.join("; ")})` : ""}.` };
  }

  #startOne(target, input, bots) {
    if (target === "main") {
      return { jobs: [this.#local({ ...input, bots })], mode: "main" };
    }
    const job = this.hubs.startJob(target, {
      platform: input.platform,
      room: input.hub || input.room,
      bots,
      ramp: Number(input.ramp) || 5,
      proxies: input.proxyList || [],
      label: input.label,
    });
    return { jobs: [job], mode: "hub" };
  }

  /* ---------- Telegram ---------- */

  async #startTelegram(input) {
    const telegram = this.telegram;
    if (!telegram) throw new Error("Chưa bật module Telegram");
    const link = String(input.url || input.hub || "").trim();
    if (!link) throw new Error("Thiếu link livestream Telegram");
    const bots = Math.max(1, Number(input.bots) || 20);
    let targets = this.#resolveTargets(input);
    const safety = {
      dailyLimit: numberOr(input.dailyLimit, 3),
      minAgeDays: numberOr(input.minAgeDays, 7),
      delayMin: numberOr(input.delayMin, 4),
      delayMax: numberOr(input.delayMax, 20),
      concurrency: Math.max(1, Number(input.concurrency) || 10),
    };

    // máy đang có phiên Telegram sẽ được thay bằng phiên mới (giống Mắt xem)
    for (const target of targets) this.#stopTelegram(target);

    const picked = telegram.pickPhones({
      dailyLimit: safety.dailyLimit,
      minAgeDays: safety.minAgeDays,
      limit: bots,
      exclude: telegram.busyPhones(),
    });
    if (!picked.phones.length) {
      const s = picked.skipped || {};
      throw new Error(
        `Không còn tài khoản Telegram an toàn (quá mới: ${s.young || 0}, hết lượt hôm nay: ${s.quota || 0}, cooldown: ${s.cooldown || 0}, đang bận: ${s.busy || 0}, thiếu session: ${s.nosession || 0}).`,
      );
    }
    const phones = picked.phones;
    targets = targets.slice(0, phones.length);
    const shares = Deployments.#split(phones.length, targets.length);
    const proxyText = String(input.proxies || "");
    const jobs = [];
    const notes = [];
    let cursor = 0;
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const part = phones.slice(cursor, cursor + shares[index]);
      cursor += shares[index];
      if (!part.length) continue;
      try {
        if (target === "main") {
          await telegram.start({ link, phones: part, target: part.length, proxies: proxyText, ...safety });
        } else {
          const proxyMap = buildProxyMap(part, proxyText);
          const folders = telegram.folderNames(part);
          const keyed = {};
          part.forEach((phone, i) => {
            if (!proxyMap[phone]) return;
            keyed[phone] = proxyMap[phone];
            keyed[folders[i]] = proxyMap[phone];
          });
          this.hubs.startTelegramJob(target, {
            link,
            phones: part,
            folders,
            target: part.length,
            concurrency: safety.concurrency,
            delayMin: safety.delayMin,
            delayMax: safety.delayMax,
            proxies: keyed,
            proxyCount: new Set(Object.values(proxyMap)).size,
          });
          telegram.setRemotePhones(target, part);
        }
        jobs.push(...this.#telegramJobs().filter((job) => job.machine === target));
      } catch (error) {
        notes.push(`${this.#machineName(target)}: ${error.message}`);
      }
    }
    if (!jobs.length) throw new Error(notes.join("; ") || "Không khởi động được máy nào");
    const short = phones.length < bots ? ` (chỉ còn ${phones.length}/${bots} acc đủ điều kiện)` : "";
    const note = `${targets.length > 1 ? `Chia ${phones.length} acc cho ${jobs.length} máy` : `${phones.length} acc`}${short}${notes.length ? ` — lỗi: ${notes.join("; ")}` : ""}.`;
    return { jobs, mode: targets.length > 1 ? "multi" : targets[0] === "main" ? "main" : "hub", note };
  }

  #machineName(target) {
    if (target === "main") return "Máy chính";
    return this.hubs.get(target)?.name || target;
  }

  #stopTelegram(target) {
    if (!this.telegram) return false;
    if (target === "main") return this.telegram.stopView();
    this.telegram.setRemotePhones(target, null);
    return this.hubs.stopTelegramJob(target);
  }

  #telegramJobs() {
    if (!this.telegram) return [];
    const rows = [];
    const local = this.telegram.status();
    if (local.running) {
      rows.push({
        id: "tg:main",
        machine: "main",
        kind: "local",
        hubName: "Máy chính",
        platform: TELEGRAM,
        platformName: "Telegram",
        hub: local.link,
        url: local.link,
        target: local.target || 0,
        total: local.assigned || 0,
        launched: local.assigned || 0,
        live: local.joined || 0,
        joined: local.joined || 0,
        drops: 0,
        errors: local.errors || 0,
        count: local.participants,
        proxies: local.proxies || 0,
        lastError: local.lastError || "",
        accounts: local.accounts || [],
        state: "running",
        startedAt: local.startedAt,
        uptimeSeconds: Math.floor((Date.now() - (local.startedAt || Date.now())) / 1000),
      });
    }
    for (const row of this.hubs.telegramStates()) {
      if (!row.running) continue;
      rows.push({
        id: `tg:${row.hubId}`,
        machine: row.hubId,
        kind: "remote",
        hubName: row.hubName,
        hubOnline: row.online,
        platform: TELEGRAM,
        platformName: "Telegram",
        hub: row.link,
        url: row.link,
        target: row.target || 0,
        total: row.total || 0,
        launched: row.total || 0,
        live: row.joined || 0,
        joined: row.joined || 0,
        drops: 0,
        errors: row.errors || 0,
        count: row.participants ?? null,
        proxies: row.proxies || 0,
        lastError: row.lastError || "",
        accounts: [],
        state: row.online ? "running" : "offline",
        startedAt: row.startedAt,
        uptimeSeconds: Math.floor((Date.now() - (row.startedAt || Date.now())) / 1000),
      });
    }
    return rows;
  }

  adjust(id, target) {
    const value = String(id || "");
    if (!value.startsWith("tg:")) throw new Error("Chỉ phiên Telegram mới đổi số mắt khi đang chạy được.");
    const machine = value.slice(3);
    if (machine === "main") return this.telegram.adjust(target);
    return this.hubs.adjustTelegram(machine, target);
  }

  hasRunning() {
    if (this.viewbot.jobs.size) return true;
    if (this.telegram?.status().running) return true;
    return this.hubs.telegramStates().some((row) => row.running) || this.hubs.jobs().length > 0;
  }

  status() {
    const local = this.viewbot.status().map((job) => ({ ...job, kind: "local", hubName: "Máy chính", state: "running" }));
    return [...local, ...this.hubs.jobs(), ...this.#telegramJobs()];
  }

  stop(id) {
    const value = String(id || "");
    if (value.startsWith("tg:")) return this.#stopTelegram(value.slice(3));
    if (value.startsWith("hub_")) {
      const hubId = value.slice(0, value.indexOf(":"));
      return this.hubs.stopJob(hubId, value);
    }
    return this.viewbot.stop(value);
  }

  stopAll() {
    this.viewbot.stopAll();
    this.hubs.stopAllJobs();
    if (this.telegram) {
      this.telegram.stopView();
      for (const row of this.hubs.telegramStates()) if (row.running) this.#stopTelegram(row.hubId);
    }
  }
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && value !== "" && value !== null && value !== undefined ? number : fallback;
}

