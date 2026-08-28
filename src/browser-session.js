import { access, lstat, mkdir, readlink, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
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
export function getChromeCandidatePaths() {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    return [
      join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      localAppData ? join(localAppData, "Google", "Chrome", "Application", "chrome.exe") : "",
      join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      localAppData ? join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe") : "",
    ].filter(Boolean);
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
}

export const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
];
export const LOCO_API_ENDPOINTS = {
  // Loco's web client refreshes sessions through auth v3.  The old v1 path
  // returns INVALID_ROUTE; leaving it here makes a successful username
  // update invalidate the access token without issuing the replacement token,
  // so the next chat request is rejected.
  refreshToken: "https://api.loco.com/auth/v3/user/refresh_token/",
  legacyRefreshToken: "https://api.getloconow.com/v3/user/refresh_token/",
  profile: "https://api.loco.com/ivr/v1/profile/me/",
  updateProfile: "https://api.loco.com/ivr/v1/profile/update/",
  legacyUpdateProfile: "https://ivory.loco.gg/v1/profile/update/",
};

export const discoveredApiEndpoints = new Map();

export function recordObservedEndpoint(url, method = "GET", status = 200) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes("loco") && !host.includes("gosh") && !host.includes("getloconow") && !host.includes("vizzlive")) return;

    const path = parsed.pathname;
    let category = "other";
    let name = path;

    if (path.includes("/chat/") || url.includes("send=true") || path.includes("/send_msg")) {
      category = "chat";
      name = "Gửi Chat";
    } else if (path.includes("/profile/update") || path.includes("/user_center")) {
      category = "profile_update";
      name = "Đổi tên";
    } else if (path.includes("/refresh_token")) {
      category = "auth_refresh";
      name = "Làm mới Token";
    } else if (path.includes("/profile/me") || path.includes("/user_info")) {
      category = "profile_info";
      name = "Hồ sơ tài khoản";
    } else if (path.includes("/live/") || path.includes("/streams/")) {
      category = "live_stream";
      name = "Phòng Live";
    } else if (path.includes("/config")) {
      category = "config";
      name = "Cấu hình Website";
    } else {
      return;
    }

    discoveredApiEndpoints.set(`${method}:${path}`, {
      name,
      category,
      method,
      host,
      path,
      fullUrl: url,
      status,
      lastSeen: new Date().toISOString(),
    });
  } catch {}
}

