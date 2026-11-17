// Chọn chạy job ở đâu: máy chính, một hub cụ thể, hay chia đều cho các hub đang online.
import { parseProxyList } from "./manager.js";

export class Deployments {
  constructor({ viewbot, hubs }) {
    this.viewbot = viewbot;
    this.hubs = hubs;
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

  start(input) {
    const proxyList = parseProxyList(input.proxies || "");
    input = { ...input, proxyList };
    const bots = Math.max(1, Number(input.bots) || 50);

    // danh sách máy: "main" hoặc id hub; "auto" = mọi hub online
    let targets = Array.isArray(input.targets) && input.targets.length ? [...input.targets] : [String(input.target || "main")];
    targets = [...new Set(targets.map((item) => String(item)))];

    if (targets.includes("auto")) {
      const online = this.hubs.onlineHubs().map((hub) => hub.id);
      targets = targets.filter((item) => item !== "auto").concat(online);
      if (!targets.length) targets = ["main"];
      targets = [...new Set(targets)];
    }

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
    if (target === "main" || target === "local") {
      return { jobs: [this.#local({ ...input, bots })], mode: "main" };
    }

    if (target === "auto") {
      const online = this.hubs.onlineHubs();
      if (!online.length) {
        return { jobs: [this.#local(input)], mode: "main", note: "Không có hub online — chạy trên máy chính." };
      }
      const per = Math.max(1, Math.ceil(bots / online.length));
      const jobs = online.map((hub) =>
        this.hubs.startJob(hub.id, {
          platform: input.platform,
          room: input.hub || input.room,
          bots: per,
          ramp: Math.max(1, Math.round((Number(input.ramp) || 5) / online.length)),
          proxies: input.proxyList || [],
          label: input.label,
        }),
      );
      return { jobs, mode: "auto", note: `Chia ${per} mắt cho ${online.length} hub.` };
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

  status() {
    const local = this.viewbot.status().map((job) => ({ ...job, kind: "local", hubName: "Máy chính", state: "running" }));
    return [...local, ...this.hubs.jobs()];
  }

  stop(id) {
    const value = String(id || "");
    if (value.startsWith("hub_")) {
      const hubId = value.slice(0, value.indexOf(":"));
      return this.hubs.stopJob(hubId, value);
    }
    return this.viewbot.stop(value);
  }

  stopAll() {
    this.viewbot.stopAll();
    this.hubs.stopAllJobs();
  }
}
