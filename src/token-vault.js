import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// Saved API tokens per account. Kept outside state.json so they never reach
// the dashboard payload.
export class TokenVault {
  constructor(filePath) {
    this.filePath = filePath;
    this.records = new Map();
    this.loading = null;
    this.writing = Promise.resolve();
  }

  init() {
    this.loading ||= this.#load();
    return this.loading;
  }

  async #load() {
    let raw;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Keep the unreadable file for inspection; tokens can be reloaded from
      // the Chrome profiles.
      await rename(this.filePath, `${this.filePath}.corrupt-${Date.now()}`).catch(() => {});
      return;
    }
    for (const [accountId, record] of Object.entries(parsed?.accounts || {})) {
      if (record && typeof record === "object" && record.credentials) this.records.set(accountId, record);
    }
  }

  get(accountId) {
    return this.records.get(accountId) || null;
  }

  set(accountId, record) {
    this.records.set(accountId, { ...record, updatedAt: new Date().toISOString() });
    return this.#persist();
  }

  delete(accountId) {
    if (!this.records.delete(accountId)) return Promise.resolve();
    return this.#persist();
  }

  #persist() {
    this.writing = this.writing.catch(() => {}).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp`;
      const payload = { version: 1, accounts: Object.fromEntries(this.records) };
      await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    });
    return this.writing;
  }
}
