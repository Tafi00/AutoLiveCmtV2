import { randomUUID } from "node:crypto";
import { assertPlatformUrl, normalizePlatform, PLATFORMS } from "./platforms.js";
import {
  cookiesFromCredentials,
  credentialsFromCookies,
  forgetResolvedRoom,
  GaquaytvChatSocket,
  gaquaytvLogin,
  gaquaytvProfile,
  gaquaytvRefresh,
  gaquaytvUpdateDisplayName,
  goshAccount,
  goshChatPayload,
  goshChatUser,
  GoshImSession,
  goshUpdateDisplayName,
  jwtExpiresWithin,
  locoIdentity,
  locoRefresh,
  locoSendComment,
  loginRequiredError,
  proxyDispatcher,
  resolveGaquaytvRoom,
  resolveGoshRoom,
  resolveLocoStream,
} from "./token-transport.js";

// Warm realtime connections are dropped after this long without a send, so a
// few hundred rotating accounts never hold a few hundred sockets open.
export const REALTIME_IDLE_MS = 3 * 60_000;
const MAX_DISPLAY_NAME_LENGTH = 20;

function userActionRequired(message) {
  const error = new Error(message);
  error.code = "USER_ACTION_REQUIRED";
  return error;
}

// Sends and renames for one account using only its saved tokens. The Chrome
// profile is read once to obtain the tokens (and again after the user signs
// in through it); nothing else touches the browser.
export class TokenSession {
  constructor({ accountId, platform = "gosh", proxy = "", vault, browser, deps = {} }) {
    this.accountId = accountId;
    this.platform = normalizePlatform(platform);
    this.proxy = proxy || "";
    this.vault = vault;
    this.browser = browser;
    this.deps = deps;
    this.identity = null;
    this.lastError = "";
    this.authFailed = false;
    this.profileLoad = null;
    this.authRecovery = null;
    this.profileIsAuthoritative = false;
    // Loco pairs the device id with a per-session id, like one browser tab.
    this.locoSessionUid = randomUUID().replace(/-/g, "").slice(0, 17);
    this.identityDetection = null;
    this.goshUser = null;
    this.goshIm = null;
    this.gaquaytvSocket = null;
    this.gaquaytvSender = null;
    this.idleTimer = null;
  }

  get dispatcher() {
    return proxyDispatcher(this.proxy);
  }

  get transportOptions() {
    return { dispatcher: this.dispatcher, fetchImpl: this.deps.fetch };
  }

