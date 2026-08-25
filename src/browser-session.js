import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import {
  sendCommentViaLocoTransport,
  sendCommentViaWebsiteTransport,
  shouldBlockBrowserResource,
} from "./direct-comment-transport.js";
import {
  assertPlatformUrl,
  getLocoStreamId,
  normalizePlatform,
  PLATFORMS,
} from "./platforms.js";

chromium.use(StealthPlugin());

const CONFIRM_BUTTON_NAME = /^(Xác nhận(?: thay đổi)?|Đồng ý|Có|Tiếp tục|Confirm(?: change)?|Agree|Yes|Continue|OK)$/i;
const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
];
const SUPPORTED_LOCALES = new Set([
  "en", "ar", "hi", "id", "pt", "sw", "es", "ru", "tr", "th", "uk", "ms", "fil", "vi", "zh-Hans", "zh-Hant",
]);
const IDENTITY_KEYS = [
  "nick",
  "nickname",
  "nickName",
  "displayName",
  "display_name",
  "username",
  "userName",
  "name",
  "email",
  "phone",
  "userID",
  "uid",
  "userId",
  "user_id",
  "id",
];

export function extractDisplayName(payload) {
  const seen = new Set();
  function visit(value) {
    if (!value || typeof value !== "object" || seen.has(value)) return "";
    seen.add(value);
    for (const key of IDENTITY_KEYS) {
      const candidate = value[key];
      if (candidate !== null && candidate !== undefined && typeof candidate !== "object") {
        const clean = String(candidate).trim();
        if (clean && clean.length <= 40 && !/^(true|false|null|undefined)$/i.test(clean)) return clean;
      }
    }
    for (const child of Object.values(value)) {
      const result = visit(child);
      if (result) return result;
    }
    return "";
  }
  return visit(payload);
}

export async function evaluateCdpExpression(webSocketUrl, expression, timeoutMs = 2000) {
  if (typeof globalThis.WebSocket !== "function") return null;
  return new Promise((resolve) => {
    let ws;
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      if (ws) {
        try {
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
          ws.close();
        } catch {}
      }
    };

    timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    try {
      ws = new WebSocket(webSocketUrl);
      ws.onopen = () => {
        ws.send(JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression,
            awaitPromise: true,
            returnByValue: true,
          },
        }));
      };
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.id === 1) {
            cleanup();
            resolve(message.result?.result?.value ?? null);
          }
        } catch {
          cleanup();
          resolve(null);
        }
      };
      ws.onerror = () => {
        cleanup();
        resolve(null);
      };
      ws.onclose = () => {
        cleanup();
        resolve(null);
      };
    } catch {
      cleanup();
      resolve(null);
    }
  });
}

export async function closeCdpBrowser(browserWebSocketUrl, timeoutMs = 1500) {
  if (typeof globalThis.WebSocket !== "function") return false;
  return new Promise((resolve) => {
    let ws;
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      if (ws) {
        try {
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
          ws.close();
        } catch {}
      }
    };

    timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    try {
      ws = new WebSocket(browserWebSocketUrl);
      ws.onopen = () => {
        ws.send(JSON.stringify({
          id: 1,
          method: "Browser.close",
        }));
        setTimeout(() => {
          cleanup();
          resolve(true);
        }, 300);
      };
      ws.onerror = () => {
        cleanup();
        resolve(false);
      };
      ws.onclose = () => {
        cleanup();
        resolve(true);
      };
    } catch {
      cleanup();
      resolve(false);
    }
  });
}

