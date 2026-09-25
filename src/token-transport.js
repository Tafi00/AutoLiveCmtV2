// Pure-token transports: every request here goes straight from Node to the
// sites' own APIs with the account's saved tokens. No browser is involved, so
// the cost of a send does not grow with the number of configured accounts.
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fetch as undiciFetch, ProxyAgent, WebSocket as UndiciWebSocket } from "undici";
import { getGaquaytvRoomId, getLocoStreamId } from "./platforms.js";
import { parseProxy } from "./store.js";

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
  const dispatcher = new ProxyAgent(options);
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
  const pathId = getGaquaytvRoomId(channelUrl) || "";
  if (UUID_PATTERN.test(pathId)) return pathId;
  return cachedRoom(`gaquaytv:${channelUrl}`, 10 * 60_000, async () => {
    const page = await request(channelUrl, {
      headers: { "user-agent": BROWSER_USER_AGENT, accept: "text/html" },
      dispatcher,
      fetchImpl,
    });
    if (!page.ok) throw new Error(`Không mở được phòng GaQuayTV (HTTP ${page.status}).`);
    const escapedSlug = decodeURIComponent(pathId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = page.text.match(/\\?"roomId\\?":\\?"([0-9a-f-]{36})\\?"/i)
      || (pathId && page.text.match(new RegExp(`\\\\?"id\\\\?":\\\\?"([0-9a-f-]{36})\\\\?",\\\\?"slug\\\\?":\\\\?"${escapedSlug}\\\\?"`, "i")));
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
  constructor({ token = "", dispatcher, WebSocketImpl = UndiciWebSocket, url = GAQUAYTV_CHAT_URL } = {}) {
    this.token = token;
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

  joinRoom(room) {
    if (this.joinedRooms.has(room)) return;
    this.emit("join_room", { room });
    this.joinedRooms.add(room);
  }

  // The server does not acknowledge send_message. Success is the room echoing
  // the message back; an explicit error event means it was rejected.
  async sendChat({ room, content, sender, confirmTimeoutMs = 2_500 }) {
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
      if (result.error) throw new Error(`GaQuayTV từ chối bình luận: ${result.error}`);
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
export const GOSH_IM_SDK_APP_ID = 20011275;
const GOSH_WEB_VERSION = "3.9.2";
// The website signs requests from the pc client with this key (the "web"
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
  const did = credentials?.did || "";
  const uid = credentials?.uid || "0";
  const base = {
    app: "kick", bid: "26", ch: "website", ctry: credentials?.ctry || "", did, lang: "en", os: "Windows",
    pf: "pc", uid, us: "0", vsn: GOSH_WEB_VERSION, _fbp: "", _fbc: "", smid: "", sid: "", ts,
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
  return user;
}

export function goshChatPayload({ user, liveId, content }) {
  const requestId = randomUUID();
  return JSON.stringify({
    type: 10_000,
    msg_id: 0,
    user,
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

let chatSdkFactory = null;

// The Tencent Chat SDK keeps one instance per SDKAppID inside its module
// closure. Evaluating a fresh copy per account gives each account its own
// instance, and passing WebSocket as a parameter routes that copy's socket
// through the account's proxy.
export function loadTencentChat(WebSocketImpl = globalThis.WebSocket) {
  if (!chatSdkFactory) {
    const require = createRequire(import.meta.url);
    const source = readFileSync(require.resolve("@tencentcloud/chat"), "utf8");
    chatSdkFactory = new Function("module", "exports", "define", "WebSocket", source);
  }
  const module = { exports: {} };
  chatSdkFactory(module, module.exports, undefined, WebSocketImpl);
  return module.exports;
}

export function proxiedWebSocketClass(dispatcher) {
  if (!dispatcher) return UndiciWebSocket;
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

// One logged-in Tencent IM client for one Gosh account.
export class GoshImSession {
  constructor({ credentials, dispatcher, createChat }) {
    this.userID = String(credentials.uid);
    this.userSig = credentials.timUserSig;
    const TencentCloudChat = createChat
      ? createChat()
      : loadTencentChat(proxiedWebSocketClass(dispatcher));
    this.TencentCloudChat = TencentCloudChat;
    this.chat = TencentCloudChat.create({ SDKAppID: GOSH_IM_SDK_APP_ID, unlimitedAVChatRoom: true });
    this.chat.setLogLevel?.(4);
    this.joinedGroups = new Set();
    this.dead = false;
    this.loginPromise = null;
    // Another login of the same account (e.g. the user opened Chrome) kicks
    // this client out; the next send starts a fresh one.
    this.chat.on?.(TencentCloudChat.EVENT.KICKED_OUT, () => {
      this.dead = true;
    });
  }

  login(timeoutMs = 15_000) {
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = new Promise((resolve, reject) => {
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
    this.loginPromise.catch(() => {
      this.dead = true;
    });
    return this.loginPromise;
  }

  async join(groupId) {
    await this.login();
    if (this.joinedGroups.has(groupId)) return;
    try {
      await this.chat.joinGroup({ groupID: groupId });
    } catch (error) {
      throw timError(error, "Không vào được phòng chat Gosh.");
    }
    this.joinedGroups.add(groupId);
  }

  async send({ groupId, payloadData }) {
    await this.join(groupId);
    const message = this.chat.createCustomMessage({
      to: groupId,
      conversationType: this.TencentCloudChat.TYPES.CONV_GROUP,
      payload: { data: payloadData, description: "", extension: "" },
    });
    try {
      const result = await this.chat.sendMessage(message);
      return { providerMessageId: String(result?.data?.message?.ID || "") };
    } catch (error) {
      // Rejoin next time: the group session may have been dropped server side.
      this.joinedGroups.delete(groupId);
      throw timError(error, "Gosh từ chối bình luận.");
    }
  }

  async destroy() {
    this.dead = true;
    try {
      await this.chat.logout();
    } catch {}
    try {
      await this.chat.destroy();
    } catch {}
  }
}