export const CHROME_PROFILE_IGNORE_DEFAULT_ARGS = [
  "--enable-automation",
  "--password-store=basic",
  "--use-mock-keychain",
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
    const identityKeys = ['username', 'display_name', 'displayName', 'nickname', 'nick', 'name', 'user_id', 'user_uid', 'userId', 'uid'];
    const findIdentity = (value, depth = 0, seen = new Set()) => {
      if (!value || typeof value !== 'object' || depth > 8 || seen.has(value)) return null;
      seen.add(value);
      for (const key of identityKeys) {
        const candidate = value[key];
        if (candidate !== null && candidate !== undefined && typeof candidate !== 'object') {
          const clean = String(candidate).trim();
          if (clean && clean.length <= 40 && !/^(true|false|null|undefined)$/i.test(clean)) return { [key]: clean };
        }
      }
      for (const child of Object.values(value)) {
        const found = findIdentity(child, depth + 1, seen);
        if (found) return found;
      }
      return null;
    };
    const cookieMap = Object.fromEntries((document.cookie || '').split(';').map((part) => {
      const index = part.indexOf('=');
      return index < 0 ? [part.trim(), ''] : [part.slice(0, index).trim(), part.slice(index + 1)];
    }).filter(([key]) => key));

    // The current Loco site exposes the signed-in identity in its access-token
    // JWT. This avoids the device_profile request, which is rejected by CORS.
    try {
      const payload = (cookieMap.access_token || '').split('.')[1];
      if (payload) {
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(decodeURIComponent(Array.from(atob(normalized), (char) =>
          '%' + char.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
        const identity = findIdentity(decoded);
        if (identity) return { loggedIn: true, data: identity };
      }
    } catch (e) {}

    // Newer Loco builds keep user data inside nested Zustand stores.
    for (const key of Object.keys(localStorage)) {
      if (/user|profile|token|auth|account|app-store|login/i.test(key)) {
        const val = localStorage.getItem(key);
        if (val) {
          try {
            const parsed = JSON.parse(val);
            const identity = findIdentity(parsed);
            if (identity) return { loggedIn: true, data: identity };
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

    if (cookieMap.access_token && cookieMap.refresh_token && cookieMap.mode === 'logged-in') {
      const fallbackId = localStorage.getItem('userUid');
      if (fallbackId) return { loggedIn: true, data: { user_uid: fallbackId.replace(/^['"]|['"]$/g, '') } };
    }

    return { loggedIn: false };
  })()`;
}

export function isBrowserProcessRunning(process) {
  return Boolean(process && process.exitCode === null);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForProfileUnlock(profileDirectory, timeoutMs = 5_000) {
  const lockPath = join(profileDirectory, "SingletonLock");
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      await lstat(lockPath);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    try {
      const lockTarget = await readlink(lockPath);
      const pid = Number(lockTarget.match(/-(\d+)$/)?.[1]);
      if (Number.isSafeInteger(pid) && pid > 0) {
        let processExists = true;
        try {
          process.kill(pid, 0);
        } catch (error) {
          if (error.code === "ESRCH") processExists = false;
        }
        if (!processExists) {
          await Promise.allSettled(["SingletonLock", "SingletonCookie", "SingletonSocket"].map((name) =>
            unlink(join(profileDirectory, name))));
          return;
        }
      }
    } catch (error) {
      if (error.code !== "EINVAL" && error.code !== "ENOENT") throw error;
    }
    if (Date.now() >= deadline) {
      const error = new Error("Chrome chưa nhả khóa hồ sơ. Hãy thử lại sau vài giây.");
      error.code = "PROFILE_LOCKED";
      throw error;
    }
    await delay(50);
  }
}

async function waitForProcessExit(child, timeoutMs) {
  if (!isBrowserProcessRunning(child)) return true;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off?.("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(!isBrowserProcessRunning(child)), timeoutMs);
    child.once?.("exit", onExit);
  });
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
  for (const path of getChromeCandidatePaths()) {
    try {
      await access(path, constants.F_OK);
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
    this.manualLoginDebugPort = null;
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
      throw new Error("Không tìm thấy Google Chrome hoặc Microsoft Edge trên máy tính của bạn.");
    }

    await mkdir(this.profileDirectory, { recursive: true });
    await waitForProfileUnlock(this.profileDirectory);
    this.context = await chromium.launchPersistentContext(this.profileDirectory, {
      executablePath,
      headless: true,
      viewport: null,
      locale: "vi-VN",
      // Google rejects OAuth in Chrome instances carrying Playwright's default
      // automation switch. The app still controls the browser after login, but
      // the sign-in flow sees a regular installed Chrome profile.
      // The visible Chrome login process uses macOS Keychain. Playwright's
      // mock-keychain defaults would make the same encrypted cookies unreadable
      // and can rewrite them with a different key.
      ignoreDefaultArgs: CHROME_PROFILE_IGNORE_DEFAULT_ARGS,
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

    this.context.on("response", (res) => {
      recordObservedEndpoint(res.url(), res.request().method(), res.status());
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
      throw new Error("Không tìm thấy Google Chrome hoặc Microsoft Edge trên máy tính của bạn.");
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
    const activeContext = this.context;
    if (activeContext) await this.#closeTemporaryContext(activeContext);
    this.context = null;
    this.commentPage = null;
    this.profilePage = null;
    await mkdir(this.profileDirectory, { recursive: true });
    await waitForProfileUnlock(this.profileDirectory);

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
    this.manualLoginDebugPort = debugPort;

    child.once("error", (error) => {
      this.manualLoginError = error.message;
      if (this.manualLoginProcess === child) {
        this.manualLoginProcess = null;
        this.manualLoginDebugPort = null;
      }
    });
    child.once("exit", () => {
      if (this.manualLoginProcess === child) {
        this.manualLoginProcess = null;
        this.manualLoginDebugPort = null;
      }
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

          if (detectedDisplayName && this.identity?.source !== "explicit_update") {
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

    if (await waitForProcessExit(child, 1_500)) {
      await waitForProfileUnlock(this.profileDirectory);
      return;
    }

    if (isBrowserProcessRunning(child)) {
      try {
        child.kill("SIGTERM");
      } catch {}
    }
    if (await waitForProcessExit(child, 1_200)) {
      await waitForProfileUnlock(this.profileDirectory);
      return;
    }
    if (isBrowserProcessRunning(child)) {
      try {
        child.kill("SIGKILL");
      } catch {}
    }
    await waitForProcessExit(child, 1_200);
    if (isBrowserProcessRunning(child)) {
      throw new Error("Không thể đóng cửa sổ Chrome của tài khoản.");
    }
    await waitForProfileUnlock(this.profileDirectory);
  }

  async #closeManualLoginForProfileUse() {
    const child = this.manualLoginProcess;
    if (!isBrowserProcessRunning(child)) return;
    this.suppressManualLoginReopen = true;
    try {
      await this.#terminateManualLogin(child, this.manualLoginDebugPort);
    } finally {
      if (this.manualLoginProcess === child) this.manualLoginProcess = null;
      this.manualLoginDebugPort = null;
      this.suppressManualLoginReopen = false;
    }
  }

  async #closeTemporaryContext(context) {
    await context.close().catch(() => {});
    await waitForProfileUnlock(this.profileDirectory);
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

  async #refreshCommentPageIdentity() {
    const page = this.commentPage;
    try {
      if (!page || page.isClosed()) return false;

      // A live page keeps the signed-in account in a client-side store. Reload
      // it after a successful profile update so the visible account badge,
      // chat composer and the website's own send path all pick up the new name.
      // There is no page to refresh when the rename used a temporary context.
      const pageUrl = page.url();
      if (!pageUrl || pageUrl === "about:blank") return false;
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(250);
      return true;
    } catch {
      // The profile update has already succeeded. A transient navigation
      // failure must not turn it into a reported rename failure.
      return false;
    }
  }

  async updateDisplayName(displayName) {
    const cleanName = String(displayName ?? "").trim();
    if (!cleanName) throw new Error("Tên hiển thị không được để trống.");
    const maxLength = this.platform === "loco" ? 30 : 20;
    if (cleanName.length > maxLength) {
      throw new Error(`Tên hiển thị không được vượt quá ${maxLength} ký tự.`);
    }
    await this.#closeManualLoginForProfileUse();

    if (this.platform === "loco") {
      let createdContext = false;
      let context = this.context;

      if (!context) {
        const executablePath = await findChrome();
        if (!executablePath) throw new Error("Không tìm thấy Google Chrome hoặc Microsoft Edge trên máy tính của bạn.");
        await mkdir(this.profileDirectory, { recursive: true });
        await waitForProfileUnlock(this.profileDirectory);
        context = await chromium.launchPersistentContext(this.profileDirectory, {
          executablePath,
          headless: true,
          ignoreDefaultArgs: CHROME_PROFILE_IGNORE_DEFAULT_ARGS,
          args: ["--headless=new", "--mute-audio", "--no-sandbox"],
        });
        createdContext = true;
      }

      try {
        let cookies = [];
        try {
          // Scope cookie lookup to the active Loco origin. Profiles can retain
          // obsolete loco11.com tokens; an unscoped `.find()` may select those
          // before the valid .loco.com session.
          cookies = await context.cookies([this.definition.homeUrl]);
        } catch {
          const page = context.pages()[0] || (await context.newPage());
          const cdp = await context.newCDPSession(page);
          const cdpRes = await cdp.send("Network.getAllCookies");
          cookies = (cdpRes.cookies || []).filter((cookie) =>
            cookie.domain === "loco.com" || cookie.domain === ".loco.com");
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
          const refRes = await fetch(LOCO_API_ENDPOINTS.refreshToken, {
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
            const pRes = await fetch(LOCO_API_ENDPOINTS.profile, {
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

          const res = await fetch(LOCO_API_ENDPOINTS.updateProfile, {
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
          if (/not allowed to login|login not allowed|invalid.*token|token.*expired/i.test(String(data.message || ""))) {
            return { ok: false, status: 401, data: { ...data, message: "Phiên Loco đã hết hạn hoặc chưa đăng nhập đầy đủ." } };
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
          const error = new Error(updateResult.data?.message || `Lỗi cập nhật tên Loco (HTTP ${updateResult.status})`);
          if (updateResult.status === 401) error.code = "LOGIN_REQUIRED";
          throw error;
        }

        // Always refresh token after successful rename so new JWT contains updated username
        await callRefresh(accessToken, refreshToken);

        this.identity = { displayName: cleanName, source: "explicit_update", detectedAt: new Date().toISOString() };
        await this.#refreshCommentPageIdentity();
        return { displayName: cleanName, updatedAt: new Date().toISOString() };
      } finally {
        if (createdContext) {
          await this.#closeTemporaryContext(context);
        }
      }
    }

    let createdContext = false;
    let profilePage = this.profilePage;
    let context = this.context;

    if (!context) {
      const executablePath = await findChrome();
      if (!executablePath) throw new Error("Không tìm thấy Google Chrome hoặc Microsoft Edge trên máy tính của bạn.");
      await mkdir(this.profileDirectory, { recursive: true });
      await waitForProfileUnlock(this.profileDirectory);
      try {
        context = await chromium.launchPersistentContext(this.profileDirectory, {
          executablePath,
          headless: true,
          ignoreDefaultArgs: CHROME_PROFILE_IGNORE_DEFAULT_ARGS,
          args: ["--headless=new", "--mute-audio", "--no-sandbox"],
        });
        createdContext = true;
        profilePage = await context.newPage();
        await profilePage.goto(this.definition.profileUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      } catch (error) {
        if (createdContext) await this.#closeTemporaryContext(context);
        throw error;
      }
    } else {
      profilePage = await this.#getProfilePage();
    }

    const loginButton = profilePage.getByRole("button", {
      name: /^(Đăng nhập|Log in|Login|Sign in)$/i,
    });
    if (await loginButton.isVisible().catch(() => false)) {
      if (createdContext) await this.#closeTemporaryContext(context);
      else await profilePage.bringToFront().catch(() => {});
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
        this.identity = { displayName: cleanName, source: "explicit_update", detectedAt: new Date().toISOString() };
        await this.#refreshCommentPageIdentity();
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

      this.identity = { displayName: cleanName, source: "explicit_update", detectedAt: new Date().toISOString() };
      await this.#refreshCommentPageIdentity();
      return { displayName: cleanName, updatedAt: new Date().toISOString() };
    } finally {
      profilePage.off("dialog", acceptBrowserDialog);
      if (createdContext) {
        await this.#closeTemporaryContext(context);
      } else if (this.commentPage && !this.commentPage.isClosed()) {
        await this.commentPage.bringToFront().catch(() => {});
      }
    }
  }

  async sendComment({ channelUrl, content }) {
    const safeUrl = assertPlatformUrl(channelUrl, this.platform);
    const cleanContent = String(content ?? "").trim();
    if (!cleanContent) throw new Error("Không có nội dung để gửi.");

    // A visible/manual Chrome instance owns the same persistent profile. A
    // user-triggered send should hand that profile over to the controlled
    // headless context instead of failing with USER_ACTION_REQUIRED.
    await this.#closeManualLoginForProfileUse();
    await this.open(safeUrl);
    const status = await this.status();
    if (status.loginState === "signed_out") {
      const error = new Error("Bạn cần đăng nhập trong cửa sổ Chrome trước khi gửi.");
      error.code = "LOGIN_REQUIRED";
      throw error;
    }

    let directResult = null;
    if (this.platform === "loco") {
      const matureConfirmation = this.commentPage
        .getByRole("button", { name: /Yes, I am 18\+|I am 18\+|Tôi đã đủ 18 tuổi/i })
        .first();
      if (await matureConfirmation.isVisible().catch(() => false)) {
        const error = new Error("Phòng Loco yêu cầu xác nhận độ tuổi trong Chrome trước khi gửi chat.");
        error.code = "USER_ACTION_REQUIRED";
        throw error;
      }

      const transportDeadline = Date.now() + 8_000;
      do {
        directResult = await this.commentPage.evaluate(sendCommentViaLocoTransport, {
          content: cleanContent,
          streamId: getLocoStreamId(safeUrl),
          displayName: this.identity?.displayName || "",
          timeoutMs: 6_000,
        }).catch(() => ({
          status: "failed",
          attempted: false,
          reason: "page_evaluate_failed",
        }));
        if (directResult.status === "sent" || Date.now() >= transportDeadline) break;
        await this.commentPage.waitForTimeout(400);
      } while (true);

      if (directResult.status === "sent") {
        return {
          sentAt: new Date(directResult.sentAt || Date.now()).toISOString(),
          url: this.commentPage.url(),
          transport: "https",
          provider: directResult.provider,
          providerMessageId: directResult.providerMessageId,
        };
      }
    }

    const textBox = this.commentPage
      .locator(this.platform === "loco"
        ? 'input[data-test-id="loco-chat-input-container"], .loco-chat-input, input[placeholder*="Slow mode" i], input[placeholder*="message" i], input[placeholder*="chat" i], input[placeholder*="Say something" i]'
        : 'input[placeholder*="Nói gì đó" i], input[placeholder*="Say something" i], input[placeholder*="Write a message" i], textarea, [contenteditable="true"]')
      .first();
    await textBox.waitFor({ state: "visible", timeout: 12_000 }).catch(() => {
      if (directResult?.attempted && directResult?.reason) {
        throw new Error(`Gửi qua HTTPS thất bại: ${directResult.reason}`);
      }
      throw new Error("Không tìm thấy ô chat. Hãy kiểm tra URL phòng live và trạng thái phòng.");
    });

    await textBox.fill(cleanContent);

    if (this.platform === "gosh") {
      directResult = await this.commentPage.evaluate(sendCommentViaWebsiteTransport, {
        content: cleanContent,
        displayName: this.identity?.displayName || "",
        timeoutMs: 10_000,
      }).catch(() => ({
        status: "failed",
        attempted: false,
        reason: "page_evaluate_failed",
      }));

      if (directResult.status === "sent") {
        await textBox.fill("").catch(() => {});
        return {
          sentAt: new Date(directResult.sentAt || Date.now()).toISOString(),
          url: this.commentPage.url(),
          transport: "websocket",
          provider: directResult.provider,
          providerMessageId: directResult.providerMessageId,
        };
      }
    }

    await textBox.press("Enter");

    const sendButton = this.commentPage.locator(
      'button:has-text("Gửi"), button:has-text("Send"), button[data-test-id*="send" i], button[aria-label="Send" i]'
    ).first();

    if (await sendButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      if (await sendButton.isEnabled().catch(() => false)) {
        await sendButton.click().catch(() => {});
      }
    }

    await this.commentPage.waitForTimeout(500);
    return {
      sentAt: new Date().toISOString(),
      url: this.commentPage.url(),
      transport: "browser-ui",
      provider: this.platform,
    };
  }

  async close() {
    this.suppressManualLoginReopen = true;
    const manualLoginProcess = this.manualLoginProcess;
    if (isBrowserProcessRunning(manualLoginProcess)) {
      await this.#terminateManualLogin(manualLoginProcess, this.manualLoginDebugPort).catch(() => {});
    }
    this.manualLoginProcess = null;
    this.manualLoginDebugPort = null;
    try {
      await this.context?.close();
    } catch {}
    this.context = null;
    this.commentPage = null;
    this.profilePage = null;
  }
}
