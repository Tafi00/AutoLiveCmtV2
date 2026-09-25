import { access, lstat, mkdir, readlink, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { assertPlatformUrl, normalizePlatform, PLATFORMS } from "./platforms.js";
import { parseProxy } from "./store.js";
chromium.use(StealthPlugin());

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
export const discoveredApiEndpoints = new Map();
export const MAX_OBSERVED_ENDPOINTS = 200;

export function recordObservedEndpoint(url, method = "GET", status = 200) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!host.includes("loco") && !host.includes("gosh") && !host.includes("getloconow") && !host.includes("vizzlive") && !host.includes("gaquaytv")) return;

    const path = parsed.pathname;
    let category = "other";
    let name = path;
    if (path.includes("/chat/") || url.includes("send=true") || path.includes("/send_msg")) {
      category = "chat";
      name = "Gửi Chat";
    } else if (path.includes("/profile/update") || path.includes("/user_center") || path.includes("/update-profile")) {
      category = "profile_update";
      name = "Đổi tên";
    } else if (path.includes("/refresh_token") || path.includes("/refresh-token")) {
      category = "auth_refresh";
      name = "Làm mới Token";
    } else if (path.includes("/profile/me") || path.includes("/user_info") || path.includes("/auth/me")) {
      category = "profile_info";
      name = "Hồ sơ tài khoản";
    } else if (path.includes("/auth/login") || path.includes("/auth/register") || path.includes("/auth/logout")) {
      category = "auth";
      name = "Đăng nhập";
    } else if (path.includes("/live/") || path.includes("/streams/")) {
      category = "live_stream";
      name = "Phòng Live";
    } else if (path.includes("/schedule")) {
      category = "schedule";
      name = "Lịch Live";
    } else if (path.includes("/config")) {
      category = "config";
      name = "Cấu hình Website";
    } else {
      return;
    }

    const key = `${method}:${host}:${path}`;
    discoveredApiEndpoints.delete(key);
    discoveredApiEndpoints.set(key, {
      name,
      category,
      method,
      host,
      path,
      fullUrl: url,
      status,
      lastSeen: new Date().toISOString(),
    });
    while (discoveredApiEndpoints.size > MAX_OBSERVED_ENDPOINTS) {
      discoveredApiEndpoints.delete(discoveredApiEndpoints.keys().next().value);
    }
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

