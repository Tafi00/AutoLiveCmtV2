// Pure-token transports: every request here goes straight from Node to the
// sites' own APIs with the account's saved tokens. No browser is involved, so
// the cost of a send does not grow with the number of configured accounts.
import { createHash, createHmac, randomUUID } from "node:crypto";
import dns from "node:dns";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import { getGaquaytvRoomId, getLocoStreamId } from "./platforms.js";
import { parseProxy } from "./store.js";

const moduleRequire = createRequire(import.meta.url);
let undiciModule = null;
try {
  undiciModule = moduleRequire("undici");
} catch {}
const undiciFetch = undiciModule?.fetch || globalThis.fetch;
const ProxyAgent = undiciModule?.ProxyAgent || null;
const UndiciWebSocket = undiciModule?.WebSocket || globalThis.WebSocket;
dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamily?.(false);
export const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function loginRequiredError(message) {
  const error = new Error(message);
  error.code = "LOGIN_REQUIRED";
  return error;
}

// The server rejected the token before acting on the request, so the caller
// may refresh it and retry without risking a duplicate comment.
export function authExpiredError(message) {
  const error = new Error(message);
  error.code = "AUTH_EXPIRED";
  return error;
}

const proxyDispatchers = new Map();

export function proxyDispatcher(proxy) {
  const raw = String(proxy || "").trim();
  if (!raw) return undefined;
  if (proxyDispatchers.has(raw)) return proxyDispatchers.get(raw);
  const parsed = parseProxy(raw);
  if (!parsed) return undefined;
  if (!/^https?:$/.test(new URL(parsed.server).protocol)) {
    throw new Error("Chế độ gửi bằng token chỉ hỗ trợ proxy HTTP/HTTPS (http://user:pass@host:port hoặc host:port:user:pass).");
  }
  const options = { uri: parsed.server };
  if (parsed.username) {
    options.token = `Basic ${Buffer.from(`${parsed.username}:${parsed.password ?? ""}`).toString("base64")}`;
  }
  const dispatcher = ProxyAgent ? new ProxyAgent(options) : options;
  proxyDispatchers.set(raw, dispatcher);
  return dispatcher;
}

