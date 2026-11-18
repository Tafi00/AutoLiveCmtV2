// Mượn acc Telegram từ kho chung của code-tele-v4 (~/CodeTestDual) thay vì dùng bản sao phiên trong data/telegram-accounts.
//
// 18/11: thư mục data/telegram-accounts là BẢN SAO phiên của 102/108 acc kho code-tele-v4 (cùng auth key). Hai tool cùng mở một acc
// thì Telegram vô hiệu phiên (AuthKeyDuplicated) — spiritx, Iceberg, KHONGSOAI, truth, ae đã chết như vậy. Giao thức (phía kho:
// telegram_pool.PoolManager.ensure_leases):
//   ghi  <kho>/tg_pool_lease/autolive.req.json  {want, phones, at, pid}   — làm mới "at" < 180 s, hết hạn = trả hết acc
//   đọc  <kho>/tg_pool_lease/autolive.grant.json {accounts: {acc_id: {phone, name, session_str, api_id, api_hash, device, proxy}}}
//   ghi  <kho>/nodes/autolive/status.json       {pool_held: [acc_id đang mở], received_at, pid}
// Kho đóng kết nối của acc trên máy nó TRƯỚC khi giao; acc trả về chỉ được kho dùng lại khi status.json không còn liệt kê (hoặc
// tiến trình này đã tắt). Danh sách acc + trạng thái để hiển thị: <kho>/tg_pool_lease/accounts.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export const POOL_NAME = "autolive";
const HEARTBEAT_MS = 20000;
const PENDING_KEEP_MS = 90000; // acc vừa giao chưa kịp chạy (chia cho hub phụ...) vẫn giữ trong yêu cầu chừng này

export const digits = (value) => String(value ?? "").replace(/\D/g, "");

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(path, value, mode = 0o600) {
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, JSON.stringify(value), { encoding: "utf8", mode });
  try {
    chmodSync(temp, mode);
  } catch {
    // hệ thống tệp không hỗ trợ
  }
  renameSync(temp, path);
}

export class CodeTelePool {
  #dataDir;
  #leaseDir;
  #heldPhones;
  #pending = new Map(); // số ĐT vừa xin -> hạn giữ (ms): giữ trong yêu cầu tới khi worker chạy (đang giữ) hoặc hết hạn
  #timer = null;
  #snapshot = { at: 0, rows: [] };
  #log;

  /**
   * @param {object} opts
   * @param {string} opts.leaseDirectory thư mục ghi file phiên mượn (mỗi acc một thư mục <phone>/<phone>.json, quyền 600)
   * @param {() => Set<string>} opts.heldPhones số ĐT đang chạy ở AutoLiveCmtV2 (máy chính + hub phụ)
   */
  constructor({ leaseDirectory, heldPhones, dataDirectory = process.env.CODE_TELE_DATA || join(homedir(), "CodeTestDual"), log = () => {} }) {
    this.#dataDir = dataDirectory;
    this.#leaseDir = leaseDirectory;
    this.#heldPhones = heldPhones;
    this.#log = log;
  }

