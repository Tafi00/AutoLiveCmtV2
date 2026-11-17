// Tăng mắt livestream Telegram bằng bộ tài khoản Telethon.
// Node chỉ điều phối: import tài khoản, spawn worker Python, đọc JSON lines từ stdout.
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, existsSync, mkdirSync, statSync, readFileSync, cpSync, appendFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Thư mục gốc dự án (src/telegram/manager.js -> ../../)
const PROJECT_ROOT = resolve(__dirname, "..", "..");

const PY_CANDIDATES = [
  process.env.TELEGRAM_PYTHON,
  join(PROJECT_ROOT, ".venv", "bin", "python"),
  join(process.cwd(), ".venv", "bin", "python"),
  "/Users/tafi/Documents/code-tele-v4/.venv/bin/python",
  "python3",
  "python",
].filter(Boolean);

export class TelegramBoostManager {
  #dataDirectory;
  #accountsDirectory;
  #accountsCache = null;
  #child = null;
  #mode = "view";
  #viewChild = null;
  #commentChild = null;
  #viewPhones = new Set();
  #commentPhones = new Set();
  #commentOpts = null;
  #commentContinuous = false;
  #commentRoundDelay = 60;
  #commentStopped = true;
  #commentTimer = null;
  #commentState = { running: false, link: "", sent: 0, errors: 0, accounts: new Map(), startedAt: 0 };
  #state = {
    running: false,
    link: "",
    joined: 0,
    errors: 0,
    accounts: new Map(), // phone -> {state, error, name}
    startedAt: 0,
  };
  #python = "";
  #cooldownFile;
  #workerFile;
  #commentsFile;
  #comments = { messages: [] };
  #cooldown = { phones: {} };
  #safety = { dailyLimit: 3, minAgeDays: 7, delayMin: 4, delayMax: 20, concurrency: 10 };

  constructor({ dataDirectory }) {
    this.#dataDirectory = dataDirectory;
    this.#accountsDirectory = join(dataDirectory, "telegram-accounts");
    mkdirSync(this.#accountsDirectory, { recursive: true });
    this.#cooldownFile = join(dataDirectory, "telegram-cooldown.json");
    this.#commentsFile = join(dataDirectory, "telegram-comments.json");
    this.#workerFile = join(dataDirectory, "telegram-workers.json");
    this.#reapOrphans();
    try {
      const parsed = JSON.parse(readFileSync(this.#commentsFile, "utf8"));
      if (Array.isArray(parsed?.messages)) this.#comments.messages = parsed.messages.filter(Boolean);
    } catch {
      this.#comments = { messages: [] };
    }
    try {
      this.#cooldown = JSON.parse(readFileSync(this.#cooldownFile, "utf8"));
    } catch {
      this.#cooldown = { phones: {} };
    }
    if (!this.#cooldown.phones) this.#cooldown.phones = {};
  }

  commentList() {
    return this.#comments.messages;
  }

  #saveComments() {
    try {
      writeFileSync(this.#commentsFile, `${JSON.stringify(this.#comments, null, 2)}\n`, "utf8");
    } catch {
      // ghi lỗi không chặn thao tác
    }
  }

  addComments(text) {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) this.#comments.messages.push(line);
    this.#saveComments();
    return this.#comments.messages;
  }

  removeComment(index) {
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= this.#comments.messages.length) return this.#comments.messages;
    this.#comments.messages.splice(i, 1);
    this.#saveComments();
    return this.#comments.messages;
  }

  clearComments() {
    this.#comments.messages = [];
    this.#saveComments();
    return [];
  }

  shuffleComments() {
    const list = this.#comments.messages;
    for (let i = list.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    this.#saveComments();
    return list;
  }

  // worker mồ côi sau khi server restart: đọc pid đã lưu và dọn
  #reapOrphans() {
    try {
      const saved = JSON.parse(readFileSync(this.#workerFile, "utf8"));
      for (const pid of Object.values(saved || {})) {
        if (!Number.isFinite(Number(pid))) continue;
        try {
          process.kill(Number(pid), 0);
          process.kill(Number(pid), "SIGTERM");
        } catch {
          // pid không còn tồn tại
        }
      }
    } catch {
      // chưa có file
    }
    try {
      writeFileSync(this.#workerFile, "{}\n", "utf8");
    } catch {
      // bỏ qua
    }
  }

  #recordWorker(kind, pid) {
    try {
      const saved = {};
      try {
        Object.assign(saved, JSON.parse(readFileSync(this.#workerFile, "utf8")));
      } catch {
        // file chưa có
      }
      if (pid) saved[kind] = pid;
      else delete saved[kind];
      writeFileSync(this.#workerFile, `${JSON.stringify(saved)}\n`, "utf8");
    } catch {
      // không chặn phiên chạy
    }
  }

  get safety() {
    return { ...this.#safety };
  }

  setSafety(patch = {}) {
    const next = { ...this.#safety };
    for (const key of ["dailyLimit", "minAgeDays", "delayMin", "delayMax", "concurrency"]) {
      const value = Number(patch[key]);
      if (Number.isFinite(value) && value >= 0) next[key] = value;
    }
    this.#safety = next;
    return this.safety;
  }

  static #today() {
    return new Date().toISOString().slice(0, 10);
  }

  #phoneState(phone) {
    const today = TelegramBoostManager.#today();
    const state = this.#cooldown.phones[phone] || {};
    if (state.day !== today) {
      state.day = today;
      state.joins = 0;
    }
    this.#cooldown.phones[phone] = state;
    return state;
  }

  #saveCooldown() {
    try {
      writeFileSync(this.#cooldownFile, `${JSON.stringify(this.#cooldown, null, 2)}\n`, "utf8");
    } catch {
      // ghi lỗi không chặn phiên chạy
    }
  }

  #accountAgeDays(meta) {
    // hỗ trợ cả reg_time "2026-11-09" và register_time (unix giây/ms)
    const stamp = meta.reg_time || meta.regTime;
    if (typeof stamp === "string" && stamp.includes("-")) {
      const created = Date.parse(`${stamp}T00:00:00Z`);
      if (Number.isFinite(created)) return Math.floor((Date.now() - created) / 86400000);
    }
    const unix = Number(meta.register_time || meta.registerTime || 0);
    if (unix > 0) {
      const ms = unix > 1e12 ? unix : unix * 1000;
      return Math.floor((Date.now() - ms) / 86400000);
    }
    return 0; // không rõ ngày tạo -> coi như acc mới, để bộ lọc an toàn xử lý
  }

  // chọn acc đủ điều kiện, dùng cho cả chạy tại máy chính lẫn đẩy sang hub
  pickPhones({ dailyLimit = 3, minAgeDays = 7, limit = 0, quotaField = "joins", exclude } = {}) {
    const { rows, skipped } = this.#eligibleAccounts({ dailyLimit, minAgeDays, quotaField });
    const blocked = exclude instanceof Set ? exclude : new Set(exclude || []);
    const free = rows.filter((account) => !blocked.has(account.phone));
    if (blocked.size) skipped.busy = rows.length - free.length;
    const picked = Number(limit) > 0 ? free.slice(0, Number(limit)) : free;
    return { phones: picked.map((account) => account.phone), skipped, eligible: rows.length };
  }

  markJoins(phones) {
    for (const phone of phones) {
      const state = this.#phoneState(phone);
      state.joins = (state.joins || 0) + 1;
    }
    this.#saveCooldown();
  }

  #eligibleAccounts({ dailyLimit, minAgeDays, quotaField = "joins" }) {
    const now = Date.now();
    const rows = [];
    const skipped = { young: 0, quota: 0, cooldown: 0, nosession: 0 };
    for (const account of this.listAccounts()) {
      if (!account.hasSession && !account.hasJson) {
        skipped.nosession += 1;
        continue;
      }
      if (minAgeDays > 0 && account.ageDays < minAgeDays) {
        skipped.young += 1;
        continue;
      }
      if (account.dead) {
        skipped.dead = (skipped.dead || 0) + 1;
        continue;
      }
      if (account.cooldownUntil > now) {
        skipped.cooldown += 1;
        continue;
      }
      const used = quotaField === "comments" ? account.commentsToday || 0 : account.joinsToday || 0;
      if (dailyLimit > 0 && used >= dailyLimit) {
        skipped.quota += 1;
        continue;
      }
      rows.push(account);
    }
    return { rows, skipped };
  }

  get accountsDirectory() {
    return this.#accountsDirectory;
  }

  // tìm python có telethon
  python() {
    if (this.#python) return this.#python;
    const tried = [];
    for (const candidate of PY_CANDIDATES) {
      const probe = spawnSync(candidate, ["-c", "import telethon"], { timeout: 30000 });
      tried.push(`${candidate} (${probe.error ? probe.error.code || probe.error.message : "exit=" + probe.status})`);
      if (probe.status === 0) {
        this.#python = candidate;
        return candidate;
      }
    }
    throw new Error(
      `Không tìm thấy Python có telethon. Cài: ${PROJECT_ROOT}/.venv/bin/pip install telethon (hoặc đặt TELEGRAM_PYTHON). Đã thử: ${tried.join("; ")}`,
    );
  }

  // quét thư mục tài khoản: mỗi thư mục con chứa <phone>.session/.json
  listAccounts(directory = this.#accountsDirectory) {
    const cached = this.#accountsCache;
    if (cached && cached.dir === directory && Date.now() - cached.at < 3000) return cached.rows;
    if (!existsSync(directory)) return [];
    const rows = [];
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (!statSync(full).isDirectory()) continue;
      const files = readdirSync(full);
      const jsonFile = files.find((name) => name.endsWith(".json"));
      const sessionFile = files.find((name) => name.endsWith(".session"));
      if (!jsonFile && !sessionFile) continue;
      let meta = {};
      if (jsonFile) {
        try {
          meta = JSON.parse(readFileSync(join(full, jsonFile), "utf8"));
        } catch {
          meta = {};
        }
      }
      const phone = String(meta.phone || entry);
      const stored = this.#cooldown.phones[phone] || {};
      const today = TelegramBoostManager.#today();
      rows.push({
        phone,
        name: meta.first_name || meta.last_name || "",
        username: meta.username || "",
        appId: meta.app_id || null,
        device: meta.device || "",
        raw: meta,
        ageDays: this.#accountAgeDays(meta),
        joinsToday: stored.day === today ? stored.joins || 0 : 0,
        commentsToday: stored.day === today ? stored.comments || 0 : 0,
        cooldownUntil: stored.cooldownUntil || 0,
        dead: Boolean(stored.dead),
        folder: full,
        hasJson: Boolean(jsonFile),
        hasSession: Boolean(sessionFile),
      });
    }
    const sorted = rows.sort((a, b) => a.phone.localeCompare(b.phone));
    this.#accountsCache = { dir: directory, at: Date.now(), rows: sorted };
    return sorted;
  }

  // copy nguyên thư mục tài khoản vào data
  #invalidateAccounts() {
    this.#accountsCache = null;
  }

  importDirectory(directory) {
    const source = resolve(directory);
    if (!existsSync(source)) throw new Error("Thư mục không tồn tại");
    cpSync(source, this.#accountsDirectory, { recursive: true, force: true });
    this.#invalidateAccounts();
    return this.listAccounts();
  }

  async importZip(zipPath) {
    const target = this.#accountsDirectory;
    const result = spawnSync("unzip", ["-q", "-o", zipPath, "-d", target], { timeout: 120000 });
    if (result.status !== 0) {
      throw new Error(`Giải nén thất bại: ${result.stderr?.toString().slice(0, 200) || "unzip lỗi"}`);
    }
    this.#invalidateAccounts();
    return this.listAccounts();
  }

  status() {
    const accounts = this.listAccounts();
    return {
      safety: this.safety,
      skipped: this.#state.skipped || null,
      running: this.#state.running,
      link: this.#state.link,
      joined: this.#state.joined,
      errors: this.#state.errors,
      startedAt: this.#state.startedAt,
      accounts: [...this.#state.accounts.entries()].map(([phone, info]) => ({ phone, ...info })),
      target: this.#state.target || 0,
      participants: this.#state.participants ?? null,
      lastError: this.#state.lastError || "",
      total: accounts.length,
      comments: {
        running: this.#commentState.running,
        link: this.#commentState.link,
        sent: this.#commentState.sent,
        errors: this.#commentState.errors,
        startedAt: this.#commentState.startedAt,
        total: this.#commentState.total || 0,
        skipped: this.#commentState.skipped || null,
        accounts: [...this.#commentState.accounts.entries()].map(([phone, info]) => ({ phone, ...info })),
        library: this.#comments.messages.length,
        rounds: this.#commentState.rounds || 0,
        continuous: Boolean(this.#commentContinuous),
        lastError: this.#commentState.lastError || "",
      },
    };
  }

  startComments({
    link,
    perAccount = 1,
    accountLimit = 10,
    dailyLimit = 5,
    minAgeDays = 7,
    sendDelayMin = 25,
    sendDelayMax = 90,
    concurrency = 5,
    continuous = false,
    roundDelay = 60,
  }) {
    if (this.#commentState.running) throw new Error("Phiên bình luận đang chạy — dừng trước đã");
    if (!this.#comments.messages.length) throw new Error("Kho comment đang rỗng — thêm câu trước đã");

    this.setSafety({ minAgeDays });
    this.#commentOpts = {
      link,
      perAccount,
      accountLimit,
      dailyLimit,
      minAgeDays,
      sendDelayMin,
      sendDelayMax,
      concurrency,
    };
    this.#commentContinuous = Boolean(continuous);
    this.#commentRoundDelay = Math.max(10, Number(roundDelay) || 60);
    this.#commentStopped = false;
    this.#commentState = {
      running: true,
      link,
      sent: 0,
      errors: 0,
      accounts: new Map(),
      startedAt: Date.now(),
      total: 0,
      rounds: 0,
      continuous: this.#commentContinuous,
    };
    this.#runCommentRound();
    return this.status();
  }

  #runCommentRound() {
    if (this.#commentStopped) return;
    const opts = this.#commentOpts;
    if (!opts) return;
    const { rows, skipped } = this.#eligibleAccounts({
      dailyLimit: opts.dailyLimit,
      minAgeDays: opts.minAgeDays,
      quotaField: "comments",
    });
    const freeRows = rows.filter((account) => !this.#viewPhones.has(account.phone));
    if (this.#viewPhones.size) skipped.busy = rows.length - freeRows.length;
    const picked = freeRows.slice(0, Math.max(1, Number(opts.accountLimit) || 10));
    if (!picked.length) {
      this.#commentState.running = false;
      this.#commentState.skipped = skipped;
      this.#commentState.lastError =
        `Hết acc dùng được (quá mới: ${skipped.young}, hết lượt: ${skipped.quota}, cooldown: ${skipped.cooldown}, đang bận: ${skipped.busy || 0}).`;
      this.#commentStopped = true;
      return;
    }

    const python = this.python();
    const messagesFile = join(this.#dataDirectory, "telegram-messages.txt");
    writeFileSync(messagesFile, this.#comments.messages.join("\n"), "utf8");
    const scriptPath = join(process.cwd(), "python", "telegram_boost.py");
    const safety = this.safety;

    const child = spawn(
      python,
      [
        scriptPath,
        "--accounts",
        this.#accountsDirectory,
        "--link",
        opts.link,
        "--mode",
        "comment",
        "--messages",
        messagesFile,
        "--per-account",
        String(Math.max(1, Number(opts.perAccount) || 1)),
        "--phones",
        picked.map((account) => account.phone).join(","),
        "--concurrency",
        String(Math.max(1, Number(opts.concurrency) || 5)),
        "--send-delay-min",
        String(Number(opts.sendDelayMin) || 25),
        "--send-delay-max",
        String(Number(opts.sendDelayMax) || 90),
        "--delay-min",
        "2",
        "--delay-max",
        String(safety.delayMax),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    this.#commentChild = child;
    this.#recordWorker("comment", child.pid);
    this.#commentPhones = new Set(picked.map((account) => account.phone));
    this.#commentState.running = true;
    this.#commentState.rounds = (this.#commentState.rounds || 0) + 1;
    this.#commentState.skipped = skipped;
    this.#wire(child, this.#commentState, "comment");
  }

  #wire(child, state, kind = "view") {
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
          this.#handle(JSON.parse(line), state);
        } catch {
          // bỏ dòng không phải JSON
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) this.#handle({ event: "log", message: text.slice(0, 400) }, state);
    });
    child.on("exit", () => {
      if (kind === "view") {
        state.running = false;
        this.#viewChild = null;
        this.#recordWorker("view", null);
        this.#viewPhones = new Set();
        return;
      }
      this.#recordWorker("comment", null);
      this.#commentChild = null;
      this.#commentPhones = new Set();
      if (this.#commentContinuous && !this.#commentStopped) {
        const delay = this.#commentRoundDelay + Math.floor(Math.random() * 15000);
        this.#commentTimer = setTimeout(() => this.#runCommentRound(), delay);
        this.#commentTimer.unref?.();
        state.running = true;
      } else {
        state.running = false;
      }
    });
    child.on("error", (error) => {
      state.running = false;
      if (kind === "view") this.#viewChild = null;
      else this.#commentChild = null;
      this.#handle({ event: "error", phone: "", error: error.message }, state);
    });
  }

  start({ link, concurrency, limit = 0, accountsDirectory, dailyLimit, minAgeDays, delayMin, delayMax }) {
    if (this.#state.running) throw new Error("Phiên tăng mắt đang chạy — dừng trước đã");
    this.setSafety({ dailyLimit, minAgeDays, delayMin, delayMax, concurrency });
    const safety = this.safety;
    const python = this.python();
    const directory = accountsDirectory ? resolve(accountsDirectory) : this.#accountsDirectory;
    const scriptPath = join(process.cwd(), "python", "telegram_boost.py");

    const { rows, skipped } = this.#eligibleAccounts(safety);
    const freeRows = rows.filter((account) => !this.#commentPhones.has(account.phone));
    if (this.#commentPhones.size) skipped.busy = rows.length - freeRows.length;
    rows.length = 0;
    rows.push(...freeRows);
    if (!rows.length) {
      throw new Error(
        `Không còn tài khoản an toàn để chạy (acc quá mới: ${skipped.young}, hết lượt hôm nay: ${skipped.quota}, đang cooldown: ${skipped.cooldown}). Tăng giới hạn hoặc chờ.`,
      );
    }
    const picked = Number(limit) > 0 ? rows.slice(0, Number(limit)) : rows;

    const child = spawn(
      python,
      [
        scriptPath,
        "--accounts",
        directory,
        "--link",
        link,
        "--concurrency",
        String(Math.max(1, Number(safety.concurrency) || 10)),
        "--phones",
        picked.map((account) => account.phone).join(","),
        "--delay-min",
        String(safety.delayMin),
        "--delay-max",
        String(safety.delayMax),
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    const initialTarget = Number(limit) > 0 ? Math.min(Number(limit), picked.length) : picked.length;
    this.#viewChild = child;
    this.#mode = "view";
    this.#state = {
      running: true,
      link,
      joined: 0,
      errors: 0,
      accounts: new Map(),
      startedAt: Date.now(),
      skipped,
      total: picked.length,
    };

    this.#recordWorker("view", child.pid);
    this.#viewPhones = new Set(picked.map((account) => account.phone));
    this.#wire(child, this.#state, "view");
    this.#state.target = initialTarget;
    try {
      child.stdin.write(`${JSON.stringify({ cmd: "set", target: initialTarget })}\n`);
    } catch {
      // worker chưa sẵn sàng, lệnh set đầu tiên có thể bị bỏ
    }
    return this.status();
  }

  // tăng/giảm số mắt của phiên view đang chạy
  adjust(target) {
    if (!this.#viewChild || !this.#state.running) throw new Error("Chưa có phiên tăng mắt nào đang chạy");
    const value = Math.max(0, Math.floor(Number(target) || 0));
    this.#viewChild.stdin.write(`${JSON.stringify({ cmd: "set", target: value })}\n`);
    this.#state.target = value;
    return value;
  }

  // kiểm tra kênh bằng 1 acc rảnh: loại entity, quyền gửi, livestream, participant
  async check(link) {
    if (!String(link || "").trim()) throw new Error("Thiếu link kênh/nhóm");
    const busy = new Set([...this.#viewPhones, ...this.#commentPhones]);
    const { rows } = this.#eligibleAccounts({ dailyLimit: 10, minAgeDays: 0 });
    const account = rows.find((row) => !busy.has(row.phone));
    if (!account) {
      throw new Error("Tất cả acc đang bận ở phiên khác — dừng bớt một phiên rồi kiểm tra (tránh dùng trùng session).");
    }
    const python = this.python();
    const scriptPath = join(process.cwd(), "python", "telegram_boost.py");
    return new Promise((resolve, reject) => {
      const child = spawn(
        python,
        [scriptPath, "--accounts", this.#accountsDirectory, "--link", String(link), "--mode", "check", "--phones", account.phone],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let buffer = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // đã chết
        }
        reject(new Error("Kiểm tra quá lâu (30s)"));
      }, 30000);
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
            if (event.event === "check" && !settled) {
              settled = true;
              clearTimeout(timer);
              resolve(event);
            }
          } catch {
            // bỏ dòng lỗi
          }
        }
      });
      child.stderr.on("data", (chunk) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(chunk.toString().slice(0, 300)));
      });
    });
  }

  #logEvent(message) {
    try {
      appendFileSync(
        join(this.#dataDirectory, "telegram-events.log"),
        `${new Date().toISOString()} ${JSON.stringify(message).slice(0, 500)}\n`,
        "utf8",
      );
    } catch {
      // log lỗi không chặn chạy
    }
  }

  #handle(message, target = this.#state) {
    const phone = message.phone || "?";
    this.#logEvent(message);
    if (message.event === "participants") {
      target.participants = Number(message.count) || 0;
      return;
    }
    if (message.event === "commented") {
      target.sent = (target.sent || 0) + 1;
      target.accounts.set(phone, {
        state: "sent",
        sent: Number(message.sent) || 0,
        text: message.text || "",
        error: "",
      });
      const phoneState = this.#phoneState(phone);
      phoneState.comments = (phoneState.comments || 0) + 1;
      this.#saveCooldown();
    } else if (message.event === "joined") {
      target.joined = (target.joined || 0) + 1;
      target.accounts.set(phone, { state: "joined", name: message.name || "", error: "" });
      const phoneState = this.#phoneState(phone);
      phoneState.joins = (phoneState.joins || 0) + 1;
      this.#saveCooldown();
    } else if (message.event === "cooldown") {
      const phoneState = this.#phoneState(phone);
      phoneState.cooldownUntil = Date.now() + Math.max(60, Number(message.seconds) || 0) * 1000;
      this.#saveCooldown();
      target.accounts.set(phone, { state: "cooldown", name: "", error: `Telegram bắt chờ ${message.seconds}s` });
    } else if (message.event === "error") {
      target.errors = (target.errors || 0) + 1;
      target.lastError = String(message.error || "").slice(0, 300);
      if (/authorization key/i.test(String(message.error || ""))) {
        const phoneState = this.#phoneState(phone);
        phoneState.dead = true;
        phoneState.deadAt = Date.now();
        this.#saveCooldown();
      }
      target.accounts.set(phone, { state: "error", name: "", error: String(message.error || "").slice(0, 300) });
    } else if (message.event === "stats") {
      if (message.joined != null) target.joined = Number(message.joined);
      target.errors = Number(message.errors) || target.errors || 0;
      if (message.target != null) target.target = Number(message.target);
    } else if (message.event === "done") {
      target.running = false;
    }
  }

  stopView() {
    if (!this.#viewChild) return false;
    try {
      this.#viewChild.kill("SIGTERM");
    } catch {
      // worker đã thoát
    }
    this.#state.running = false;
    this.#viewChild = null;
    this.#viewPhones = new Set();
    return true;
  }

  stopComments() {
    this.#commentStopped = true;
    clearTimeout(this.#commentTimer);
    this.#commentTimer = null;
    if (!this.#commentChild) {
      this.#commentState.running = false;
      return false;
    }
    try {
      this.#commentChild.kill("SIGTERM");
    } catch {
      // worker đã thoát
    }
    this.#commentState.running = false;
    this.#commentChild = null;
    this.#commentPhones = new Set();
    return true;
  }

  stop(mode = "view") {
    return mode === "comment" ? this.stopComments() : this.stopView();
  }

  stopAll() {
    const a = this.stopView();
    const b = this.stopComments();
    return a || b;
  }
}