  #record() {
    const record = this.vault.get(this.accountId);
    return record?.platform === this.platform ? record : null;
  }

  hasCredentials() {
    return Boolean(this.#record()?.credentials);
  }

  setProxy(proxy) {
    const next = proxy || "";
    if (next === this.proxy) return;
    this.proxy = next;
    // Realtime sockets were opened through the old proxy.
    void this.closeRealtime();
  }

  // Called when a visible Chrome login window closes: whatever the profile now
  // holds (a new login, a logout) replaces the saved tokens.
  markProfileChanged() {
    this.profileIsAuthoritative = true;
  }

  async #saveCredentials(credentials, source) {
    await this.vault.set(this.accountId, { platform: this.platform, source, credentials });
    this.authFailed = false;
    this.lastError = "";
    // A fresh login may be a different account; a refresh is the same one.
    if (source !== "refresh") this.identity = null;
    this.goshUser = null;
    this.gaquaytvSender = null;
    // Realtime clients authenticated with the old token.
    await this.closeRealtime();
    if (source !== "refresh") {
      this.identityDetection = this.#detectIdentity(credentials);
      void this.identityDetection;
    }
    return credentials;
  }

  // Lets the dashboard show the account name as soon as tokens are loaded.
  async #detectIdentity(credentials) {
    try {
      if (this.platform === "loco") {
        this.identity = this.#identityFrom(locoIdentity(credentials).username, "token");
      } else if (this.platform === "gaquaytv") {
        await this.#gaquaytvSenderFor(credentials);
      } else {
        await this.#goshUserFor(credentials);
      }
    } catch {
      // The next send reports token problems.
    }
  }

  async loadFromProfile() {
    this.profileLoad ||= this.#loadFromProfile().finally(() => {
      this.profileLoad = null;
    });
    return this.profileLoad;
  }

  async #loadFromProfile() {
    if (this.browser.isManualLoginRunning()) {
      throw userActionRequired("Hãy hoàn tất đăng nhập rồi đóng cửa sổ Chrome của tài khoản trước.");
    }
    const authoritative = this.profileIsAuthoritative;
    const cookies = await this.browser.readCookies();
    const credentials = credentialsFromCookies(this.platform, cookies);
    this.profileIsAuthoritative = false;
    if (!credentials) {
      if (authoritative) await this.vault.delete(this.accountId);
      this.authFailed = true;
      throw loginRequiredError(this.platform === "gosh"
        ? "Profile Chrome chưa đăng nhập Gosh (hoặc chỉ là phiên khách). Hãy đăng nhập an toàn cho tài khoản này."
        : `Profile Chrome chưa đăng nhập ${PLATFORMS[this.platform].name}. Hãy đăng nhập an toàn cho tài khoản này.`);
    }
    return this.#saveCredentials(credentials, "chrome");
  }

  async ensureCredentials() {
    const record = this.#record();
    if (record?.credentials && !this.profileIsAuthoritative) return record.credentials;
    return this.loadFromProfile();
  }

  // Before a visible Chrome window opens, write refreshed tokens back so the
  // browser does not sign in with a refresh token the app already rotated.
  async syncToProfile() {
    const record = this.#record();
    if (!record?.credentials || record.source === "chrome") return;
    const cookies = cookiesFromCredentials(this.platform, record.credentials);
    if (!cookies.length) return;
    await this.browser.writeCookies(cookies);
    await this.vault.set(this.accountId, { ...record, source: "chrome" });
  }

  async #refresh(credentials) {
    const options = { credentials, ...this.transportOptions };
    if (this.platform === "gaquaytv") return gaquaytvRefresh(options);
    if (this.platform === "loco") return locoRefresh(options);
    return null;
  }

  // The token was rejected: refresh it through the API, otherwise fall back to
  // whatever the Chrome profile holds now.
  async #recoverAuth(rejected) {
    this.authRecovery ||= (async () => {
      const current = this.#record()?.credentials;
      if (current && JSON.stringify(current) !== JSON.stringify(rejected)) return current;
      const refreshed = await this.#refresh(rejected).catch(() => null);
      if (refreshed) return this.#saveCredentials(refreshed, "refresh");
      const fromProfile = await this.loadFromProfile().catch(() => null);
      if (fromProfile && JSON.stringify(fromProfile) !== JSON.stringify(rejected)) return fromProfile;
      this.authFailed = true;
      throw loginRequiredError(`Phiên ${PLATFORMS[this.platform].name} đã hết hạn. Hãy đăng nhập an toàn lại cho tài khoản này.`);
    })().finally(() => {
      this.authRecovery = null;
    });
    return this.authRecovery;
  }

  async #withCredentials(operation) {
    let credentials = await this.ensureCredentials();
    if (this.platform !== "gosh" && jwtExpiresWithin(credentials.accessToken, 60_000)) {
      credentials = await this.#recoverAuth(credentials).catch(() => credentials);
    }
    try {
      return await operation(credentials);
    } catch (error) {
      if (error.code !== "AUTH_EXPIRED") throw error;
      credentials = await this.#recoverAuth(credentials);
      return operation(credentials);
    }
  }

  #touchRealtime() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      void this.closeRealtime();
    }, REALTIME_IDLE_MS);
    this.idleTimer.unref?.();
  }

  async closeRealtime() {
    clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const socket = this.gaquaytvSocket;
    const im = this.goshIm;
    this.gaquaytvSocket = null;
    this.goshIm = null;
    socket?.close();
    await im?.destroy();
  }

  async sendComment({ channelUrl, content }) {
    const safeUrl = assertPlatformUrl(channelUrl, this.platform);
    const cleanContent = String(content ?? "").trim();
    if (!cleanContent) throw new Error("Không có nội dung để gửi.");
    try {
      const result = await this.#withCredentials((credentials) => this.#send(credentials, safeUrl, cleanContent));
      this.lastError = "";
      this.authFailed = false;
      return { sentAt: new Date().toISOString(), url: safeUrl, transport: "token", provider: this.platform, ...result };
    } catch (error) {
      this.lastError = error.message;
      throw error;
    }
  }

  async #send(credentials, channelUrl, content) {
    if (this.platform === "loco") {
      const streamId = await resolveLocoStream(channelUrl, this.transportOptions);
      this.identity ||= this.#identityFrom(locoIdentity(credentials).username, "token");
      return locoSendComment({
        streamId,
        content,
        credentials,
        sessionUid: this.locoSessionUid,
        ...this.transportOptions,
      });
    }
    if (this.platform === "gaquaytv") return this.#sendGaquaytv(credentials, channelUrl, content);
    return this.#sendGosh(credentials, channelUrl, content);
  }

  #identityFrom(displayName, source) {
    const clean = String(displayName || "").trim();
    if (!clean) return this.identity;
    if (this.identity?.source === "explicit_update") return this.identity;
    return { displayName: clean, source, detectedAt: new Date().toISOString() };
  }

  async #gaquaytvSenderFor(credentials) {
    if (!this.gaquaytvSender) {
      const profile = await gaquaytvProfile({ credentials, ...this.transportOptions });
      this.gaquaytvSender = profile;
      this.identity = this.#identityFrom(profile.displayName, "auth_me");
    }
    const sender = { ...this.gaquaytvSender };
    if (this.identity?.source === "explicit_update") sender.displayName = this.identity.displayName;
    return sender;
  }

  async #gaquaytvSocketFor(credentials) {
    if (!this.gaquaytvSocket?.connected || this.gaquaytvSocket.token !== credentials.accessToken) {
      this.gaquaytvSocket?.close();
      this.gaquaytvSocket = new GaquaytvChatSocket({
        token: credentials.accessToken,
        dispatcher: this.dispatcher,
        ...(this.deps.WebSocket ? { WebSocketImpl: this.deps.WebSocket } : {}),
      });
    }
    const socket = this.gaquaytvSocket;
    this.#touchRealtime();
    await socket.connect();
    return socket;
  }

  async #sendGaquaytv(credentials, channelUrl, content) {
    const room = await resolveGaquaytvRoom(channelUrl, this.transportOptions);
    const sender = await this.#gaquaytvSenderFor(credentials);
    const socket = await this.#gaquaytvSocketFor(credentials);
    const result = await socket.sendChat({ room, content, sender });
    return { confirmed: result.confirmed };
  }

  async #goshUserFor(credentials) {
    if (!this.goshUser) {
      this.goshUser = await goshAccount({ credentials, ...this.transportOptions });
      this.identity = this.#identityFrom(this.goshUser.nickname, "user_info");
    }
    return this.goshUser;
  }

  async #goshImFor(credentials) {
    if (!this.goshIm || this.goshIm.dead || this.goshIm.userSig !== credentials.timUserSig) {
      // Replace synchronously so parallel sends to several rooms share one login.
      const stale = this.goshIm;
      this.goshIm = new GoshImSession({
        credentials,
        dispatcher: this.dispatcher,
        createChat: this.deps.createTencentChat,
      });
      void stale?.destroy();
    }
    this.#touchRealtime();
    return this.goshIm;
  }

  // Does everything a send needs except sending: token refresh, room lookup,
  // profile lookup and the realtime login. The bulk sender calls this for the
  // next accounts in rotation while it waits out the delay, so their send is
  // just the final request.
  async prepare({ channelUrl }) {
    if (!this.hasCredentials() || this.profileIsAuthoritative) return;
    const safeUrl = assertPlatformUrl(channelUrl, this.platform);
    await this.#withCredentials(async (credentials) => {
      if (this.platform === "loco") {
        await resolveLocoStream(safeUrl, this.transportOptions);
      } else if (this.platform === "gaquaytv") {
        const room = await resolveGaquaytvRoom(safeUrl, this.transportOptions);
        await this.#gaquaytvSenderFor(credentials);
        (await this.#gaquaytvSocketFor(credentials)).joinRoom(room);
      } else {
        const room = await resolveGoshRoom(safeUrl, this.transportOptions);
        await this.#goshUserFor(credentials);
        await (await this.#goshImFor(credentials)).join(room.groupId);
      }
    });
  }

  async #sendGosh(credentials, channelUrl, content) {
    const room = await resolveGoshRoom(channelUrl, this.transportOptions);
    const account = await this.#goshUserFor(credentials);
    const displayName = this.identity?.source === "explicit_update" ? this.identity.displayName : "";
    const payloadData = goshChatPayload({ user: goshChatUser(account, displayName), liveId: room.liveId, content });
    const im = await this.#goshImFor(credentials);
    try {
      return await im.send({ groupId: room.groupId, payloadData });
    } catch (error) {
      if (error.code === "AUTH_EXPIRED" || /group|10007|10010|10015/i.test(error.message)) {
        // A new broadcast can move the chat group; resolve it again next time.
        forgetResolvedRoom(`gosh:${room.anchorId}`);
      }
      if (error.code === "AUTH_EXPIRED" && this.goshIm === im) {
        await im.destroy();
        this.goshIm = null;
      }
      throw error;
    }
  }

  async updateDisplayName(displayName) {
    const cleanName = String(displayName ?? "").trim();
    if (!cleanName) throw new Error("Tên hiển thị không được để trống.");
    if (this.platform !== "gosh" && this.platform !== "gaquaytv") {
      throw new Error("Chức năng đổi tên chỉ áp dụng cho tài khoản Gosh và GaQuayTV.");
    }
    if (cleanName.length > MAX_DISPLAY_NAME_LENGTH) {
      throw new Error(`Tên hiển thị không được vượt quá ${MAX_DISPLAY_NAME_LENGTH} ký tự.`);
    }
    await this.#withCredentials(async (credentials) => {
      if (this.platform === "gaquaytv") {
        await gaquaytvUpdateDisplayName({ displayName: cleanName, credentials, ...this.transportOptions });
        if (this.gaquaytvSender) this.gaquaytvSender.displayName = cleanName;
      } else {
        this.goshUser = await goshUpdateDisplayName({ displayName: cleanName, credentials, ...this.transportOptions });
      }
    });
    this.identity = { displayName: cleanName, source: "explicit_update", detectedAt: new Date().toISOString() };
    return { displayName: cleanName, updatedAt: new Date().toISOString() };
  }

  // GaQuayTV also accepts a username/password login through its API, which
  // gives tokens directly without opening Chrome.
  async login({ usernameOrEmail, password }) {
    if (this.platform !== "gaquaytv") {
      throw new Error("Đăng nhập bằng mật khẩu chỉ hỗ trợ GaQuayTV.");
    }
    const credentials = await gaquaytvLogin({ usernameOrEmail, password, ...this.transportOptions });
    await this.#saveCredentials(credentials, "api_login");
    await this.identityDetection;
    return this.identity;
  }

  status() {
    const record = this.#record();
    const manual = this.browser.isManualLoginRunning();
    const identity = this.identity || this.browser.identity || null;
    const ready = Boolean(record?.credentials) && !manual && !this.authFailed && !this.profileIsAuthoritative;
    return {
      running: this.browser.isRunning(),
      loginState: manual
        ? "manual_login"
        : ready ? "signed_in" : this.authFailed ? "signed_out" : "unknown",
      readyToComment: ready,
      hasToken: Boolean(record?.credentials),
      tokenSource: record?.source || "",
      tokenUpdatedAt: record?.updatedAt || null,
      url: "",
      identity,
      ...(this.lastError && !ready ? { error: this.lastError } : {}),
    };
  }

  async close() {
    await this.closeRealtime();
  }
}
