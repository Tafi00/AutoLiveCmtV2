// Tăng mắt livestream Telegram bằng bộ tài khoản Telethon.
// Node chỉ điều phối: import tài khoản, spawn worker Python, đọc JSON lines từ stdout.
import { spawn } from "node:child_process";
import { readdirSync, existsSync, mkdirSync, statSync, readFileSync, cpSync, createWriteStream } from "node:fs";
import { writeFile, rename } from "node:fs/promises";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { expandProxies, parseProxyList } from "../viewbot/manager.js";

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

function probePython(candidate, timeoutMs = 30000) {
  return new Promise((resolveProbe) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveProbe(result);
    };
    let child;
    try {
      child = spawn(candidate, ["-c", "import telethon"], { stdio: "ignore" });
    } catch (error) {
      done({ ok: false, reason: error.code || error.message });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // đã thoát
      }
      done({ ok: false, reason: "timeout" });
    }, timeoutMs);
    child.on("error", (error) => done({ ok: false, reason: error.code || error.message }));
    child.on("exit", (code) => done({ ok: code === 0, reason: `exit=${code}` }));
  });
}

function runCommand(command, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // đã thoát
      }
      rejectRun(new Error(`${command} chạy quá ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 2000) stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      rejectRun(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolveRun();
      else rejectRun(new Error(stderr.trim().slice(0, 300) || `${command} lỗi (exit ${code})`));
    });
  });
}

// gán proxy cố định cho từng acc: phone -> url proxy (hỗ trợ {i} / {rand} như Mắt xem)
export function buildProxyMap(phones, proxies) {
  const list = expandProxies(parseProxyList(proxies || ""), phones.length);
  if (!list.length) return {};
  const map = {};
  phones.forEach((phone, index) => {
    map[phone] = list[index % list.length];
  });
  return map;
}

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
  #pythonPromise = null;
  #pythonError = "";
  #cooldownFile;
  #cooldownTimer = null;
  #cooldownWriting = Promise.resolve();
  #eventLog = null;
  #workerFile;
  #commentsFile;
  #comments = { messages: [], cursor: 0 };
  #roundStart = 0; // câu đầu tiên của đợt đang chạy (vị trí trong kho)
  #roundSize = 0;
  #cooldown = { phones: {} };
  #safety = { dailyLimit: 3, minAgeDays: 7, delayMin: 4, delayMax: 20, concurrency: 10 };
  #listeners = new Set();
  #remotePhones = new Map(); // hubId -> Set(phone) đang chạy trên máy phụ

  constructor({ dataDirectory }) {
    this.#dataDirectory = dataDirectory;
    this.#accountsDirectory = join(dataDirectory, "telegram-accounts");
    mkdirSync(this.#accountsDirectory, { recursive: true });
    this.#cooldownFile = join(dataDirectory, "telegram-cooldown.json");
    this.#commentsFile = join(dataDirectory, "telegram-comments.json");
    this.#workerFile = join(dataDirectory, "telegram-workers.json");
    this.#reapOrphans();
    // dò python ngay khi khởi động để lần bấm đầu tiên không phải chờ
    void this.ensurePython().catch(() => {});
    try {
      const parsed = JSON.parse(readFileSync(this.#commentsFile, "utf8"));
      if (Array.isArray(parsed?.messages)) this.#comments.messages = parsed.messages.filter(Boolean);
      this.#comments.cursor = Number(parsed?.cursor) || 0;
    } catch {
      this.#comments = { messages: [], cursor: 0 };
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

  onChange(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(kind = "status") {
    for (const listener of this.#listeners) {
      try {
        listener(kind);
      } catch {
        // listener lỗi không ảnh hưởng phiên chạy
      }
    }
  }

  #saveComments() {
    const total = this.#comments.messages.length;
    if (!Number.isInteger(this.#comments.cursor) || this.#comments.cursor < 0 || this.#comments.cursor >= total) {
      this.#comments.cursor = 0;
    }
    try {
      writeFileSync(this.#commentsFile, `${JSON.stringify(this.#comments, null, 2)}\n`, "utf8");
    } catch {
      // ghi lỗi không chặn thao tác
    }
    this.#emit("comments");
  }

  #commentsTimer = null;

  #saveCommentsSoon() {
    if (this.#commentsTimer) return;
    this.#commentsTimer = setTimeout(() => {
      this.#commentsTimer = null;
      this.#saveComments();
    }, 1000);
    this.#commentsTimer.unref?.();
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
    if (i < this.#comments.cursor) this.#comments.cursor -= 1;
    this.#saveComments();
    return this.#comments.messages;
  }

  clearComments() {
    this.#comments.messages = [];
    this.#comments.cursor = 0;
    this.#saveComments();
    return [];
  }

  shuffleComments() {
    const list = this.#comments.messages;
    this.#comments.cursor = 0;
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
          // worker mồ côi không còn ai điều khiển: tắt hẳn để nhả session cho phiên mới
          process.kill(Number(pid), "SIGKILL");
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

  // gộp nhiều sự kiện join/comment thành một lần ghi, không chặn event loop
  #saveCooldown() {
    this.#emit("accounts");
    if (this.#cooldownTimer) return;
    this.#cooldownTimer = setTimeout(() => {
      this.#cooldownTimer = null;
      const body = `${JSON.stringify(this.#cooldown)}\n`;
      const temp = `${this.#cooldownFile}.tmp`;
      this.#cooldownWriting = this.#cooldownWriting
        .then(() => writeFile(temp, body, "utf8"))
        .then(() => rename(temp, this.#cooldownFile))
        .catch(() => {});
    }, 500);
    this.#cooldownTimer.unref?.();
  }

  flushCooldown() {
    if (!this.#cooldownTimer) return;
    clearTimeout(this.#cooldownTimer);
    this.#cooldownTimer = null;
    try {
      writeFileSync(this.#cooldownFile, `${JSON.stringify(this.#cooldown)}\n`, "utf8");
    } catch {
      // bỏ qua
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

  // tìm python có telethon — chạy nền, không khoá server trong lúc dò
  ensurePython() {
    if (this.#python) return Promise.resolve(this.#python);
    if (this.#pythonPromise) return this.#pythonPromise;
    this.#pythonPromise = (async () => {
      const tried = [];
      for (const candidate of PY_CANDIDATES) {
        const probe = await probePython(candidate);
        tried.push(`${candidate} (${probe.reason})`);
        if (probe.ok) {
          this.#python = candidate;
          this.#pythonError = "";
          return candidate;
        }
      }
      this.#pythonError =
        `Không tìm thấy Python có telethon. Cài: ${PROJECT_ROOT}/.venv/bin/pip install telethon python-socks (hoặc đặt TELEGRAM_PYTHON). Đã thử: ${tried.join("; ")}`;
      throw new Error(this.#pythonError);
    })().finally(() => {
      this.#pythonPromise = null;
    });
    return this.#pythonPromise;
  }

  get pythonReady() {
    return Boolean(this.#python);
  }

  #scriptPath() {
    return join(PROJECT_ROOT, "python", "telegram_boost.py");
  }

  #writeProxyFile(kind, map) {
    if (!map || !Object.keys(map).length) return "";
    const file = join(this.#dataDirectory, `telegram-proxies-${kind}.json`);
    writeFileSync(file, JSON.stringify(map), "utf8");
    return file;
  }

  // các acc đang được dùng ở bất kỳ phiên nào (máy chính hoặc máy phụ)
  busyPhones() {
    const busy = new Set([...this.#viewPhones, ...this.#commentPhones]);
    for (const set of this.#remotePhones.values()) for (const phone of set) busy.add(phone);
    return busy;
  }

  setRemotePhones(hubId, phones) {
    if (phones?.length) this.#remotePhones.set(hubId, new Set(phones));
    else this.#remotePhones.delete(hubId);
  }

  // sự kiện từ worker chạy trên máy phụ: cập nhật hạn mức/cooldown của từng acc
  ingestRemoteEvent(event = {}) {
    const phone = event.phone;
    if (!phone) return;
    if (event.event === "joined") {
      const state = this.#phoneState(phone);
      state.joins = (state.joins || 0) + 1;
      this.#saveCooldown();
    } else if (event.event === "cooldown") {
      const state = this.#phoneState(phone);
      state.cooldownUntil = Date.now() + Math.max(60, Number(event.seconds) || 0) * 1000;
      this.#saveCooldown();
    } else if (event.event === "error" && /authorization key/i.test(String(event.error || ""))) {
      const state = this.#phoneState(phone);
      state.dead = true;
      state.deadAt = Date.now();
      this.#saveCooldown();
    }
  }

  // quét thư mục tài khoản: mỗi thư mục con chứa <phone>.session/.json
  // quét thư mục (nặng) được cache lâu; hạn mức hôm nay ghép vào mỗi lần đọc
  #scanAccounts(directory) {
    const cached = this.#accountsCache;
    if (cached && cached.dir === directory && Date.now() - cached.at < 60000) return cached.rows;
    if (!existsSync(directory)) return [];
    const rows = [];
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      try {
        if (!statSync(full).isDirectory()) continue;
      } catch {
        continue;
      }
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
      rows.push({
        phone: String(meta.phone || entry),
        name: meta.first_name || meta.last_name || "",
        username: meta.username || "",
        appId: meta.app_id || null,
        device: meta.device || "",
        ageDays: this.#accountAgeDays(meta),
        folder: full,
        folderName: entry,
        hasJson: Boolean(jsonFile),
        hasSession: Boolean(sessionFile),
      });
    }
    const sorted = rows.sort((a, b) => a.phone.localeCompare(b.phone));
    this.#accountsCache = { dir: directory, at: Date.now(), rows: sorted };
    return sorted;
  }

  listAccounts(directory = this.#accountsDirectory) {
    const today = TelegramBoostManager.#today();
    return this.#scanAccounts(directory).map((row) => {
      const stored = this.#cooldown.phones[row.phone] || {};
      return {
        ...row,
        joinsToday: stored.day === today ? stored.joins || 0 : 0,
        commentsToday: stored.day === today ? stored.comments || 0 : 0,
        cooldownUntil: stored.cooldownUntil || 0,
        dead: Boolean(stored.dead),
      };
    });
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
    this.#emit("accounts");
    return this.listAccounts();
  }

  async importZip(zipPath) {
    try {
      await runCommand("unzip", ["-q", "-o", zipPath, "-d", this.#accountsDirectory], { timeoutMs: 180000 });
    } catch (error) {
      throw new Error(`Giải nén thất bại: ${error.message}`);
    }
    this.#invalidateAccounts();
    this.#emit("accounts");
    return this.listAccounts();
  }

  status() {
    const total = this.#scanAccounts(this.#accountsDirectory).length;
    return {
      safety: this.safety,
      pythonReady: Boolean(this.#python),
      pythonError: this.#pythonError,
      proxies: this.#state.proxies || 0,
      assigned: this.#state.total || 0,
      busy: this.busyPhones().size,
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
      total,
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
        cursor: this.#comments.cursor || 0,
        rounds: this.#commentState.rounds || 0,
        continuous: Boolean(this.#commentContinuous),
        lastError: this.#commentState.lastError || "",
      },
    };
  }

  async startComments({
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
    await this.ensurePython();

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
    const busy = this.busyPhones();
    const freeRows = rows.filter((account) => !busy.has(account.phone));
    if (busy.size) skipped.busy = rows.length - freeRows.length;
    const picked = freeRows.slice(0, Math.max(1, Number(opts.accountLimit) || 10));
    if (!picked.length) {
      this.#commentState.running = false;
      this.#commentState.skipped = skipped;
      this.#commentState.lastError =
        `Hết acc dùng được (quá mới: ${skipped.young}, hết lượt: ${skipped.quota}, cooldown: ${skipped.cooldown}, đang bận: ${skipped.busy || 0}).`;
      this.#commentStopped = true;
      return;
    }

    const python = this.#python;
    if (!python) {
      this.#commentState.running = false;
      this.#commentState.lastError = this.#pythonError || "Chưa tìm thấy Python có telethon.";
      this.#commentStopped = true;
      this.#emit();
      return;
    }
    const messagesFile = join(this.#dataDirectory, "telegram-messages.txt");
    const library = this.#comments.messages;
    const start = library.length ? (this.#comments.cursor || 0) % library.length : 0;
    this.#roundStart = start;
    this.#roundSize = library.length;
    // mỗi đợt nối tiếp câu đợt trước dừng lại, để dùng hết kho thay vì lặp mấy câu đầu
    writeFileSync(messagesFile, [...library.slice(start), ...library.slice(0, start)].join("\n"), "utf8");
    const scriptPath = this.#scriptPath();
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
        picked.map((account) => account.folderName || account.phone).join(","),
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
      // worker coi stdin bị đóng là máy chủ đã chết và tự dừng, nên phải giữ stdin mở
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    child.stdin.on("error", () => {});

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
      this.#emit();
      if (kind === "view") {
        if (this.#viewChild !== child) return;
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

  // phone -> tên thư mục (worker python lọc theo tên thư mục)
  folderNames(phones) {
    const byPhone = new Map(this.#scanAccounts(this.#accountsDirectory).map((row) => [row.phone, row.folderName]));
    return phones.map((phone) => byPhone.get(phone) || phone);
  }

  async start({
    link,
    phones = null,
    target = 0,
    proxies = "",
    concurrency,
    limit = 0,
    dailyLimit,
    minAgeDays,
    delayMin,
    delayMax,
  }) {
    if (this.#state.running) throw new Error("Phiên tăng mắt Telegram trên máy chính đang chạy — dừng trước đã");
    this.setSafety({ dailyLimit, minAgeDays, delayMin, delayMax, concurrency });
    const safety = this.safety;
    const python = await this.ensurePython();

    let picked = Array.isArray(phones) && phones.length ? [...new Set(phones.map(String))] : null;
    let skipped = null;
    if (!picked) {
      const choice = this.pickPhones({
        dailyLimit: safety.dailyLimit,
        minAgeDays: safety.minAgeDays,
        limit: Number(limit) || Number(target) || 0,
        exclude: this.busyPhones(),
      });
      picked = choice.phones;
      skipped = choice.skipped;
    }
    if (!picked.length) {
      const s = skipped || {};
      throw new Error(
        `Không còn tài khoản an toàn để chạy (acc quá mới: ${s.young || 0}, hết lượt hôm nay: ${s.quota || 0}, cooldown: ${s.cooldown || 0}, đang bận: ${s.busy || 0}).`,
      );
    }

    const folders = this.folderNames(picked);
    const proxyMap = buildProxyMap(picked, proxies);
    const keyed = {};
    picked.forEach((phone, index) => {
      if (!proxyMap[phone]) return;
      keyed[phone] = proxyMap[phone];
      keyed[folders[index]] = proxyMap[phone];
    });
    const proxyFile = this.#writeProxyFile("view", keyed);

    const args = [
      this.#scriptPath(),
      "--accounts",
      this.#accountsDirectory,
      "--link",
      link,
      "--concurrency",
      String(Math.max(1, Number(safety.concurrency) || 10)),
      "--phones",
      folders.join(","),
      "--delay-min",
      String(safety.delayMin),
      "--delay-max",
      String(safety.delayMax),
    ];
    if (proxyFile) args.push("--proxies", proxyFile);
    const child = spawn(python, args, { stdio: ["pipe", "pipe", "pipe"] });

    const initialTarget = Math.min(Number(target) || picked.length, picked.length);
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
      proxies: Object.keys(proxyMap).length ? new Set(Object.values(proxyMap)).size : 0,
      target: initialTarget,
    };

    this.#recordWorker("view", child.pid);
    this.#viewPhones = new Set(picked);
    this.#wire(child, this.#state, "view");
    try {
      child.stdin.write(`${JSON.stringify({ cmd: "set", target: initialTarget })}\n`);
    } catch {
      // worker chưa sẵn sàng, lệnh set đầu tiên có thể bị bỏ
    }
    this.#emit();
    return this.status();
  }

  // tăng/giảm số mắt của phiên view đang chạy
  adjust(target) {
    if (!this.#viewChild || !this.#state.running) throw new Error("Chưa có phiên tăng mắt nào đang chạy");
    const value = Math.max(0, Math.min(this.#state.total || Number.MAX_SAFE_INTEGER, Math.floor(Number(target) || 0)));
    this.#viewChild.stdin.write(`${JSON.stringify({ cmd: "set", target: value })}\n`);
    this.#state.target = value;
    this.#emit();
    return value;
  }

  // kiểm tra kênh bằng 1 acc rảnh: loại entity, quyền gửi, livestream, participant
  async check(link) {
    if (!String(link || "").trim()) throw new Error("Thiếu link kênh/nhóm");
    const busy = this.busyPhones();
    const { rows } = this.#eligibleAccounts({ dailyLimit: 0, minAgeDays: 0 });
    const account = rows.find((row) => !busy.has(row.phone));
    if (!account) {
      throw new Error("Tất cả acc đang bận ở phiên khác — dừng bớt một phiên rồi kiểm tra (tránh dùng trùng session).");
    }
    const python = await this.ensurePython();
    const scriptPath = this.#scriptPath();
    return new Promise((resolve, reject) => {
      const child = spawn(
        python,
        [scriptPath, "--accounts", this.#accountsDirectory, "--link", String(link), "--mode", "check", "--phones", account.folderName || account.phone],
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
      if (!this.#eventLog) {
        this.#eventLog = createWriteStream(join(this.#dataDirectory, "telegram-events.log"), { flags: "a" });
        this.#eventLog.on("error", () => {
          this.#eventLog = null;
        });
      }
      this.#eventLog.write(`${new Date().toISOString()} ${JSON.stringify(message).slice(0, 500)}\n`);
    } catch {
      // log lỗi không chặn chạy
    }
  }

  #handle(message, target = this.#state) {
    this.#applyEvent(message, target);
    if (message.event !== "log") this.#emit();
  }

  #applyEvent(message, target) {
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
      const index = Number(message.index);
      if (Number.isInteger(index) && this.#roundSize && this.#roundSize === this.#comments.messages.length) {
        this.#comments.cursor = (this.#roundStart + index + 1) % this.#roundSize;
        this.#saveCommentsSoon();
      }
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

  // xin dừng nhẹ để acc rời phòng; quá 8s chưa thoát (hoặc máy chủ đang tắt) thì tắt hẳn
  #terminate(child, { force = false } = {}) {
    if (!child || child.exitCode !== null) return;
    try {
      child.kill(force ? "SIGKILL" : "SIGTERM");
    } catch {
      return;
    }
    if (force) return;
    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {
          // đã thoát
        }
      }
    }, 8000);
    timer.unref?.();
    child.once("exit", () => clearTimeout(timer));
  }

  stopView({ force = false } = {}) {
    if (!this.#viewChild) return false;
    this.#terminate(this.#viewChild, { force });
    this.#state.running = false;
    this.#viewChild = null;
    this.#viewPhones = new Set();
    this.#emit();
    return true;
  }

  stopComments({ force = false } = {}) {
    this.#commentStopped = true;
    clearTimeout(this.#commentTimer);
    this.#commentTimer = null;
    if (!this.#commentChild) {
      this.#commentState.running = false;
      return false;
    }
    this.#terminate(this.#commentChild, { force });
    this.#commentState.running = false;
    this.#commentChild = null;
    this.#commentPhones = new Set();
    this.#emit();
    return true;
  }

  stop(mode = "view") {
    return mode === "comment" ? this.stopComments() : this.stopView();
  }

  stopAll({ force = false } = {}) {
    const a = this.stopView({ force });
    const b = this.stopComments({ force });
    return a || b;
  }
}
