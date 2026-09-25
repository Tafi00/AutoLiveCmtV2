import { rm } from "node:fs/promises";
import { join } from "node:path";
import { BrowserSession } from "./browser-session.js";
import { TokenSession } from "./token-session.js";
import { TokenVault } from "./token-vault.js";

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
  constructor({ dataDirectory, tokenDeps = {} }) {
    this.dataDirectory = dataDirectory;
    this.tokenDeps = tokenDeps;
    this.vault = new TokenVault(join(dataDirectory, "account-tokens.json"));
    this.sessions = new Map();
  }

  init() {
    return this.vault.init();
  }

  #entry(accountId, platform = "gosh", proxy = "") {
    const safeId = assertAccountId(accountId);
    let entry = this.sessions.get(safeId);
    if (entry && entry.token.platform !== platform) {
      // The account was switched to another website: the old tokens and
      // realtime clients belong to the previous one.
      void entry.token.close();
      this.sessions.delete(safeId);
      entry = null;
    }
    if (!entry) {
      const browser = new BrowserSession({
        profileDirectory: accountProfileDirectory(this.dataDirectory, safeId),
        platform,
        proxy,
        onManualLoginExit: () => {
          // The profile may hold a new login (or none): reload tokens from it.
          token.markProfileChanged();
          void token.loadFromProfile().catch(() => {});
        },
      });
      const token = new TokenSession({
        accountId: safeId,
        platform,
        proxy,
        vault: this.vault,
        browser,
        deps: this.tokenDeps,
      });
      entry = { browser, token };
      this.sessions.set(safeId, entry);
    } else if (proxy !== undefined && entry.browser.proxy !== (proxy || "")) {
      entry.browser.proxy = proxy || "";
      entry.token.setProxy(proxy);
    }
    return entry;
  }

  get(accountId, platform = "gosh", proxy = "") {
    return this.#entry(accountId, platform, proxy).browser;
  }

  token(accountId, platform = "gosh", proxy = "") {
    return this.#entry(accountId, platform, proxy).token;
  }

  async status(account) {
    try {
      await this.vault.init();
      return { ...account, session: this.token(account.id, account.platform, account.proxy).status() };
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

  async open(accountId, targetUrl, platform, proxy) {
    return this.get(accountId, platform, proxy).open(targetUrl);
  }

  async openForManualLogin(accountId, targetUrl, platform, options, proxy) {
    const { browser, token } = this.#entry(accountId, platform, proxy);
    await this.vault.init();
    if (!browser.isManualLoginRunning()) await token.syncToProfile().catch(() => {});
    return browser.openForManualLogin(targetUrl, options);
  }

  async login(accountId, credentials, platform, proxy) {
    await this.vault.init();
    return this.token(accountId, platform, proxy).login(credentials);
  }

  async openProfile(accountId, platform, options, proxy) {
    const { browser, token } = this.#entry(accountId, platform, proxy);
    await this.vault.init();
    if (!browser.isManualLoginRunning()) await token.syncToProfile().catch(() => {});
    return browser.openProfile(options);
  }

  async updateDisplayName(accountId, displayName, platform, proxy) {
    if (platform !== "gosh" && platform !== "gaquaytv") {
      throw new Error("Chức năng đổi tên chỉ áp dụng cho tài khoản Gosh và GaQuayTV.");
    }
    await this.vault.init();
    return this.token(accountId, platform, proxy).updateDisplayName(displayName);
  }

  async sendComment(accountId, input, platform, proxy) {
    await this.vault.init();
    return this.token(accountId, platform, proxy).sendComment(input);
  }

  // Warms up an account's connection for its next send; failures surface on
  // the real send instead.
  async prepare(accountId, input, platform, proxy) {
    await this.vault.init();
    await this.token(accountId, platform, proxy).prepare(input).catch(() => {});
  }

  // Reads tokens out of the Chrome profiles of accounts that have none saved
  // yet. Profile reads are throttled inside BrowserSession.
  async loadTokens(accounts, { onlyMissing = true } = {}) {
    await this.vault.init();
    const results = await Promise.all(accounts.map(async (account) => {
      const token = this.token(account.id, account.platform, account.proxy);
      if (onlyMissing && token.hasCredentials()) return { accountId: account.id, ok: true, skipped: true };
      try {
        await token.loadFromProfile();
        return { accountId: account.id, ok: true };
      } catch (error) {
        return { accountId: account.id, ok: false, error: error.message };
      }
    }));
    return {
      loaded: results.filter((result) => result.ok && !result.skipped).length,
      skipped: results.filter((result) => result.skipped).length,
      failed: results.filter((result) => !result.ok),
    };
  }

  async close(accountId) {
    const safeId = assertAccountId(accountId);
    const entry = this.sessions.get(safeId);
    if (!entry) return;
    await Promise.allSettled([entry.token.close(), entry.browser.close()]);
    this.sessions.delete(safeId);
  }

  async deleteSession(accountId) {
    const safeId = assertAccountId(accountId);
    await this.close(safeId);
    await this.vault.init();
    await this.vault.delete(safeId);
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
    await Promise.allSettled([...this.sessions.values()].flatMap(({ browser, token }) => [token.close(), browser.close()]));
    this.sessions.clear();
  }
}