export function goshLoginProbeExpression() {
  return `(async () => {
    const cookies = document.cookie || '';
    const uidMatch = cookies.match(/(?:^|;\\s*)uid=(\\d+)/);
    const uid = uidMatch ? uidMatch[1] : '';

    // 1. Check localStorage for TIM profile or user data
    for (const key of Object.keys(localStorage)) {
      if (key.includes('profile') || key.includes('TIM') || key.includes('user') || key.includes('auth')) {
        const val = localStorage.getItem(key);
        if (val) {
          try {
            const parsed = JSON.parse(val);
            const items = Array.isArray(parsed) ? parsed : [parsed];
            for (const item of items) {
              if (item && typeof item === 'object') {
                const nick = item.nick || item.nickname || item.nickName || item.displayName || item.name || item.username;
                if (nick && nick !== 'Service Assistant' && typeof nick === 'string' && nick.trim().length <= 40) {
                  return { loggedIn: true, data: { displayName: nick.trim(), uid: item.userID || uid } };
                }
              }
            }
          } catch (e) {}
        }
      }
    }

    // 2. Check user_info API endpoint with uid if available
    try {
      const endpoint = uid ? ('/gosh_base/app/user/user_info?uid=' + uid) : '/gosh_base/app/user/user_info';
      const res = await fetch(endpoint, { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        if (json && (json.code === 200 || json.code === 0 || json.data)) {
          return { loggedIn: true, data: json.data || json };
        }
      }
    } catch (e) {}

    // 3. Check profile input in DOM
    try {
      const nameInput = document.querySelector('input[placeholder*="Tên"], input[placeholder*="Name"]');
      if (nameInput && nameInput.value && nameInput.value.trim()) {
        return { loggedIn: true, data: { nickname: nameInput.value.trim() } };
      }
    } catch (e) {}

    // 4. If uid exists in cookies along with auth session
    if (uid && (cookies.includes('tim_user_sig') || cookies.includes('session_id') || cookies.includes('signin_type'))) {
      return { loggedIn: true, data: { uid } };
    }

    return { loggedIn: false };
  })()`;
}

export function locoLoginProbeExpression() {
  return `(async () => {
    // 1. Try device_profile endpoint
    try {
      const res = await fetch('https://api.loco.com/auth/v3/user/device_profile/', { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        if (json && (json.user_id || json.username || json.display_name || json.name || (json.data && (json.data.username || json.data.user_id)))) {
          return { loggedIn: true, data: json.data || json };
        }
      }
    } catch (e) {}

    // 2. Check localStorage
    for (const key of Object.keys(localStorage)) {
      if (/user|profile|token|auth|account/i.test(key)) {
        const val = localStorage.getItem(key);
        if (val) {
          try {
            const parsed = JSON.parse(val);
            const items = Array.isArray(parsed) ? parsed : [parsed];
            for (const item of items) {
              if (item && typeof item === 'object') {
                const name = item.username || item.display_name || item.nick || item.nickname || item.name || item.user_id || item.user_uid;
                if (name && typeof name === 'string' && name.trim().length <= 40) {
                  return { loggedIn: true, data: item };
                }
              }
            }
          } catch (e) {}
        }
      }
    }

    // 3. Check profile link in DOM
    try {
      const profileLink = document.querySelector('a[href^="/streamers/"], a[href^="/user/"]');
      if (profileLink && profileLink.getAttribute('href')) {
        const parts = profileLink.getAttribute('href').split('/').filter(Boolean);
        const name = parts.pop();
        if (name && name !== 'profile') {
          return { loggedIn: true, data: { username: decodeURIComponent(name) } };
        }
      }
    } catch (e) {}

    return { loggedIn: false };
  })()`;
}

export function isBrowserProcessRunning(process) {
  return Boolean(process && process.exitCode === null);
}

export function observeManualLoginUrls(urls, platformOrigin, previouslySawProvider = false) {
  const normalizedUrls = Array.isArray(urls) ? urls : [];
  const providerVisible = normalizedUrls.some((value) => {
    try {
      return new URL(value).hostname === "accounts.google.com";
    } catch {
      return false;
    }
  });
  const platformVisible = normalizedUrls.some((value) => {
    try {
      return new URL(value).origin === platformOrigin;
    } catch {
      return false;
    }
  });
  const sawProvider = previouslySawProvider || providerVisible;
  return {
    sawProvider,
    complete: sawProvider && platformVisible && !providerVisible,
  };
}

