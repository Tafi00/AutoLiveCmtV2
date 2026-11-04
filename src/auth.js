import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const DEFAULT_WEB_USERNAME = process.env.ALC_ADMIN_USER || "admin";
export const SESSION_COOKIE_NAME = "alc_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashPassword(password, saltHex) {
  const salt = Buffer.from(saltHex, "hex");
  return scryptSync(String(password), salt, 64).toString("hex");
}

function safeEqualHex(a, b) {
  try {
    const bufA = Buffer.from(String(a || ""), "hex");
    const bufB = Buffer.from(String(b || ""), "hex");
    if (bufA.length !== bufB.length || bufA.length === 0) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function parseCookies(cookieHeader = "") {
  const out = {};
  for (const part of String(cookieHeader || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

export class WebAuthManager {
  constructor(dataDirectory) {
    this.filePath = join(dataDirectory, "web-auth.json");
    this.state = null;
    this.failedAttempts = new Map();
  }

  async init() {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed?.username && parsed?.passwordHash && parsed?.salt && parsed?.sessionSecret) {
        this.state = parsed;
        return;
      }
    } catch {}
    // Never ship a fixed password: without ALC_ADMIN_PASS, the first run picks a
    // random one and prints it once so the owner can sign in and change it.
    const initialPassword = process.env.ALC_ADMIN_PASS || randomBytes(9).toString("base64url");
    if (!process.env.ALC_ADMIN_PASS) {
      console.log(`Mật khẩu quản trị web ban đầu (${DEFAULT_WEB_USERNAME}): ${initialPassword}`);
    }
    const salt = randomBytes(16).toString("hex");
    this.state = {
      username: DEFAULT_WEB_USERNAME,
      salt,
      passwordHash: hashPassword(initialPassword, salt),
      sessionSecret: randomBytes(32).toString("hex"),
      updatedAt: new Date().toISOString(),
    };
    await this.#persist();
  }

  async #persist() {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(this.state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tmp, this.filePath);
  }

  get username() {
    return this.state?.username || DEFAULT_WEB_USERNAME;
  }

  createSessionToken(ttlMs = SESSION_TTL_MS) {
    const payload = Buffer.from(JSON.stringify({
      u: this.username,
      exp: Date.now() + ttlMs,
    })).toString("base64url");
    const sig = createHmac("sha256", this.state.sessionSecret).update(payload).digest("hex");
    return `${payload}.${sig}`;
  }

  verifySessionToken(token = "") {
    if (!token || typeof token !== "string" || !this.state?.sessionSecret) return null;
    const dot = token.indexOf(".");
    if (dot <= 0) return null;
    const payloadPart = token.slice(0, dot);
    const sigPart = token.slice(dot + 1);
    const expectedSig = createHmac("sha256", this.state.sessionSecret).update(payloadPart).digest("hex");
    if (!safeEqualHex(sigPart, expectedSig)) return null;
    try {
      const data = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
      if (!data?.exp || Date.now() > Number(data.exp)) return null;
      if (data.u !== this.username) return null;
      return { username: data.u, expiresAt: Number(data.exp) };
    } catch {
      return null;
    }
  }

  extractRequestSession(request) {
    const cookies = parseCookies(request.headers?.cookie || "");
    if (cookies[SESSION_COOKIE_NAME]) {
      const verified = this.verifySessionToken(cookies[SESSION_COOKIE_NAME]);
      if (verified) return verified;
    }
    const authHeader = String(request.headers?.authorization || "");
    if (authHeader.toLowerCase().startsWith("bearer ")) {
      const verified = this.verifySessionToken(authHeader.slice(7).trim());
      if (verified) return verified;
    }
    return null;
  }

  verifyCredentials(username, password, clientIp = "unknown") {
    const now = Date.now();
    const record = this.failedAttempts.get(clientIp);
    if (record && record.count >= 12 && now - record.lastAt < 5 * 60 * 1000) {
      const waitSec = Math.ceil((5 * 60 * 1000 - (now - record.lastAt)) / 1000);
      const err = new Error(`Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${waitSec} giây.`);
      err.status = 429;
      throw err;
    }
    const cleanUser = String(username || "").trim();
    const cleanPass = String(password || "");
    const candidateHash = hashPassword(cleanPass, this.state.salt);
    const userMatch = cleanUser.toLowerCase() === this.username.toLowerCase();
    const passMatch = safeEqualHex(candidateHash, this.state.passwordHash);
    if (!userMatch || !passMatch) {
      this.failedAttempts.set(clientIp, {
        count: (record && now - record.lastAt < 5 * 60 * 1000 ? record.count : 0) + 1,
        lastAt: now,
      });
      const err = new Error("Tài khoản hoặc mật khẩu không chính xác.");
      err.status = 401;
      throw err;
    }
    this.failedAttempts.delete(clientIp);
    return {
      username: this.username,
      token: this.createSessionToken(),
    };
  }

  async updateCredentials({ currentPassword, newUsername, newPassword }) {
    const candidateHash = hashPassword(String(currentPassword || ""), this.state.salt);
    if (!safeEqualHex(candidateHash, this.state.passwordHash)) {
      const err = new Error("Mật khẩu hiện tại không chính xác.");
      err.status = 401;
      throw err;
    }
    const cleanUser = String(newUsername || this.username).trim();
    if (cleanUser.length < 3 || cleanUser.length > 32) {
      throw new Error("Tên đăng nhập phải từ 3 đến 32 ký tự.");
    }
    const cleanPass = String(newPassword || "");
    if (cleanPass.length < 6) {
      throw new Error("Mật khẩu mới phải có ít nhất 6 ký tự.");
    }
    const salt = randomBytes(16).toString("hex");
    this.state = {
      username: cleanUser,
      salt,
      passwordHash: hashPassword(cleanPass, salt),
      sessionSecret: randomBytes(32).toString("hex"),
      updatedAt: new Date().toISOString(),
    };
    await this.#persist();
    return {
      username: this.username,
      token: this.createSessionToken(),
    };
  }
}
