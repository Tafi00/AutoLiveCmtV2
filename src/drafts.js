// Giá trị các ô nhập trên web (link, proxy, số mắt, cài đặt...) lưu ở máy chủ
// để mọi thiết bị thấy cùng một bản, cập nhật realtime.
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const MAX_KEY = 80;
const MAX_VALUE_CHARS = 500_000;
const MAX_TOTAL_CHARS = 4_000_000;
const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

function cleanValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") return value.length > MAX_VALUE_CHARS ? value.slice(0, MAX_VALUE_CHARS) : value;
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => String(item).slice(0, 200));
  return null;
}

export class DraftStore {
  #file;
  #values = {};
  #rev = 0;
  #updatedAt = 0;
  #origin = "";
  #writeTimer = null;
  #writing = Promise.resolve();

  constructor({ dataDirectory }) {
    this.#file = join(dataDirectory, "ui-drafts.json");
  }

  async init() {
    await mkdir(dirname(this.#file), { recursive: true });
    try {
      const raw = JSON.parse(await readFile(this.#file, "utf8"));
      if (raw && typeof raw.values === "object") this.#values = raw.values;
      this.#rev = Number(raw?.rev) || 0;
      this.#updatedAt = Number(raw?.updatedAt) || 0;
    } catch {
      this.#values = {};
    }
    return this;
  }

  snapshot() {
    return { values: this.#values, rev: this.#rev, updatedAt: this.#updatedAt, origin: this.#origin };
  }

  patch(input, origin = "") {
    if (!input || typeof input !== "object") throw new Error("Thiếu dữ liệu nháp.");
    const next = { ...this.#values };
    let changed = false;
    for (const [key, raw] of Object.entries(input)) {
      if (key.length > MAX_KEY || !KEY_PATTERN.test(key)) continue;
      const value = cleanValue(raw);
      if (value === null) {
        if (key in next) {
          delete next[key];
          changed = true;
        }
        continue;
      }
      if (JSON.stringify(next[key]) === JSON.stringify(value)) continue;
      next[key] = value;
      changed = true;
    }
    if (!changed) return this.snapshot();
    if (JSON.stringify(next).length > MAX_TOTAL_CHARS) throw new Error("Dữ liệu nháp quá lớn.");
    this.#values = next;
    this.#rev += 1;
    this.#updatedAt = Date.now();
    this.#origin = String(origin || "").slice(0, 64);
    this.#scheduleWrite();
    return this.snapshot();
  }

  #scheduleWrite() {
    clearTimeout(this.#writeTimer);
    this.#writeTimer = setTimeout(() => {
      this.#writing = this.#writing.then(() => this.#write()).catch(() => {});
    }, 400);
    this.#writeTimer.unref?.();
  }

  async #write() {
    const temp = `${this.#file}.tmp`;
    const body = `${JSON.stringify({ values: this.#values, rev: this.#rev, updatedAt: this.#updatedAt })}\n`;
    await writeFile(temp, body, "utf8");
    await rename(temp, this.#file);
  }

  async flush() {
    clearTimeout(this.#writeTimer);
    await this.#writing;
    await this.#write();
  }
}