async function availableLocalPort() {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once("error", () => resolve(0));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function findChrome() {
  for (const path of CHROME_PATHS) {
    try {
      await access(path, constants.X_OK);
      return path;
    } catch {
      // Try the next known Chrome installation.
    }
  }
  return null;
}

function canonicalPath(value) {
  const url = new URL(value);
  const parts = url.pathname.split("/").filter(Boolean);
  if (SUPPORTED_LOCALES.has(parts[0])) parts.shift();
  return `/${parts.join("/")}`.replace(/\/$/, "") || "/";
}

function isAtTarget(currentValue, targetValue) {
  try {
    const current = new URL(currentValue);
    const target = new URL(targetValue);
    return current.origin === target.origin && canonicalPath(current.href) === canonicalPath(target.href);
  } catch {
    return false;
  }
}

export class BrowserSession {
  constructor({ profileDirectory, platform = "gosh" }) {
    this.profileDirectory = profileDirectory;
    this.platform = normalizePlatform(platform);
    this.definition = PLATFORMS[this.platform];
    this.context = null;
    this.commentPage = null;
    this.profilePage = null;
    this.launching = null;
    this.identity = null;
    this.identityDetection = null;
    this.lastIdentityAttempt = 0;
    this.manualLoginProcess = null;
    this.manualLoginError = null;
    this.suppressManualLoginReopen = false;
  }

  async open(targetUrl = this.definition.homeUrl) {
    const safeUrl = assertPlatformUrl(targetUrl || this.definition.homeUrl, this.platform);
    await this.#ensureContext();

    if (!isAtTarget(this.commentPage.url(), safeUrl)) {
      await this.commentPage.goto(safeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    await this.commentPage.bringToFront();
    return this.status();
  }

  async #ensureContext() {
    if (isBrowserProcessRunning(this.manualLoginProcess)) {
      const error = new Error("Hãy hoàn tất đăng nhập rồi đóng cửa sổ Chrome đăng nhập trước.");
      error.code = "USER_ACTION_REQUIRED";
      throw error;
    }
    if (this.launching) await this.launching;

    if (!this.context) {
      this.launching = this.#launch();
      try {
        await this.launching;
      } finally {
        this.launching = null;
      }
    }

    if (!this.commentPage || this.commentPage.isClosed()) {
      this.commentPage = this.context.pages()[0] || (await this.context.newPage());
    }
  }

  async #launch() {
    const executablePath = await findChrome();
    if (!executablePath) {
      throw new Error("Không tìm thấy Google Chrome trong thư mục Applications.");
    }

    await mkdir(this.profileDirectory, { recursive: true });
    this.context = await chromium.launchPersistentContext(this.profileDirectory, {
      executablePath,
      headless: true,
      viewport: null,
      locale: "vi-VN",
      // Google rejects OAuth in Chrome instances carrying Playwright's default
      // automation switch. The app still controls the browser after login, but
      // the sign-in flow sees a regular installed Chrome profile.
      ignoreDefaultArgs: ["--enable-automation"],
      args: [
        "--headless=new",
        "--autoplay-policy=user-gesture-required",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=MediaRouter",
        "--mute-audio",
      ],
    });

    await this.context.route("**/*", async (route) => {
      const request = route.request();
      if (shouldBlockBrowserResource({
        platform: this.platform,
        resourceType: request.resourceType(),
        url: request.url(),
      })) {
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    this.context.on("close", () => {
      this.context = null;
      this.commentPage = null;
      this.profilePage = null;
    });
    this.commentPage = this.context.pages()[0] || (await this.context.newPage());
  }

  async openForManualLogin(targetUrl = this.definition.homeUrl, { autoCloseOnLogin = false } = {}) {
    const safeUrl = assertPlatformUrl(targetUrl || this.definition.homeUrl, this.platform);
    const executablePath = await findChrome();
    if (!executablePath) {
      throw new Error("Không tìm thấy Google Chrome trong thư mục Applications.");
    }

    if (isBrowserProcessRunning(this.manualLoginProcess)) {
      return {
        running: true,
        loginState: this.identity ? "unknown_or_signed_in" : "manual_login",
        readyToComment: false,
        url: safeUrl,
        identity: this.identity,
      };
    }

    // Release Chrome's profile lock before starting a completely normal Chrome
    // process. No Playwright/CDP flags are present during Google OAuth.
    await this.context?.close();
    this.context = null;
    this.commentPage = null;
    this.profilePage = null;
    await mkdir(this.profileDirectory, { recursive: true });

    this.suppressManualLoginReopen = false;
    this.manualLoginError = null;
    const debugPort = await availableLocalPort();
    const child = spawn(executablePath, [
      `--user-data-dir=${this.profileDirectory}`,
      `--remote-debugging-port=${debugPort}`,
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
      safeUrl,
    ], {
      stdio: "ignore",
    });
    this.manualLoginProcess = child;

    child.once("error", (error) => {
      this.manualLoginError = error.message;
      if (this.manualLoginProcess === child) this.manualLoginProcess = null;
    });
    child.once("exit", () => {
      if (this.manualLoginProcess === child) this.manualLoginProcess = null;
    });
    void this.#monitorManualLogin(child, debugPort, new URL(safeUrl).origin, { autoCloseOnLogin });

    return {
      running: true,
      loginState: this.identity ? "unknown_or_signed_in" : "manual_login",
      readyToComment: false,
      url: safeUrl,
      identity: this.identity,
    };
  }

  async #monitorManualLogin(child, debugPort, platformOrigin, { autoCloseOnLogin = false } = {}) {
    while (
      isBrowserProcessRunning(child)
      && this.manualLoginProcess === child
      && !this.suppressManualLoginReopen
    ) {
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json`, {
          signal: AbortSignal.timeout(1_500),
        });
        if (response.ok) {
          const targets = await response.json();
          const targetList = Array.isArray(targets) ? targets : [];

          const expression = this.platform === "loco"
            ? locoLoginProbeExpression()
            : goshLoginProbeExpression();

          const pageTargets = targetList.filter((target) => {
            if (!target.webSocketDebuggerUrl) return false;
            try {
              const url = new URL(target.url);
              return url.origin === platformOrigin || this.definition.hostPattern.test(url.hostname);
            } catch {
              return false;
            }
          });

          let detectedDisplayName = "";
          for (const target of pageTargets) {
            const probeResult = await evaluateCdpExpression(target.webSocketDebuggerUrl, expression, 1_500);
            if (probeResult && (probeResult.loggedIn || probeResult.data)) {
              const name = extractDisplayName(probeResult.data || probeResult);
              if (name) {
                detectedDisplayName = name;
                break;
              }
            }
          }

          if (detectedDisplayName) {
            this.identity = {
              displayName: detectedDisplayName,
              source: "manual_login",
              detectedAt: new Date().toISOString(),
            };

            // ONLY auto-close Chrome if this was explicitly a login prompt flow
            if (autoCloseOnLogin) {
              await new Promise((resolve) => setTimeout(resolve, 1500));
              await this.#terminateManualLogin(child, debugPort);
              return;
            }
          }
        }
      } catch {
        // Chrome may need a moment to expose its local diagnostics endpoint.
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }

  async #terminateManualLogin(child, debugPort) {
    try {
      const versionRes = await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
        signal: AbortSignal.timeout(1_000),
      }).catch(() => null);
      if (versionRes?.ok) {
        const versionData = await versionRes.json().catch(() => null);
        if (versionData?.webSocketDebuggerUrl) {
          await closeCdpBrowser(versionData.webSocketDebuggerUrl, 1_000);
        }
      }
    } catch {}

    if (isBrowserProcessRunning(child)) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }

    setTimeout(() => {
      if (isBrowserProcessRunning(child)) {
        try {
          child.kill("SIGKILL");
        } catch {}
      }
    }, 1_200);
  }

  async status() {
    if (isBrowserProcessRunning(this.manualLoginProcess)) {
      return {
        running: true,
        loginState: this.identity ? "unknown_or_signed_in" : "manual_login",
        readyToComment: false,
        url: this.definition.homeUrl,
        identity: this.identity,
      };
    }
    if (!this.context || !this.commentPage || this.commentPage.isClosed()) {
      return {
        running: false,
        loginState: this.identity ? "unknown_or_signed_in" : "unknown",
        readyToComment: false,
        url: "",
        identity: this.identity,
        ...(this.manualLoginError ? { error: this.manualLoginError } : {}),
      };
    }

    const loginButton = this.commentPage.getByRole("button", {
      name: /^(Đăng nhập|Log in|Login|Sign in)$/i,
    });
    const commentBox = this.commentPage
      .getByPlaceholder(this.platform === "loco"
        ? /Slow mode|Send a message|Chat|Say something/i
        : /Nói gì đó|Say something|Write a message/i)
      .first();

    const [loginVisible, commentVisible] = await Promise.all([
      loginButton.isVisible().catch(() => false),
      commentBox.isVisible().catch(() => false),
    ]);

    if (!loginVisible && !this.identity && Date.now() - this.lastIdentityAttempt > 5_000) {
      void this.detectIdentity().catch(() => {});
    }

    return {
      running: true,
      loginState: loginVisible ? "signed_out" : "unknown_or_signed_in",
      readyToComment: commentVisible && !loginVisible,
      url: this.commentPage.url(),
      identity: this.identity,
    };
  }

  async detectIdentity({ force = false } = {}) {
    if (this.identity && !force) return this.identity;
    if (this.identityDetection) return this.identityDetection;
    this.lastIdentityAttempt = Date.now();
    this.identityDetection = this.#detectIdentity();
    try {
      this.identity = await this.identityDetection;
      return this.identity;
    } finally {
      this.identityDetection = null;
    }
  }

  async #detectIdentity() {
    await this.#ensureContext();
    const apiPayload = await this.commentPage.evaluate(async (platform) => {
      const endpoint = platform === "loco"
        ? "https://api.loco.com/auth/v3/user/device_profile/"
        : "/gosh_base/app/user/user_info";
      const response = await fetch(endpoint, { credentials: "include" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }, this.platform).catch(() => null);
    const apiName = extractDisplayName(apiPayload);
    if (apiName) {
      return { displayName: apiName, source: this.platform === "loco" ? "device_profile" : "user_info", detectedAt: new Date().toISOString() };
    }

    const storagePayload = await this.commentPage.evaluate(() => {
      try {
        for (const key of Object.keys(localStorage)) {
          if (key.includes("profile") || key.includes("TIM") || key.includes("user") || key.includes("auth")) {
            const val = localStorage.getItem(key);
            try {
              const parsed = JSON.parse(val);
              const items = Array.isArray(parsed) ? parsed : [parsed];
              for (const item of items) {
                if (item && typeof item === "object") {
                  const nick = item.nick || item.nickname || item.nickName || item.displayName || item.name || item.username;
                  if (nick && nick !== "Service Assistant" && typeof nick === "string" && nick.trim().length <= 40) {
                    return item;
                  }
                }
              }
            } catch {}
          }
        }
      } catch {}
      return null;
    }).catch(() => null);
    const storageName = extractDisplayName(storagePayload);
    if (storageName) {
      return { displayName: storageName, source: "localStorage", detectedAt: new Date().toISOString() };
    }

    if (this.platform === "loco") {
      const profileButton = this.commentPage.getByRole("button", { name: /^Your profile$/i }).first();
      if (await profileButton.isVisible().catch(() => false)) {
        await profileButton.click().catch(() => {});
        const profileLink = this.commentPage.locator('a[href^="/streamers/"]').filter({ hasText: /Channel preview/i }).first();
        const href = await profileLink.getAttribute("href").catch(() => "");
        const profileName = href?.split("/").filter(Boolean).at(-1) || "";
        await profileButton.click().catch(() => {});
        if (profileName) {
          return { displayName: decodeURIComponent(profileName), source: "profile_menu", detectedAt: new Date().toISOString() };
        }
      }
      const error = new Error("Chưa đọc được tên tài khoản Loco. Hãy hoàn tất đăng nhập rồi làm mới.");
      error.code = "LOGIN_REQUIRED";
      throw error;
    }

    const profilePage = await this.#getProfilePage();
    const loginButton = profilePage.getByRole("button", {
      name: /^(Đăng nhập|Log in|Login|Sign in)$/i,
    });
    if (await loginButton.isVisible().catch(() => false)) {
      const error = new Error("Phiên chưa đăng nhập.");
      error.code = "LOGIN_REQUIRED";
      throw error;
    }
    const nameInput = profilePage.getByPlaceholder(/^(Tên|Name)$/i).first();
    await nameInput.waitFor({ state: "visible", timeout: 10_000 });
    const displayName = (await nameInput.inputValue()).trim();
    if (!displayName) throw new Error("Không đọc được tên từ hồ sơ.");
    return { displayName, source: "profile", detectedAt: new Date().toISOString() };
  }

  async openProfile() {
    return this.openForManualLogin(this.definition.profileUrl);
  }

  async #getProfilePage() {
    await this.#ensureContext();
    if (!this.profilePage || this.profilePage.isClosed()) {
      this.profilePage = await this.context.newPage();
    }
    if (!isAtTarget(this.profilePage.url(), this.definition.profileUrl)) {
      await this.profilePage.goto(this.definition.profileUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    return this.profilePage;
  }

  async updateDisplayName(displayName) {
    const cleanName = String(displayName ?? "").trim();
    if (!cleanName) throw new Error("Tên hiển thị không được để trống.");
    const maxLength = this.platform === "loco" ? 30 : 20;
    if (cleanName.length > maxLength) {
      throw new Error(`Tên hiển thị không được vượt quá ${maxLength} ký tự.`);
    }

    if (this.platform === "loco") {
      let createdContext = false;
      let context = this.context;

      if (!context) {
        const executablePath = await findChrome();
        if (!executablePath) throw new Error("Không tìm thấy Google Chrome trong thư mục Applications.");
        context = await chromium.launchPersistentContext(this.profileDirectory, {
          executablePath,
          headless: true,
          args: ["--headless=new", "--mute-audio", "--no-sandbox"],
        });
        createdContext = true;
      }

      try {
        let cookies = [];
        try {
          cookies = await context.cookies();
        } catch {
          const page = context.pages()[0] || (await context.newPage());
          const cdp = await context.newCDPSession(page);
          const cdpRes = await cdp.send("Network.getAllCookies");
          cookies = cdpRes.cookies || [];
        }
        const tokenCookie = cookies.find((c) => c.name === "access_token");
        const refreshCookie = cookies.find((c) => c.name === "refresh_token");
        const deviceCookie = cookies.find((c) => c.name === "device_id");

        let accessToken = tokenCookie ? tokenCookie.value : "";
        let refreshToken = refreshCookie ? refreshCookie.value : "";
        const deviceId = deviceCookie ? deviceCookie.value : "85c577c86fa0447fe9ec70606897e71flive";

        if (!accessToken && !refreshToken) {
          const error = new Error("Bạn cần đăng nhập Loco trước khi đổi tên.");
          error.code = "LOGIN_REQUIRED";
          throw error;
        }

        const callRefresh = async (currToken, currRefresh) => {
          if (!currRefresh) return null;
          const refRes = await fetch("https://api.loco.com/auth/v3/user/refresh_token/", {
            method: "POST",
            headers: {
              Authorization: currToken,
              "DEVICE-ID": deviceId,
              "X-PLATFORM": "7",
              "X-CLIENT-ID": "TlwKp1zmF6eKFpcisn3FyR18WkhcPkZtzwPVEEC3",
              "X-CLIENT-SECRET": "Kp7tYlUN7LXvtcSpwYvIitgYcLparbtsQSe5AdyyCdiEJBP53Vt9J8eB4AsLdChIpcO2BM19RA3HsGtqDJFjWmwoonvMSG3ZQmnS8x1YIM8yl82xMXZGbE3NKiqmgBVU",
              "Content-Type": "application/json",
              Origin: "https://loco.com",
              Referer: "https://loco.com/",
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            },
            body: JSON.stringify({ refresh_token: currRefresh }),
          });
          const refData = await refRes.json().catch(() => ({}));
          if (refData?.access_token && typeof refData.access_token === "string") {
            accessToken = refData.access_token;
            if (refData.refresh_token && typeof refData.refresh_token === "string") refreshToken = refData.refresh_token;
            const oneYear = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
            await context.addCookies([
              { name: "access_token", value: accessToken, domain: ".loco.com", path: "/", expires: oneYear, secure: true, sameSite: "Lax" },
              ...(refreshToken ? [{ name: "refresh_token", value: refreshToken, domain: ".loco.com", path: "/", expires: oneYear, secure: true, sameSite: "Lax" }] : []),
              { name: "mode", value: "logged-in", domain: ".loco.com", path: "/", expires: oneYear },
            ]);
            return refData;
          }
          return null;
        };

        const callUpdate = async (token) => {
          let dob = "24/08/2001";
          let gender = 0;
          let bio = "";
          try {
            const pRes = await fetch("https://api.loco.com/ivr/v1/profile/me/", {
              headers: {
                Authorization: token,
                Origin: "https://loco.com",
                Referer: "https://loco.com/",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
              },
            });
            if (pRes.ok) {
              const pJson = await pRes.json();
              if (pJson?.data) {
                if (pJson.data.dob) dob = pJson.data.dob;
                if (pJson.data.gender !== undefined) gender = pJson.data.gender;
                if (pJson.data.bio) bio = pJson.data.bio;
              }
            }
          } catch {}

          const res = await fetch("https://api.loco.com/ivr/v1/profile/update/", {
            method: "POST",
            headers: {
              Authorization: token,
              "Content-Type": "application/json",
              Origin: "https://loco.com",
              Referer: "https://loco.com/",
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            },
            body: JSON.stringify({
              username: cleanName,
              bio,
              dob,
              gender,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (data.message === "User Action Not allowed") {
            throw new Error("Tài khoản Loco này đã đổi username trước đó và nền tảng không cho phép đổi lại lần thứ hai.");
          }
          if (res.status === 401 || data.status_code === 401 || data.error_code === "E005") {
            return { ok: false, status: 401, data };
          }
          const isSuccess = res.ok && Boolean(data.success && (data.message === "Profile updated successfully" || data.data?.username?.toLowerCase() === cleanName.toLowerCase()));
          if (!isSuccess) {
            throw new Error(data.message || `Lỗi cập nhật tên Loco (HTTP ${res.status})`);
          }
          return { ok: true, status: res.status, data };
        };

        let updateResult = await callUpdate(accessToken);

        // If 401 / expired token, refresh token and retry
        if (!updateResult.ok && (updateResult.status === 401 || updateResult.data?.status_code === 401 || updateResult.data?.error_code === "E005")) {
          const refreshed = await callRefresh(accessToken, refreshToken);
          if (refreshed?.access_token) {
            updateResult = await callUpdate(accessToken);
          }
        }

        if (!updateResult.ok) {
          throw new Error(updateResult.data?.message || `Lỗi cập nhật tên Loco (HTTP ${updateResult.status})`);
        }

        // Always refresh token after successful rename so new JWT contains updated username
        await callRefresh(accessToken, refreshToken);

        this.identity = { displayName: cleanName, source: "loco_api", detectedAt: new Date().toISOString() };
        return { displayName: cleanName, updatedAt: new Date().toISOString() };
      } finally {
        if (createdContext) {
          await context.close().catch(() => {});
        }
      }
    }

    let createdContext = false;
    let profilePage = this.profilePage;
    let context = this.context;

    if (!context) {
      const executablePath = await findChrome();
      if (!executablePath) throw new Error("Không tìm thấy Google Chrome trong thư mục Applications.");
      context = await chromium.launchPersistentContext(this.profileDirectory, {
        executablePath,
        headless: true,
        args: ["--headless=new", "--mute-audio", "--no-sandbox"],
      });
      createdContext = true;
      profilePage = await context.newPage();
      await profilePage.goto(this.definition.profileUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } else {
      profilePage = await this.#getProfilePage();
    }

    const loginButton = profilePage.getByRole("button", {
      name: /^(Đăng nhập|Log in|Login|Sign in)$/i,
    });
    if (await loginButton.isVisible().catch(() => false)) {
      if (!createdContext) await profilePage.bringToFront().catch(() => {});
      const error = new Error("Bạn cần đăng nhập trước khi đổi tên.");
      error.code = "LOGIN_REQUIRED";
      throw error;
    }

    const acceptBrowserDialog = (dialog) => dialog.accept().catch(() => {});
    profilePage.on("dialog", acceptBrowserDialog);

    try {
      const nameInput = profilePage.getByPlaceholder(/^(Tên|Name)$/i).first();
      await nameInput.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {
        throw new Error("Không tìm thấy trường tên trong trang hồ sơ.");
      });
      if ((await nameInput.inputValue()).trim() === cleanName) {
        this.identity = { displayName: cleanName, source: "profile", detectedAt: new Date().toISOString() };
        return { displayName: cleanName, updatedAt: new Date().toISOString(), unchanged: true };
      }
      await nameInput.fill(cleanName);

      const saveButton = profilePage.getByRole("button", { name: /^(Lưu|Save)$/i }).first();
      const discardButton = profilePage
        .getByRole("button", { name: /^(Bỏ|Hủy|Cancel|Discard)$/i })
        .first();
      await saveButton.waitFor({ state: "visible", timeout: 10_000 });
      if (!(await saveButton.isEnabled())) {
        throw new Error("Tên mới chưa hợp lệ hoặc không khác tên hiện tại.");
      }

      await saveButton.click();
      let saved = false;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await profilePage.waitForTimeout(250);

        const confirmButton = profilePage
          .getByRole("button", { name: CONFIRM_BUTTON_NAME })
          .last();
        if (
          (await confirmButton.isVisible().catch(() => false))
          && (await confirmButton.isEnabled().catch(() => false))
        ) {
          await confirmButton.click();
          continue;
        }

        if (!(await discardButton.isEnabled().catch(() => true))) {
          saved = true;
          break;
        }
      }
      if (!saved) {
        throw new Error("Trang hồ sơ không phản hồi sau khi ứng dụng tự xác nhận đổi tên.");
      }

      this.identity = { displayName: cleanName, source: "profile", detectedAt: new Date().toISOString() };
      return { displayName: cleanName, updatedAt: new Date().toISOString() };
    } finally {
      profilePage.off("dialog", acceptBrowserDialog);
      if (createdContext) {
        await context.close().catch(() => {});
      } else if (this.commentPage && !this.commentPage.isClosed()) {
        await this.commentPage.bringToFront().catch(() => {});
      }
    }
  }

  async sendComment({ channelUrl, content }) {
    const safeUrl = assertPlatformUrl(channelUrl, this.platform);
    const cleanContent = String(content ?? "").trim();
    if (!cleanContent) throw new Error("Không có nội dung để gửi.");

    await this.open(safeUrl);
    const status = await this.status();
    if (status.loginState === "signed_out") {
      const error = new Error("Bạn cần đăng nhập trong cửa sổ Chrome trước khi gửi.");
      error.code = "LOGIN_REQUIRED";
      throw error;
    }

    const textBox = this.commentPage
      .getByPlaceholder(this.platform === "loco"
        ? /Slow mode|Send a message|Chat|Say something/i
        : /Nói gì đó|Say something|Write a message/i)
      .first();
    await textBox.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {
      throw new Error("Không tìm thấy ô chat. Hãy kiểm tra URL phòng live và trạng thái phòng.");
    });

    if (this.platform === "loco") {
      const matureConfirmation = this.commentPage
        .getByRole("button", { name: /Yes, I am 18\+|I am 18\+|Tôi đã đủ 18 tuổi/i })
        .first();
      if (await matureConfirmation.isVisible().catch(() => false)) {
        const error = new Error("Phòng Loco yêu cầu xác nhận độ tuổi trong Chrome trước khi gửi chat.");
        error.code = "USER_ACTION_REQUIRED";
        throw error;
      }
    }

    await textBox.fill(cleanContent);
    const sendButton = this.commentPage.getByRole("button", { name: /^(Gửi|Send)$/i }).first();
    await sendButton.waitFor({ state: "visible", timeout: 10_000 });
    if (!(await sendButton.isEnabled())) {
      throw new Error("Nút gửi đang bị vô hiệu hóa. Tin nhắn có thể không hợp lệ hoặc phòng không cho chat.");
    }

    const directResult = await this.commentPage.evaluate(
      this.platform === "loco" ? sendCommentViaLocoTransport : sendCommentViaWebsiteTransport,
      this.platform === "loco" ? {
        content: cleanContent,
        streamId: getLocoStreamId(safeUrl),
        timeoutMs: 12_000,
      } : {
        content: cleanContent,
        timeoutMs: 12_000,
      },
    ).catch(() => ({
      status: "failed",
      attempted: true,
      reason: "page_evaluate_failed",
    }));

    if (directResult.status === "sent") {
      await textBox.fill("").catch(() => {});
      return {
        sentAt: new Date(directResult.sentAt || Date.now()).toISOString(),
        url: this.commentPage.url(),
        transport: this.platform === "loco" ? "https" : "websocket",
        provider: directResult.provider,
        providerMessageId: directResult.providerMessageId,
      };
    }

    if (directResult.attempted) {
      const transportName = this.platform === "loco" ? "HTTPS" : "kết nối realtime";
      throw new Error(`Gửi qua ${transportName} thất bại: ${directResult.reason || "không rõ nguyên nhân"}`);
    }

    await sendButton.click();
    await this.commentPage.waitForTimeout(500);
    return {
      sentAt: new Date().toISOString(),
      url: this.commentPage.url(),
      transport: "browser-ui-fallback",
      fallbackReason: directResult.reason,
    };
  }

  async close() {
    this.suppressManualLoginReopen = true;
    const manualLoginProcess = this.manualLoginProcess;
    if (isBrowserProcessRunning(manualLoginProcess)) {
      try {
        manualLoginProcess.kill("SIGKILL");
        await new Promise((resolve) => {
          manualLoginProcess.once("exit", resolve);
          setTimeout(resolve, 500);
        });
      } catch {}
    }
    this.manualLoginProcess = null;
    try {
      await this.context?.close();
    } catch {}
    this.context = null;
    this.commentPage = null;
    this.profilePage = null;
  }
}