  get enabled() {
    return process.env.CODE_TELE_POOL !== "0" && existsSync(join(this.#dataDir, "tg_pool.json"));
  }

  get leaseDirectory() {
    return this.#leaseDir;
  }

  get #reqPath() {
    return join(this.#dataDir, "tg_pool_lease", `${POOL_NAME}.req.json`);
  }

  get #grantPath() {
    return join(this.#dataDir, "tg_pool_lease", `${POOL_NAME}.grant.json`);
  }

  get #statusPath() {
    return join(this.#dataDir, "nodes", POOL_NAME, "status.json");
  }

  start() {
    if (this.#timer || !this.enabled) return;
    mkdirSync(this.#leaseDir, { recursive: true, mode: 0o700 });
    this.sync();
    this.#timer = setInterval(() => this.sync(), HEARTBEAT_MS);
    this.#timer.unref?.();
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  // Danh sách acc của kho chung (không có phiên): {id, phone, name, tag, status, dead, frozen, limited, note, held_by}
  accounts() {
    if (Date.now() - this.#snapshot.at < 3000) return this.#snapshot.rows;
    const data = readJson(join(this.#dataDir, "tg_pool_lease", "accounts.json"), null);
    const rows = Array.isArray(data?.accounts) ? data.accounts : [];
    this.#snapshot = { at: Date.now(), rows };
    return rows;
  }

  // acc_id -> dòng giao trong grant
  grant() {
    const data = readJson(this.#grantPath, null);
    return data && typeof data.accounts === "object" && data.accounts ? data.accounts : {};
  }

  // số ĐT đang cần giữ = đang chạy + đang chờ giao
  #wanted() {
    const set = new Set();
    for (const phone of this.#heldPhones?.() || []) set.add(digits(phone));
    const now = Date.now();
    for (const [phone, until] of this.#pending) {
      if (until > now) set.add(phone);
      else this.#pending.delete(phone);
    }
    set.delete("");
    return set;
  }

  // Ghi yêu cầu (số acc + số ĐT cần) và danh sách acc đang mở cho kho; xoá file phiên mượn của acc không còn dùng.
  sync() {
    if (!this.enabled) return;
    const wanted = [...this.#wanted()];
    const now = Date.now() / 1000;
    try {
      mkdirSync(join(this.#dataDir, "tg_pool_lease"), { recursive: true });
      mkdirSync(join(this.#dataDir, "nodes", POOL_NAME), { recursive: true });
      writeJsonAtomic(this.#reqPath, { want: wanted.length, phones: wanted, at: now, pid: process.pid });
      const grant = this.grant();
      const byPhone = new Map(Object.entries(grant).map(([id, row]) => [digits(row.phone), id]));
      const running = new Set([...(this.#heldPhones?.() || [])].map(digits));
      const held = [...running].map((phone) => byPhone.get(phone)).filter(Boolean);
      writeJsonAtomic(this.#statusPath, { pool_held: held, received_at: now, pid: process.pid }, 0o644);
      this.#cleanup(new Set(wanted));
    } catch (error) {
      this.#log(`Kho acc chung: ghi yêu cầu lỗi ${error.message}`);
    }
  }

  #cleanup(wanted) {
    if (!existsSync(this.#leaseDir)) return;
    for (const name of readdirSync(this.#leaseDir)) {
      if (wanted.has(digits(name))) continue;
      try {
        rmSync(join(this.#leaseDir, name), { recursive: true, force: true }); // phiên mượn không còn dùng: xoá ngay
      } catch {
        // đang bị đọc
      }
    }
  }

  // Xin kho giao `phones` (số ĐT); chờ tối đa timeoutMs. Ghi file phiên mượn cho từng acc được giao. Trả số ĐT đã giao (cùng định dạng
  // đầu vào), acc kho không giao kịp (đang bận ở hub / máy chính cần / chết) bị bỏ.
  async acquire(phones, timeoutMs = 45000) {
    const asked = [...new Set((phones || []).map(String))];
    if (!this.enabled || !asked.length) return asked;
    for (const phone of asked) this.#pending.set(digits(phone), Date.now() + PENDING_KEEP_MS);
    this.sync();
    const deadline = Date.now() + timeoutMs;
    let granted = new Map();
    let grant = {};
    while (true) {
      grant = this.grant();
      granted = new Map(Object.entries(grant).map(([id, row]) => [digits(row.phone), { ...row, id }]));
      if (asked.every((phone) => granted.has(digits(phone))) || Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      this.sync();
    }
    mkdirSync(this.#leaseDir, { recursive: true, mode: 0o700 });
    const ready = [];
    for (const phone of asked) {
      const row = granted.get(digits(phone));
      if (!row?.session_str) continue;
      const folder = join(this.#leaseDir, digits(phone));
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      const device = row.device && typeof row.device === "object" ? row.device : {};
      // dùng đúng api + dấu vân tay thiết bị của kho (cùng auth key phải cùng "máy" — giống code-tele-v4)
      writeJsonAtomic(join(folder, `${digits(phone)}.json`), {
        phone: digits(phone),
        session_str: row.session_str,
        app_id: row.api_id || 2040,
        app_hash: row.api_hash || "b18441a1ff607e10a989891a5462e627",
        device: device.device_model || "PC 64bit",
        sdk: device.system_version || "Windows 10",
        app_version: device.app_version || "5.1.7 x64",
        lang_code: device.lang_code || "en",
        first_name: row.name || "",
        username: /^\d+$/.test(String(row.tag || "")) ? "" : String(row.tag || ""),
        pool_id: row.id || "",
      });
      ready.push(phone);
    }
    for (const phone of asked) {
      if (!ready.includes(phone)) this.#pending.delete(digits(phone)); // acc không giao kịp: thôi xin
    }
    if (ready.length < asked.length) this.sync(); // báo kho ngay, không giữ acc chờ hết hạn yêu cầu
    if (ready.length < asked.length) {
      this.#log(`Kho acc chung: giao ${ready.length}/${asked.length} acc (acc còn lại đang bận ở tool code-tele / hub hoặc không dùng được).`);
    }
    return ready;
  }

  // Worker vừa dừng / phiên mới bắt đầu: báo lại kho danh sách acc đang giữ.
  release() {
    this.sync();
  }
}
