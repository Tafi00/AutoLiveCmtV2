import { rm } from "node:fs/promises";
import { join } from "node:path";
import { BrowserSession } from "./browser-session.js";

function assertAccountId(accountId) {
  const value = String(accountId ?? "");
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("Mã tài khoản không hợp lệ.");
  return value;
}

export function accountProfileDirectory(dataDirectory, accountId) {
  const safeId = assertAccountId(accountId);
  return safeId === "default"
    ? join(dataDirectory, "browser-profile")
    : join(dataDirectory, "browser-profiles", safeId);
}

export class AccountSessionManager {
  constructor({ dataDirectory }) {
    this.dataDirectory = dataDirectory;
    this.sessions = new Map();
  }

  get(accountId, platform = "gosh") {
    const safeId = assertAccountId(accountId);
    if (!this.sessions.has(safeId)) {
      this.sessions.set(safeId, new BrowserSession({
        profileDirectory: accountProfileDirectory(this.dataDirectory, safeId),
        platform,
      }));
    }
    return this.sessions.get(safeId);
  }

  async status(account) {
    try {
      return { ...account, session: await this.get(account.id, account.platform).status() };
    } catch (error) {
      return {
        ...account,
        session: {
          running: false,
          loginState: "unknown",
          readyToComment: false,
          url: "",
          error: error.message,
        },
      };
    }
  }

  async statuses(accounts) {
    return Promise.all(accounts.map((account) => this.status(account)));
  }

  async open(accountId, targetUrl, platform) {
    return this.get(accountId, platform).open(targetUrl);
  }

  async openForManualLogin(accountId, targetUrl, platform, options) {
    return this.get(accountId, platform).openForManualLogin(targetUrl, options);
  }

  async openProfile(accountId, platform, options) {
    return this.get(accountId, platform).openProfile(options);
  }

  async updateDisplayName(accountId, displayName, platform) {
    if (platform !== "gosh") {
      throw new Error("Chức năng đổi tên chỉ áp dụng cho tài khoản Gosh.");
    }
    return this.get(accountId, platform).updateDisplayName(displayName);
  }

  async sendComment(accountId, input, platform) {
    return this.get(accountId, platform).sendComment(input);
  }

  async close(accountId) {
    const safeId = assertAccountId(accountId);
    const session = this.sessions.get(safeId);
    if (!session) return;
    await session.close();
    this.sessions.delete(safeId);
  }

  async deleteSession(accountId) {
    const safeId = assertAccountId(accountId);
    await this.close(safeId);
    const targetDir = accountProfileDirectory(this.dataDirectory, safeId);

    await new Promise((resolve) => setTimeout(resolve, 300));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(targetDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
        return;
      } catch (err) {
        if (err.code === "ENOENT") return;
        if (attempt === 4) {
          try {
            const { exec } = await import("node:child_process");
            await new Promise((resolve, reject) => {
              exec(`rm -rf "${targetDir}"`, (error) => (error ? reject(error) : resolve()));
            });
            return;
          } catch {
            throw err;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
  }

  async closeAll() {
    await Promise.allSettled([...this.sessions.values()].map((session) => session.close()));
    this.sessions.clear();
  }
}