export function decodeJwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(String(token).split(".")[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

export function jwtExpiresWithin(token, milliseconds) {
  const exp = Number(decodeJwtPayload(token)?.exp);
  return Number.isFinite(exp) && exp * 1000 - Date.now() < milliseconds;
}

async function request(url, {
  method = "GET",
  headers = {},
  body,
  dispatcher,
  fetchImpl = undiciFetch,
  timeoutMs = 15_000,
} = {}) {
  const response = await fetchImpl(url, {
    method,
    headers,
    body: body === undefined || typeof body === "string" ? body : JSON.stringify(body),
    dispatcher,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // HTML pages and empty bodies are returned as text only.
  }
  return { status: response.status, ok: response.ok, data, text };
}

const resolvedRooms = new Map();
const MAX_RESOLVED_ROOMS = 200;

async function cachedRoom(key, ttlMs, load) {
  const hit = resolvedRooms.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await load();
  resolvedRooms.delete(key);
  resolvedRooms.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (resolvedRooms.size > MAX_RESOLVED_ROOMS) {
    resolvedRooms.delete(resolvedRooms.keys().next().value);
  }
  return value;
}

export function forgetResolvedRoom(key) {
  resolvedRooms.delete(key);
}

function pickCookie(cookies, domainPattern, name) {
  return (Array.isArray(cookies) ? cookies : [])
    .filter((cookie) => cookie?.name === name && domainPattern.test(String(cookie.domain || "").replace(/^\./, "")))
    .sort((a, b) => (Number(b.expires) || 0) - (Number(a.expires) || 0))[0]?.value || "";
}

// Chrome profiles keep the session tokens as cookies. Only the values needed
// to talk to each site's API are kept.
export function credentialsFromCookies(platform, cookies) {
  if (platform === "gaquaytv") {
    const domain = /^gaquaytv\.com$/i;
    const accessToken = pickCookie(cookies, domain, "access_token");
    if (!accessToken) return null;
    return { accessToken, refreshToken: pickCookie(cookies, domain, "refresh_token") };
  }
  if (platform === "loco") {
    // Profiles can still hold tokens for the retired loco11.com domain.
    const domain = /^loco\.com$/i;
    const accessToken = pickCookie(cookies, domain, "access_token");
    if (!accessToken) return null;
    const deviceId = String(decodeJwtPayload(accessToken)?.device_id || "");
    return { accessToken, refreshToken: pickCookie(cookies, domain, "refresh_token"), deviceId };
  }
  if (platform === "gosh") {
    for (const domain of [/^gosh\.com$/i, /^gosh6\.app$/i]) {
      const token = pickCookie(cookies, domain, "token");
      const uid = pickCookie(cookies, domain, "uid");
      // Visitor sessions carry a token but no IM signature and cannot chat.
      const timUserSig = pickCookie(cookies, domain, "tim_user_sig");
      if (!token || !uid || uid === "0" || !timUserSig) continue;
      return {
        token,
        uid,
        did: pickCookie(cookies, domain, "did"),
        ctry: pickCookie(cookies, domain, "ctry"),
        timUserSig,
      };
    }
    return null;
  }
  return null;
}

// Cookies to write back into the Chrome profile so the visible browser keeps
// working after the app refreshed a token.
export function cookiesFromCredentials(platform, credentials) {
  const expires = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const cookie = (domain, name, value) => ({ name, value, domain, path: "/", expires, secure: true, sameSite: "Lax" });
  if (platform === "gaquaytv" && credentials?.accessToken) {
    return [
      cookie("gaquaytv.com", "access_token", credentials.accessToken),
      ...(credentials.refreshToken ? [cookie("gaquaytv.com", "refresh_token", credentials.refreshToken)] : []),
    ];
  }
  if (platform === "loco" && credentials?.accessToken) {
    return [
      cookie(".loco.com", "access_token", credentials.accessToken),
      ...(credentials.refreshToken ? [cookie(".loco.com", "refresh_token", credentials.refreshToken)] : []),
      cookie(".loco.com", "mode", "logged-in"),
    ];
  }
  return [];
}

/* ------------------------------------------------------------------ GaQuayTV */

export const GAQUAYTV_API = "https://api.gaquaytv.com/api/v2";
export const GAQUAYTV_CHAT_URL = "wss://chat.gaquaytv.com/socket.io/?EIO=4&transport=websocket";
const GAQUAYTV_SITE_HEADERS = {
  origin: "https://gaquaytv.com",
  referer: "https://gaquaytv.com/",
  "user-agent": BROWSER_USER_AGENT,
};

export async function gaquaytvLogin({ usernameOrEmail, password, dispatcher, fetchImpl }) {
  // api.gaquaytv.com only accepts the site Origin on auth requests.
  const response = await request(`${GAQUAYTV_API}/auth/login`, {
    method: "POST",
    headers: { ...GAQUAYTV_SITE_HEADERS, "content-type": "application/json" },
    body: { username_or_email: usernameOrEmail, password },
    dispatcher,
    fetchImpl,
  });
  if (!response.ok) {
    throw new Error(response.data?.message || `Đăng nhập thất bại (HTTP ${response.status})`);
  }
  const data = response.data?.data;
  if (!data?.access_token) throw new Error("Không nhận được token đăng nhập từ GaQuayTV.");
  return { accessToken: data.access_token, refreshToken: data.refresh_token || "" };
}

export async function gaquaytvRefresh({ credentials, dispatcher, fetchImpl }) {
  if (!credentials?.refreshToken) return null;
  const response = await request(`${GAQUAYTV_API}/auth/refresh-token`, {
    method: "POST",
    headers: { ...GAQUAYTV_SITE_HEADERS, "content-type": "application/json" },
    body: { refresh_token: credentials.refreshToken },
    dispatcher,
    fetchImpl,
  });
  const data = response.data?.data;
  if (!response.ok || !data?.access_token) return null;
  return { accessToken: data.access_token, refreshToken: data.refresh_token || credentials.refreshToken };
}

async function gaquaytvApi(path, { method = "GET", body, credentials, dispatcher, fetchImpl }) {
  // The API needs the JWT as a Bearer header; cookie-only calls get 401.
  const response = await request(`${GAQUAYTV_API}${path}`, {
    method,
    headers: {
      ...GAQUAYTV_SITE_HEADERS,
      authorization: `Bearer ${credentials.accessToken}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body,
    dispatcher,
    fetchImpl,
  });
  if (response.status === 401) throw authExpiredError("Phiên GaQuayTV đã hết hạn.");
  return response;
}

export async function gaquaytvProfile({ credentials, dispatcher, fetchImpl }) {
  const response = await gaquaytvApi("/auth/me", { credentials, dispatcher, fetchImpl });
  if (!response.ok) throw new Error(`Không đọc được hồ sơ GaQuayTV (HTTP ${response.status}).`);
  const data = response.data?.data || response.data || {};
  return {
    raw: data,
    displayName: String(data.display_name || data.username || "").trim(),
    username: String(data.username || "").trim(),
    avatar: data.avatar || "",
  };
}

export async function gaquaytvUpdateDisplayName({ displayName, credentials, dispatcher, fetchImpl }) {
  const profile = await gaquaytvProfile({ credentials, dispatcher, fetchImpl });
  const me = profile.raw;
  const response = await gaquaytvApi("/auth/update-profile", {
    method: "PATCH",
    body: {
      avatar: me.avatar ?? null,
      cover: me.cover ?? null,
      display_name: displayName,
      bio: me.bio ?? null,
      social_links: Array.isArray(me.social_links) ? me.social_links : [],
    },
    credentials,
    dispatcher,
    fetchImpl,
  });
  if (!response.ok) {
    throw new Error(`Lỗi cập nhật tên GaQuayTV (${response.data?.message || `HTTP ${response.status}`})`);
  }
}

// Live links are /live/{uuid} or /live/{slug}; the chat room is the stream uuid.
export async function resolveGaquaytvRoom(channelUrl, { dispatcher, fetchImpl } = {}) {
  const cleanUrl = String(channelUrl ?? "").replace(/\s+/g, "").trim();
  const pathId = getGaquaytvRoomId(cleanUrl) || "";
  if (UUID_PATTERN.test(pathId)) return pathId;
  return cachedRoom(`gaquaytv:${cleanUrl}`, 10 * 60_000, async () => {
    const page = await request(cleanUrl, {
      headers: { "user-agent": BROWSER_USER_AGENT, accept: "text/html" },
      dispatcher,
      fetchImpl,
    });
    if (!page.ok) throw new Error(`Không mở được phòng GaQuayTV (HTTP ${page.status}).`);
    const escapedSlug = decodeURIComponent(pathId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = (
      (pathId && (
        page.text.match(new RegExp(`\\\\?"(?:streamId|id)\\\\?":\\\\?"([0-9a-f-]{36})\\\\?"[^{}]*?\\\\?"(?:streamSlug|slug)\\\\?":\\\\?"${escapedSlug}\\\\?"`, "i"))
        || page.text.match(new RegExp(`\\\\?"(?:streamSlug|slug)\\\\?":\\\\?"${escapedSlug}\\\\?"[^{}]*?\\\\?"(?:streamId|id)\\\\?":\\\\?"([0-9a-f-]{36})\\\\?"`, "i"))
      ))
      || page.text.match(/\\?"roomId\\?":\\?"([0-9a-f-]{36})\\?"/i)
      || (() => {
        const suffix = pathId.match(/-([0-9a-f]{6,12})$/i)?.[1];
        if (!suffix) return null;
        return page.text.match(new RegExp(`\\\\?"(?:streamId|id|roomId|streamUid)\\\\?":\\\\?"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]*${suffix})\\\\?"`, "i"));
      })()
    );
    if (!match) throw new Error("Không tìm thấy mã phòng chat trong trang live GaQuayTV.");
    return match[1];
  });
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlToText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

// Minimal Socket.IO v4 client (Engine.IO 4, websocket transport only). It is
// all the chat server needs and it lets each account use its own proxy.
export class GaquaytvChatSocket {
  constructor({ token = "", room = "", dispatcher, WebSocketImpl = UndiciWebSocket, url = GAQUAYTV_CHAT_URL } = {}) {
    this.token = token;
    this.room = room;
    this.dispatcher = dispatcher;
    this.WebSocketImpl = WebSocketImpl;
    this.url = url;
    this.ws = null;
    this.ready = null;
    this.closed = false;
    this.listeners = new Map();
    this.joinedRooms = new Set();
  }

  get connected() {
    return Boolean(this.ws && !this.closed && this.ready);
  }

  connect(timeoutMs = 10_000) {
    if (this.ready) return this.ready;
    this.closed = false;
    this.ready = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          this.#teardown();
          reject(error);
        } else {
          resolve(this);
        }
      };
      const timer = setTimeout(() => finish(new Error("Máy chủ chat GaQuayTV không phản hồi.")), timeoutMs);
      const options = { headers: GAQUAYTV_SITE_HEADERS };
      if (this.dispatcher) options.dispatcher = this.dispatcher;
      let ws;
      try {
        ws = new this.WebSocketImpl(this.url, options);
      } catch (error) {
        finish(error);
        return;
      }
      this.ws = ws;
      ws.onmessage = (event) => this.#onPacket(String(event.data), finish);
      ws.onerror = () => finish(new Error("Không kết nối được máy chủ chat GaQuayTV."));
      ws.onclose = () => {
        finish(new Error("Máy chủ chat GaQuayTV đã đóng kết nối."));
        this.#teardown();
      };
    });
    this.ready.catch(() => {});
    return this.ready;
  }

  #onPacket(packet, finish) {
    if (packet.startsWith("0")) {
      this.ws.send(`40${JSON.stringify(this.token ? { token: this.token } : {})}`);
    } else if (packet === "2") {
      this.ws.send("3");
    } else if (packet.startsWith("40")) {
      if (this.room) {
        this.joinRoom(this.room);
      }
      finish();
    } else if (packet.startsWith("44")) {
      let message = "";
      try {
        message = JSON.parse(packet.slice(2))?.message || "";
      } catch {}
      finish(/auth|token|unauthor/i.test(message)
        ? authExpiredError("Máy chủ chat GaQuayTV từ chối token.")
        : new Error(`Máy chủ chat GaQuayTV từ chối kết nối${message ? `: ${message}` : ""}.`));
    } else if (packet.startsWith("41")) {
      this.#teardown();
    } else if (packet.startsWith("42")) {
      let event;
      try {
        event = JSON.parse(packet.slice(packet.indexOf("[")));
      } catch {
        return;
      }
      if (!Array.isArray(event)) return;
      for (const listener of this.listeners.get(event[0]) || []) listener(event[1]);
    }
  }

  #teardown() {
    this.closed = true;
    this.ready = null;
    this.joinedRooms.clear();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch {}
    }
  }

  on(event, listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  emit(event, payload) {
    if (!this.connected) throw new Error("Kết nối chat GaQuayTV đã bị ngắt.");
    this.ws.send(`42${JSON.stringify([event, payload])}`);
  }

  joinRoom(room = this.room) {
    if (!room || this.joinedRooms.has(room)) return;
    this.emit("join_room", { room });
    this.joinedRooms.add(room);
  }

  // The server does not acknowledge send_message. Success is the room echoing
  // the message back; an explicit error event means it was rejected.
  async sendChat({ room = this.room, content, sender, confirmTimeoutMs = 2_500 }) {
    this.joinRoom(room);
    let cleanup = () => {};
    const outcome = new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ confirmed: false }), confirmTimeoutMs);
      const offMessage = this.on("onReceiveMessage", (payload) => {
        const messages = Array.isArray(payload?.msgs) ? payload.msgs : [];
        const echoed = messages.some((message) => (
          htmlToText(message?.content) === content
          && (!sender.username || message?.username === sender.username)
        ));
        if (echoed) resolve({ confirmed: true });
      });
      const offError = this.on("onErrorMessage", (payload) => {
        if (room) this.joinedRooms.delete(room);
        resolve({ error: String(payload?.message || payload?.error || payload || "bị từ chối").slice(0, 240) });
      });
      cleanup = () => {
        clearTimeout(timer);
        offMessage();
        offError();
      };
    });
    try {
      this.emit("send_message", {
        room,
        data: {
          type: "chat",
          msgs: [{
            sender_name: sender.displayName,
            avatar: sender.avatar || "",
            username: sender.username || "",
            is_admin: false,
            content: `<div class="!inline">${escapeHtml(content)}</div>`,
          }],
        },
      });
      const result = await outcome;
      if (result.error) {
        if (room) this.joinedRooms.delete(room);
        throw new Error(`GaQuayTV từ chối bình luận: ${result.error}`);
      }
      return result;
    } finally {
      cleanup();
    }
  }

  close() {
    if (this.ws && !this.closed) {
      try {
        this.ws.send("41");
      } catch {}
    }
    this.#teardown();
  }
}

/* ---------------------------------------------------------------------- Loco */

const LOCO_CLIENT_ID = "TlwKp1zmF6eKFpcisn3FyR18WkhcPkZtzwPVEEC3";
const LOCO_CLIENT_SECRET = "Kp7tYlUN7LXvtcSpwYvIitgYcLparbtsQSe5AdyyCdiEJBP53Vt9J8eB4AsLdChIpcO2BM19RA3HsGtqDJFjWmwoonvMSG3ZQmnS8x1YIM8yl82xMXZGbE3NKiqmgBVU";
export const LOCO_API_ENDPOINTS = {
  // Loco's web client refreshes sessions through auth v3; the old v1 path
  // returns INVALID_ROUTE.
  refreshToken: "https://api.loco.com/auth/v3/user/refresh_token/",
  chat: (streamId) => `https://api.loco.com/chat/v2/streams/${encodeURIComponent(streamId)}/chat/?send=true`,
};
const LOCO_SITE_HEADERS = {
  origin: "https://loco.com",
  referer: "https://loco.com/",
  "user-agent": BROWSER_USER_AGENT,
  "x-platform": "7",
  "x-client-id": LOCO_CLIENT_ID,
  "x-client-secret": LOCO_CLIENT_SECRET,
};

export function locoIdentity(credentials) {
  const jwt = decodeJwtPayload(credentials?.accessToken) || {};
  return {
    uid: String(jwt.user_uid || ""),
    username: String(jwt.username || "").trim(),
    avatar: String(jwt.avatar || ""),
    deviceId: String(credentials?.deviceId || jwt.device_id || ""),
  };
}

export async function locoRefresh({ credentials, dispatcher, fetchImpl }) {
  if (!credentials?.refreshToken) return null;
  const { deviceId } = locoIdentity(credentials);
  const response = await request(LOCO_API_ENDPOINTS.refreshToken, {
    method: "POST",
    headers: {
      ...LOCO_SITE_HEADERS,
      authorization: credentials.accessToken,
      "device-id": deviceId,
      "content-type": "application/json",
    },
    body: { refresh_token: credentials.refreshToken },
    dispatcher,
    fetchImpl,
  });
  const data = response.data;
  if (typeof data?.access_token !== "string" || !data.access_token) return null;
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" && data.refresh_token ? data.refresh_token : credentials.refreshToken,
    deviceId: String(decodeJwtPayload(data.access_token)?.device_id || deviceId),
  };
}

export async function resolveLocoStream(channelUrl, { dispatcher, fetchImpl } = {}) {
  const streamId = getLocoStreamId(channelUrl);
  if (streamId) return streamId;
  // /streamers/{name} links point at whatever the streamer is broadcasting now.
  return cachedRoom(`loco:${channelUrl}`, 60_000, async () => {
    const page = await request(channelUrl, {
      headers: { "user-agent": BROWSER_USER_AGENT, accept: "text/html" },
      dispatcher,
      fetchImpl,
    });
    if (!page.ok) throw new Error(`Không mở được trang kênh Loco (HTTP ${page.status}).`);
    const match = page.text.match(/liveStreamData\\?":\{\\?"uid\\?":\\?"([0-9a-f-]{36})/i)
      || page.text.match(/loco\.com\/embed\/([0-9a-f-]{36})/i);
    if (!match) throw new Error("Kênh Loco hiện không phát live.");
    return match[1];
  });
}

export async function locoSendComment({ streamId, content, credentials, sessionUid, displayName, dispatcher, fetchImpl }) {
  const identity = locoIdentity(credentials);
  if (!identity.uid) throw loginRequiredError("Token Loco không chứa thông tin tài khoản. Hãy đăng nhập lại.");
  const msgId = randomUUID();
  const params = {
    message: content,
    msgId,
    deviceId: `${identity.deviceId}-${sessionUid}`,
    msg_time: Date.now(),
    moderator_type: 0,
    profile: {
      avatar: identity.avatar,
      color: "#777777",
      uid: identity.uid,
      username: displayName || identity.username,
      is_loco_verified: false,
      is_streamer: false,
    },
    type: 1,
  };
  const response = await request(LOCO_API_ENDPOINTS.chat(streamId), {
    method: "POST",
    headers: {
      ...LOCO_SITE_HEADERS,
      authorization: credentials.accessToken,
      "x-app-lang": "en",
      "x-app-locale": "en-US",
      "content-type": "application/json;charset=utf-8",
    },
    body: params,
    dispatcher,
    fetchImpl,
  });
  const data = response.data || {};
  const message = String(data.message || data.error || data.error_code || "");
  if (response.status === 401 || data.status_code === 401 || data.error_code === "E005"
    || /invalid.*token|token.*expired|not allowed to login/i.test(message)) {
    throw authExpiredError("Phiên Loco đã hết hạn.");
  }
  const accepted = response.ok && (data.code === "C10" || !(data.error || data.error_code || data.success === false));
  if (!accepted) throw new Error(`Loco từ chối bình luận: ${message || `HTTP ${response.status}`}`);
  return { providerMessageId: String(data.data?.id || data.data?.msgId || msgId) };
}

/* ---------------------------------------------------------------------- Gosh */

export const GOSH_API = "https://api.gosh.com";
export const GOSH_TYPEX_API = "https://api-coco.typex.im";
export const GOSH_DEFAULT_NAME_COLOR = "#FFE1A6";
export const GOSH_IM_SDK_APP_ID = 20011275;
export const GOSH_DEFAULT_SM_BOX_ID = "BMx5KRxL+3UH7r+zDSSJTmakGUFAtOZ2MxH0xnw83spUYeMr7xg5cUynRml8EvnuhujLts/2UDbCUtVrFmLq76Q==";
const GOSH_WEB_VERSION = "3.9.2";
// client uses a different one).
const GOSH_PC_SIGN_KEY = "A7fQ9K2mX8Zp4R3L";
// Fields the website strips before echoing the account inside chat payloads.
const GOSH_PRIVATE_ACCOUNT_FIELDS = [
  "tim_user_sig", "account_type", "account_id", "ip", "last_login_at", "is_coin_agency",
  "can_chat", "is_show_customer_service", "is_show_transfer",
];

export function goshSignature({ did, uid, ts, method, path, body }) {
  const params = { did, uid, ts, method, path };
  if (body !== undefined) params.body = createHash("sha256").update(body).digest("hex");
  const canonical = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join("&");
  return createHmac("sha256", GOSH_PC_SIGN_KEY).update(canonical).digest("hex");
}

export async function goshRequest(path, { method = "GET", query = {}, body, credentials, dispatcher, fetchImpl } = {}) {
  const ts = String(Math.floor(Date.now() / 1000));
  const did = credentials?.did || randomUUID().replace(/-/g, "");
  const uid = credentials?.uid || "0";
  const base = {
    app: "kick", bid: "26", ch: "website", ctry: credentials?.ctry || "VN", did, lang: "en", os: "Windows",
    pf: "pc", uid, vsn: GOSH_WEB_VERSION, _fbp: "", _fbc: "", smid: "", sid: "", ts,
  };
  const bodyText = method === "POST" ? JSON.stringify(body || {}) : undefined;
  const signature = goshSignature({ did, uid, ts, method, path: path.split("?")[0], body: bodyText });
  const search = new URLSearchParams(method === "GET" ? { ...base, ...query } : base);
  const response = await request(`${GOSH_API}${path}${path.includes("?") ? "&" : "?"}${search}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-signature": signature,
      origin: "https://gosh.com",
      referer: "https://gosh.com/",
      "user-agent": BROWSER_USER_AGENT,
      ...(credentials?.token ? { cookie: `token=${credentials.token}` } : {}),
    },
    body: bodyText,
    dispatcher,
    fetchImpl,
  });
  if (response.status === 401 || response.data?.code === 3) {
    throw authExpiredError("Phiên Gosh đã hết hạn.");
  }
  if (!response.ok) throw new Error(`Gosh API lỗi HTTP ${response.status}.`);
  const code = response.data?.code;
  if (code !== 0 && code !== 200) {
    throw new Error(response.data?.toast || response.data?.message || `Gosh API trả mã lỗi ${code}.`);
  }
  return response.data?.data || {};
}

export function goshAnchorId(channelUrl) {
  try {
    return new URL(channelUrl).pathname.match(/^\/(?:[a-z]{2}(?:-[A-Za-z]+)?\/)?(\d+)/)?.[1] || "";
  } catch {
    return "";
  }
}

export async function resolveGoshRoom(channelUrl, { dispatcher, fetchImpl } = {}) {
  const anchorId = goshAnchorId(channelUrl);
  if (!anchorId) throw new Error("URL Gosh chưa trỏ tới phòng live của streamer.");
  // A live id changes every broadcast; keep it only briefly.
  return cachedRoom(`gosh:${anchorId}`, 30_000, async () => {
    const data = await goshRequest("/gosh_base/app/live/batch_get_by_anchor", {
      method: "POST",
      body: { anchor_ids: [anchorId] },
      dispatcher,
      fetchImpl,
    });
    const live = (Array.isArray(data.lives) ? data.lives : []).find(Boolean);
    if (!live?.id) throw new Error("Phòng Gosh hiện không phát live.");
    return {
      anchorId,
      liveId: String(live.id),
      groupId: String(live.im_room || live.avc_room || `@AVC#${anchorId}`),
    };
  });
}

export async function goshLogin({
  usernameOrEmail,
  password,
  smBoxId = GOSH_DEFAULT_SM_BOX_ID,
  dispatcher,
  fetchImpl,
} = {}) {
  const cleanAccount = String(usernameOrEmail || "").trim();
  const cleanPassword = String(password || "");
  if (!cleanAccount || !cleanPassword) {
    throw new Error("Vui lòng nhập đầy đủ Email/Tài khoản và Mật khẩu Gosh.");
  }
  const did = randomUUID().replace(/-/g, "");
  const data = await goshRequest("/gosh_base/app/user/login", {
    method: "POST",
    credentials: { did, uid: "0", ctry: "VN" },
    body: {
      account_type: 9,
      account_id: cleanAccount,
      password: cleanPassword,
      sm_box_id: smBoxId || GOSH_DEFAULT_SM_BOX_ID,
      is_use_password: true,
    },
    dispatcher,
    fetchImpl,
  });
  if (!data?.token || !data?.user?.id) {
    throw new Error("Gosh không trả về token khi đăng nhập bằng mật khẩu.");
  }
  return {
    token: String(data.token),
    uid: String(data.user.id),
    did: String(data.user.login_did || did),
    timUserSig: String(data.tim_user_sig || ""),
    ctry: String(data.user.country || "VN"),
    email: cleanAccount,
    password: cleanPassword,
    nickname: String(data.user.nickname || ""),
  };
}

export async function goshRefresh({ credentials, dispatcher, fetchImpl }) {
  if (credentials?.token) {
    try {
      const data = await goshRequest("/gosh_base/app/user/refresh_token", {
        method: "POST",
        body: {},
        credentials,
        dispatcher,
        fetchImpl,
      });
      if (data?.token) {
        return {
          ...credentials,
          token: String(data.token),
          ...(data.tim_user_sig ? { timUserSig: String(data.tim_user_sig) } : {}),
        };
      }
    } catch {}
  }
  if (credentials?.email && credentials?.password) {
    return goshLogin({
      usernameOrEmail: credentials.email,
      password: credentials.password,
      dispatcher,
      fetchImpl,
    });
  }
  throw loginRequiredError("Phiên Gosh đã hết hạn.");
}

export async function goshAccount({ credentials, dispatcher, fetchImpl }) {
  const data = await goshRequest("/gosh_base/app/user/user_info", {
    query: { user_id: credentials.uid },
    credentials,
    dispatcher,
    fetchImpl,
  });
  if (!data.user?.id) throw loginRequiredError("Không đọc được tài khoản Gosh. Hãy đăng nhập lại.");
  return data.user;
}

export function goshChatUser(account, displayName = "") {
  const user = { ...account };
  for (const key of GOSH_PRIVATE_ACCOUNT_FIELDS) delete user[key];
  const cleanName = String(displayName || "").trim();
  if (cleanName) user.nickname = cleanName;
  if (!user.name_color) user.name_color = GOSH_DEFAULT_NAME_COLOR;
  return user;
}

export function goshChatPayload({ user, liveId, content }) {
  const requestId = randomUUID();
  return JSON.stringify({
    type: 10_000,
    msg_id: Date.now(),
    user: user?.name_color ? user : { ...user, name_color: GOSH_DEFAULT_NAME_COLOR },
    data: {
      text: content,
      rich_content: [{ type: "text", text: content }],
    },
    occur_at: Math.floor(Date.now() / 1000),
    live_id: liveId,
    trace_id: requestId,
    operation_id: requestId,
    correlation_id: requestId,
    client_request_id: requestId,
  });
}

export async function goshUpdateDisplayName({ displayName, credentials, dispatcher, fetchImpl }) {
  const account = await goshAccount({ credentials, dispatcher, fetchImpl });
  const data = await goshRequest("/gosh_base/app/user/user_center?scene=avatar", {
    method: "POST",
    body: {
      nickname: displayName,
      avatar: account.avatar,
      sex: Number(account.sex) || 0,
      country: account.country,
      birthday: account.birthday,
      bio: account.bio,
    },
    credentials,
    dispatcher,
    fetchImpl,
  });
  return data.user ? { ...account, ...data.user } : { ...account, nickname: displayName };
}

export function goshTargetUid(channelUrlOrUid) {
  const raw = String(channelUrlOrUid || "").trim();
  if (/^\d+$/.test(raw)) return raw;
  const fromUrl = goshAnchorId(raw);
  if (fromUrl) return fromUrl;
  const tailDigits = raw.match(/\/(\d+)(?:[/?#]|$)/)?.[1];
  return tailDigits || "";
}

export async function goshChannelProfile(channelUrlOrUid, { credentials, dispatcher, fetchImpl } = {}) {
  const targetUid = goshTargetUid(channelUrlOrUid);
  if (!targetUid) throw new Error("URL hoặc UID kênh Gosh không hợp lệ.");
  const data = await goshRequest("/gosh_base/app/user/profile_card", {
    method: "GET",
    query: { target_uid: targetUid },
    credentials,
    dispatcher,
    fetchImpl,
  });
  return {
    targetUid: String(data?.user?.id || targetUid),
    nickname: String(data?.user?.nickname || data?.user?.show_id || targetUid),
    showId: String(data?.user?.show_id || ""),
    followerCount: Number(data?.relation_info?.follower_num ?? data?.user?.follower_num ?? 0),
    followingCount: Number(data?.relation_info?.following_num ?? data?.user?.following_num ?? 0),
  };
}

export async function goshFollowChannel(channelUrlOrUid, { unfollow = false, credentials, dispatcher, fetchImpl } = {}) {
  const targetUid = goshTargetUid(channelUrlOrUid);
  if (!targetUid) throw new Error("URL hoặc UID kênh Gosh không hợp lệ.");
  const path = unfollow ? "/gosh_social/app/relationship/unfollow" : "/gosh_social/app/relationship/follow";
  const data = await goshRequest(path, {
    method: "POST",
    body: { target_uid: Number(targetUid) },
    credentials,
    dispatcher,
    fetchImpl,
  });
  return {
    targetUid,
    status: Number(data?.status ?? (unfollow ? 0 : 1)),
    followed: !unfollow,
  };
}
let chatSdkFactory = null;

// The Tencent Chat SDK keeps one instance per SDKAppID inside its module
// closure. Evaluating a fresh copy per account gives each account its own
// instance, and passing WebSocket as a parameter routes that copy's socket
// through the account's proxy.
export function loadTencentChat(WebSocketImpl = globalThis.WebSocket) {
  if (!chatSdkFactory) {
    try {
      const source = readFileSync(moduleRequire.resolve("@tencentcloud/chat"), "utf8");
      chatSdkFactory = new Function("module", "exports", "define", "WebSocket", source);
    } catch {
      return {
        EVENT: { SDK_READY: "ready", KICKED_OUT: "kicked" },
        TYPES: { CONV_GROUP: "GROUP" },
        create() {
          return {
            setLogLevel() {},
            on() {},
            off() {},
            isReady: () => false,
            login: () => Promise.reject(new Error("Tencent Chat SDK unavailable")),
            joinGroup: () => Promise.reject(new Error("Tencent Chat SDK unavailable")),
            createCustomMessage: (opts) => opts,
            sendMessage: () => Promise.reject(new Error("Tencent Chat SDK unavailable")),
            logout: () => Promise.resolve(),
            destroy: () => Promise.resolve(),
          };
        },
      };
    }
  }
  const module = { exports: {} };
  chatSdkFactory(module, module.exports, undefined, WebSocketImpl);
  return module.exports;
}

export function proxiedWebSocketClass(dispatcher) {
  if (!dispatcher || !undiciModule?.WebSocket) return UndiciWebSocket;
  return class ProxiedWebSocket extends UndiciWebSocket {
    constructor(url, protocols) {
      super(url, protocols === undefined ? { dispatcher } : { dispatcher, protocols });
    }
  };
}

const TIM_AUTH_ERROR_CODES = new Set([70001, 70003, 70009, 70013, 70014, 70016, 70020, 70051, 70052]);

function timError(error, fallback) {
  const code = Number(error?.code);
  if (TIM_AUTH_ERROR_CODES.has(code)) {
    return authExpiredError("Chữ ký chat (tim_user_sig) của Gosh đã hết hạn.");
  }
  const message = String(error?.message || fallback);
  const wrapped = new Error(code ? `${message} (mã ${code})` : message);
  wrapped.timCode = code || undefined;
  return wrapped;
}

function typexCanonical(value) {
  if (value == null) return "";
  if (typeof value !== "object") return typeof value === "string" ? value : String(value);
  if (Array.isArray(value)) return value.map(typexCanonical).join("");
  return Object.keys(value).sort().map((key) => typexCanonical(value[key])).join("");
}

export function goshTypexSignature(body, secretKey) {
  return createHmac("sha256", secretKey).update(typexCanonical(body)).digest("hex");
}

// One logged-in Gosh IM client (TypeX primary + Tencent IM secondary) for one Gosh account.
export class GoshImSession {
  constructor({ credentials, dispatcher, fetchImpl, createChat }) {
    this.credentials = credentials;
    this.dispatcher = dispatcher;
    this.fetchImpl = fetchImpl;
    this.createChat = createChat;
    this.userID = String(credentials.uid);
    this.userSig = credentials.timUserSig;
    this.TencentCloudChat = null;
    this.chat = null;
    if (createChat) {
      this.#ensureTencentChat();
    }
    this.joinedGroups = new Set();
    this.typexJoinedGroups = new Set();
    this.typexSession = null;
    this.dead = false;
    this.loginPromise = null;
  }

  #ensureTencentChat() {
    if (this.chat) return this.chat;
    const TencentCloudChat = this.createChat
      ? this.createChat()
      : loadTencentChat(proxiedWebSocketClass(this.dispatcher));
    this.TencentCloudChat = TencentCloudChat;
    this.chat = TencentCloudChat.create({ SDKAppID: GOSH_IM_SDK_APP_ID, unlimitedAVChatRoom: true });
    this.chat.setLogLevel?.(4);
    this.chat.on?.(TencentCloudChat.EVENT.KICKED_OUT, () => {
      this.dead = true;
    });
    return this.chat;
  }
  async #typexRequest(path, { method = "POST", body, needSign = true } = {}) {
    const headers = {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      platform: "web",
      origin: "https://gosh.com",
      referer: "https://gosh.com/",
      "user-agent": BROWSER_USER_AGENT,
    };
    if (this.typexSession?.userCode) {
      headers["X-Sid"] = this.typexSession.userCode;
    }
    if (needSign && method.toUpperCase() === "POST" && body && this.typexSession?.secretKey) {
      headers.sign = goshTypexSignature(body, this.typexSession.secretKey);
    }
    const response = await request(`${GOSH_TYPEX_API}${path}`, {
      method,
      headers,
      body,
      dispatcher: this.dispatcher,
      fetchImpl: this.fetchImpl,
    });
    if (!response.ok || response.data?.code !== 0) {
      throw new Error(response.data?.msg || `TypeX HTTP ${response.status}`);
    }
    return response.data.data;
  }

  async #loginTypeX() {
    if (this.typexSession?.userCode && this.typexSession?.secretKey) return this.typexSession;
    const sigData = await goshRequest("/gosh_base/app/user/refresh_typex_usersig", {
      method: "POST",
      body: {},
      credentials: this.credentials,
      dispatcher: this.dispatcher,
      fetchImpl: this.fetchImpl,
    });
    const userCode = String(sigData?.typex_user_sig || "").trim();
    if (!userCode) throw new Error("Không lấy được typex_user_sig từ Gosh.");
    const deviceId = await this.#typexRequest("/device_api/device_id", {
      method: "POST",
      body: { platform: "web", hash_str: "" },
      needSign: false,
    });
    const loginData = await this.#typexRequest("/user/session/login", {
      method: "POST",
      body: { userCode, device_id: String(deviceId || "") },
      needSign: false,
    });
    if (!loginData?.key) throw new Error("Không đăng nhập được phiên chat TypeX của Gosh.");
    this.typexSession = {
      userCode,
      secretKey: String(loginData.key),
      deviceId: String(deviceId || ""),
      userId: String(loginData.id || ""),
    };
    return this.typexSession;
  }

  #loginTencent(timeoutMs = 15_000) {
    this.#ensureTencentChat();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Đăng nhập chat Gosh quá thời gian.")), timeoutMs);
      const onReady = () => {
        clearTimeout(timer);
        this.chat.off?.(this.TencentCloudChat.EVENT.SDK_READY, onReady);
        resolve();
      };
      this.chat.on(this.TencentCloudChat.EVENT.SDK_READY, onReady);
      this.chat.login({ userID: this.userID, userSig: this.userSig }).then(() => {
        if (this.chat.isReady?.()) onReady();
      }, (error) => {
        clearTimeout(timer);
        this.chat.off?.(this.TencentCloudChat.EVENT.SDK_READY, onReady);
        reject(timError(error, "Không đăng nhập được chat Gosh."));
      });
    });
  }

  login(timeoutMs = 15_000) {
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = (async () => {
      if (this.createChat) {
        const [typexRes, timRes] = await Promise.allSettled([
          this.#loginTypeX(),
          this.#loginTencent(timeoutMs),
        ]);
        if (typexRes.status === "fulfilled" || timRes.status === "fulfilled") return;
        throw timRes.reason || typexRes.reason || new Error("Không đăng nhập được chat Gosh.");
      }
      try {
        await this.#loginTypeX();
      } catch (typexErr) {
        await this.#loginTencent(timeoutMs).catch(() => {
          throw typexErr;
        });
      }
    })();
    this.loginPromise.catch(() => {
      this.dead = true;
    });
    return this.loginPromise;
  }

  async join(groupId, liveId = "") {
    await this.login();
    if (liveId && !this.joinedGroups.has(groupId) && !this.typexJoinedGroups.has(groupId)) {
      await goshRequest("/gosh_base/app/live/join", {
        method: "POST",
        body: { live_id: String(liveId), instance_id: randomUUID() },
        credentials: this.credentials,
        dispatcher: this.dispatcher,
        fetchImpl: this.fetchImpl,
      }).catch(() => {});
    }
    const tasks = [];
    if (this.typexSession && !this.typexJoinedGroups.has(groupId)) {
      tasks.push(
        this.#typexRequest("/liveshow/join", {
          method: "POST",
          body: { room_id: groupId },
        }).then(() => {
          this.typexJoinedGroups.add(groupId);
        }),
      );
    }
    if (this.chat && !this.joinedGroups.has(groupId)) {
      tasks.push(
        this.chat.joinGroup({ groupID: groupId }).then(() => {
          this.joinedGroups.add(groupId);
        }).catch((error) => {
          throw timError(error, "Không vào được phòng chat Gosh.");
        }),
      );
    }
    if (!tasks.length) return;
    const settled = await Promise.allSettled(tasks);
    if (settled.every((item) => item.status === "rejected")) {
      throw settled[0].reason;
    }
  }

  async send({ groupId, payloadData, liveId = "" }) {
    await this.join(groupId, liveId);
    const tasks = [];
    if (this.typexSession) {
      tasks.push(
        this.#typexRequest("/liveshow/send_message", {
          method: "POST",
          body: { room_id: groupId, content: payloadData },
        }).then((data) => ({
          provider: "typex",
          providerMessageId: String(data?.message_id || ""),
        })).catch((error) => {
          this.typexJoinedGroups.delete(groupId);
          throw error;
        }),
      );
    }
    if (this.chat) {
      tasks.push(
        (async () => {
          const message = this.chat.createCustomMessage({
            to: groupId,
            conversationType: this.TencentCloudChat.TYPES.CONV_GROUP,
            payload: { data: payloadData, description: "", extension: "" },
          });
          try {
            const result = await this.chat.sendMessage(message);
            return {
              provider: "tencent",
              providerMessageId: String(result?.data?.message?.ID || ""),
            };
          } catch (error) {
            // Rejoin next time: the group session may have been dropped server side.
            this.joinedGroups.delete(groupId);
            throw timError(error, "Gosh từ chối bình luận.");
          }
        })(),
      );
    }
    const settled = await Promise.allSettled(tasks);
    const fulfilled = settled.filter((item) => item.status === "fulfilled").map((item) => item.value);
    if (!fulfilled.length) {
      const rejected = settled.find((item) => item.status === "rejected");
      throw rejected?.reason || new Error("Gosh từ chối bình luận.");
    }
    const primary = fulfilled.find((item) => item.provider === "typex" && item.providerMessageId)
      || fulfilled.find((item) => item.providerMessageId)
      || fulfilled[0];
    return { providerMessageId: String(primary?.providerMessageId || "") };
  }

  async destroy() {
    this.dead = true;
    this.typexSession = null;
    try {
      await this.chat.logout();
    } catch {}
    try {
      await this.chat.destroy();
    } catch {}
  }
}