export function gaquaytvLoginProbeExpression() {
  return `(async () => {
    const cookieMap = Object.fromEntries((document.cookie || '').split(';').map((part) => {
      const index = part.indexOf('=');
      return index < 0 ? [part.trim(), ''] : [part.slice(0, index).trim(), part.slice(index + 1)];
    }).filter(([key]) => key));
    const accessToken = cookieMap.access_token || '';
    if (!accessToken) return { loggedIn: false };

    // The site's own client calls the v2 API with the cookie-held JWT. Reuse
    // that call so the detected name matches what the chat composer will send.
    // api.gaquaytv.com requires the cookie JWT as an explicit Authorization
    // header: cookie-only calls get 401 ("Invalid authorization code"),
    // while cookie token + Bearer succeeds. Same-origin fetch sets the
    // required site Origin automatically.
    try {
      const res = await fetch('https://api.gaquaytv.com/api/v2/auth/me', {
        headers: { Authorization: 'Bearer ' + accessToken },
      });
      if (res.ok) {
        const json = await res.json();
        const data = json?.data || json;
        if (data && (data.display_name || data.displayName || data.username || data.email)) {
          return { loggedIn: true, data };
        }
      }
    } catch (e) {}

    // Fall back to the JWT payload itself when the API is unreachable.
    try {
      const payload = accessToken.split('.')[1];
      if (payload) {
        const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = JSON.parse(decodeURIComponent(Array.from(atob(normalized), (char) =>
          '%' + char.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
        const name = decoded.display_name || decoded.username || decoded.name || decoded.uid;
        if (name) return { loggedIn: true, data: { display_name: String(name) } };
      }
    } catch (e) {}

    return { loggedIn: true, data: { token: true } };
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

export function shouldBlockBrowserResource({ platform = "gosh", resourceType, url }) {
  if (resourceType === "media" || resourceType === "font") return true;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();

  if (hostname === "static.cloudflareinsights.com") return true;
  if (
    platform === "loco"
    && (
      hostname === "www.googletagmanager.com"
      || hostname === "www.google-analytics.com"
      || hostname === "firebaselogging.googleapis.com"
    )
  ) return true;

  if (platform === "gaquaytv") {
    if (resourceType === "image") return true;
    if (
      hostname === "clikk.cc" || hostname.endsWith(".clikk.cc")
      || hostname === "logriancesenius.com" || hostname.endsWith(".logriancesenius.com")
      || hostname === "connect.facebook.net"
      || hostname === "stats.g.doubleclick.net"
      || hostname === "www.googletagmanager.com"
      || hostname === "www.google-analytics.com"
      || hostname === "analytics.google.com"
      || hostname === "www.google.com.vn"
      || hostname === "cdn.mxpnl.com" || hostname.endsWith(".mxpnl.com")
      || hostname === "c.clarity.ms" || hostname.endsWith(".clarity.ms")
      || hostname === "f003.backblazeb2.com" || hostname.endsWith(".backblazeb2.com")
    ) return true;
  }

  if (
    /\.(?:m3u8|m4s|ts|mp4|flv|mpd|aac)$/.test(pathname)
  ) return true;

  if (
    hostname === "api.vizzlive.com"
    && /\/gosh_admin\/admin\/(?:web_log|log)\//.test(pathname)
  ) return true;

  if (
    hostname === "pull.gosh6.app"
    && (pathname.startsWith("/live/") || /\.(?:m3u8|m4s|ts|flv)$/.test(pathname))
  ) return true;

  if (
    resourceType === "image"
    && /(^|\.)goshcdn\.com$/.test(hostname)
    && (/\/avatar\//.test(pathname) || /\/live\/screenshot\//.test(pathname))
  ) return true;

  return false;
}

// Reading tokens out of a profile needs a short headless Chrome launch. Cap how
// many run at once so loading tokens for hundreds of accounts stays smooth.
const MAX_PROFILE_READS = 3;
let activeProfileReads = 0;
const profileReadQueue = [];

async function withProfileReadSlot(task) {
  if (activeProfileReads >= MAX_PROFILE_READS) {
    // The finishing task hands its slot straight to the next waiter.
    await new Promise((resolve) => profileReadQueue.push(resolve));
  } else {
    activeProfileReads += 1;
  }
  try {
    return await task();
  } finally {
    const next = profileReadQueue.shift();
    if (next) next();
    else activeProfileReads -= 1;
  }
}

export class BrowserSession {
  constructor({ profileDirectory, platform = "gosh", proxy = "", onManualLoginExit = null }) {
    this.profileDirectory = profileDirectory;
    this.platform = normalizePlatform(platform);
    this.definition = PLATFORMS[this.platform];
    this.proxy = proxy || "";
    this.onManualLoginExit = onManualLoginExit;
    this.context = null;
    this.commentPage = null;
    this.launching = null;
    this.identity = null;
    this.manualLoginProcess = null;
    this.manualLoginDebugPort = null;
    this.manualLoginError = null;
    this.suppressManualLoginReopen = false;
  }

  isManualLoginRunning() {
    return isBrowserProcessRunning(this.manualLoginProcess);
  }

  isRunning() {
    return this.isManualLoginRunning() || Boolean(this.context);
  }

  status() {
    return {
      running: this.isRunning(),
      loginState: this.isManualLoginRunning() ? "manual_login" : "unknown",
      readyToComment: false,
      url: this.commentPage && !this.commentPage.isClosed() ? this.commentPage.url() : "",
      identity: this.identity,
      ...(this.manualLoginError ? { error: this.manualLoginError } : {}),
    };
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
    const proxyConfig = parseProxy(this.proxy);
    this.context = await chromium.launchPersistentContext(this.profileDirectory, {
      executablePath,
      headless: true,
      viewport: this.platform === "loco" ? { width: 1440, height: 900 } : null,
      locale: "vi-VN",
      proxy: proxyConfig || undefined,
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

    // NOTE: no request interception for api.gaquaytv.com. The API validates
    // the browser Origin header, so relaying page requests through Node's
    // fetch (which sends no/re-written Origin) breaks auth/me, login- gated
    // chat, and identity detection. Page requests go direct instead.

    this.context.on("response", (res) => {
      recordObservedEndpoint(res.url(), res.request().method(), res.status());
    });

    this.context.on("close", () => {
      this.context = null;
      this.commentPage = null;
    });
    this.commentPage = this.context.pages()[0] || (await this.context.newPage());
  }


  // Runs `task` with a browser context for this profile: the open one when it
  // exists, otherwise a short-lived headless one that is closed afterwards.
  async #withProfileContext(task) {
    if (this.isManualLoginRunning()) {
      const error = new Error("Hãy hoàn tất đăng nhập rồi đóng cửa sổ Chrome của tài khoản trước.");
      error.code = "USER_ACTION_REQUIRED";
      throw error;
    }
    if (this.launching) await this.launching.catch(() => {});
    if (this.context) return task(this.context);
    return withProfileReadSlot(async () => {
      const executablePath = await findChrome();
      if (!executablePath) {
        throw new Error("Không tìm thấy Google Chrome hoặc Microsoft Edge trên máy tính của bạn.");
      }
      await mkdir(this.profileDirectory, { recursive: true });
      await waitForProfileUnlock(this.profileDirectory);
      const context = await chromium.launchPersistentContext(this.profileDirectory, {
        executablePath,
        headless: true,
        // Same keychain handling as the login window so encrypted cookies
        // stay readable.
        ignoreDefaultArgs: CHROME_PROFILE_IGNORE_DEFAULT_ARGS,
        args: ["--headless=new", "--mute-audio"],
      });
      try {
        return await task(context);
      } finally {
        await this.#closeTemporaryContext(context);
      }
    });
  }

  async readCookies() {
    return this.#withProfileContext((context) => context.cookies());
  }

  async writeCookies(cookies) {
    if (!cookies?.length) return;
    await this.#withProfileContext((context) => context.addCookies(cookies));
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
    await mkdir(this.profileDirectory, { recursive: true });
    await waitForProfileUnlock(this.profileDirectory);

    this.suppressManualLoginReopen = false;
    this.manualLoginError = null;
    const debugPort = await availableLocalPort();
    const proxyConfig = parseProxy(this.proxy);
    const chromeArgs = [
      `--user-data-dir=${this.profileDirectory}`,
      `--remote-debugging-port=${debugPort}`,
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
    ];
    if (proxyConfig?.server) {
      chromeArgs.push(`--proxy-server=${proxyConfig.server}`);
    }
    chromeArgs.push(safeUrl);
    const child = spawn(executablePath, chromeArgs, {
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
      this.onManualLoginExit?.();
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
            : this.platform === "gaquaytv"
              ? gaquaytvLoginProbeExpression()
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

  async #closeTemporaryContext(context) {
    await context.close().catch(() => {});
    await waitForProfileUnlock(this.profileDirectory);
  }


  async openProfile() {
    return this.openForManualLogin(this.definition.profileUrl);
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
  }
}
