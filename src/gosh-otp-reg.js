import { access, lstat, mkdir, readFile, readlink, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { JsonStore, normalizeProxyUrl, parseProxy } from "./store.js";
import { TokenVault } from "./token-vault.js";

const GOSH_API = "https://api.gosh.com";
const GOSH_WEB_VERSION = "3.9.2";
const GOSH_PC_SIGN_KEY = "A7fQ9K2mX8Zp4R3L";
const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

function goshSignature({ did, uid, ts, method, path, body }) {
  const params = { did, uid, ts, method, path };
  if (body !== undefined) params.body = createHash("sha256").update(body).digest("hex");
  const canonical = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join("&");
  return createHmac("sha256", GOSH_PC_SIGN_KEY).update(canonical).digest("hex");
}

async function fetchViaHttpProxy(targetUrl, { method = "GET", headers = {}, body, proxyUrl, timeoutMs = 15_000 }) {
  const parsedProxy = parseProxy(proxyUrl);
  if (!parsedProxy?.server) {
    return globalThis.fetch(targetUrl, { method, headers, body, signal: AbortSignal.timeout(timeoutMs) });
  }
  const proxy = new URL(parsedProxy.server);
  const target = new URL(targetUrl);
  const proxyAuth = parsedProxy.username
    ? `Basic ${Buffer.from(`${parsedProxy.username}:${parsedProxy.password || ""}`).toString("base64")}`
    : "";

  return new Promise((resolveRes, rejectRes) => {
    const connectReq = http.request({
      host: proxy.hostname,
      port: Number(proxy.port) || 80,
      method: "CONNECT",
      path: `${target.hostname}:${Number(target.port) || 443}`,
      headers: {
        host: `${target.hostname}:${Number(target.port) || 443}`,
        ...(proxyAuth ? { "proxy-authorization": proxyAuth } : {}),
      },
      timeout: timeoutMs,
    });
    connectReq.once("error", rejectRes);
    connectReq.once("timeout", () => {
      connectReq.destroy(new Error("Proxy CONNECT timeout"));
    });
    connectReq.once("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        rejectRes(new Error(`Proxy CONNECT trả mã ${res.statusCode}`));
        return;
      }
      const tlsSocket = tls.connect({
        socket,
        servername: target.hostname,
      });
      const req = https.request({
        hostname: target.hostname,
        port: Number(target.port) || 443,
        path: `${target.pathname}${target.search}`,
        method,
        headers: {
          ...headers,
          ...(body ? { "content-length": Buffer.byteLength(body) } : {}),
        },
        createConnection: () => tlsSocket,
        timeout: timeoutMs,
      }, (httpRes) => {
        const chunks = [];
        httpRes.on("data", (c) => chunks.push(c));
        httpRes.on("end", () => {
          const textBody = Buffer.concat(chunks).toString("utf8");
          resolveRes({
            ok: httpRes.statusCode >= 200 && httpRes.statusCode < 300,
            status: httpRes.statusCode,
            text: async () => textBody,
          });
        });
      });
      req.once("error", rejectRes);
      if (body) req.write(body);
      req.end();
    });
    connectReq.end();
  });
}

async function goshApiRequest(path, { method = "GET", query = {}, body, did: customDid, uid: customUid, token = "", proxy = "", fetchImpl } = {}) {
  const ts = String(Math.floor(Date.now() / 1000));
  const did = customDid || randomUUID().replace(/-/g, "");
  const uid = String(customUid || "0");
  const base = {
    app: "kick", bid: "26", ch: "website", ctry: "VN", did, lang: "en", os: "Windows",
    pf: "pc", uid, us: "0", vsn: GOSH_WEB_VERSION, _fbp: "", _fbc: "", smid: "", sid: "", ts,
  };
  const bodyText = method === "POST" ? JSON.stringify(body || {}) : undefined;
  const signature = goshSignature({ did, uid, ts, method, path: path.split("?")[0], body: bodyText });
  const search = new URLSearchParams(method === "GET" ? { ...base, ...query } : base);
  const fullUrl = `${GOSH_API}${path}${path.includes("?") ? "&" : "?"}${search}`;
  const headers = {
    "content-type": "application/json",
    "x-signature": signature,
    origin: "https://gosh.com",
    referer: "https://gosh.com/",
    "user-agent": BROWSER_USER_AGENT,
    ...(token ? { cookie: `token=${token}` } : {}),
  };
  const res = fetchImpl
    ? await fetchImpl(fullUrl, { method, headers, body: bodyText })
    : proxy
      ? await fetchViaHttpProxy(fullUrl, { method, headers, body: bodyText, proxyUrl: proxy })
      : await globalThis.fetch(fullUrl, { method, headers, body: bodyText });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok || (json.code !== 0 && json.code !== 200)) {
    const err = new Error(json.toast || json.message || `Gosh API lỗi (${json.code ?? res.status})`);
    err.goshCode = json.code;
    throw err;
  }
  return json.data || {};
}

function getChromeCandidatePaths() {
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
  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"];
}

async function waitForProfileUnlock(profileDirectory, timeoutMs = 5_000) {
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
        let alive = true;
        try {
          process.kill(pid, 0);
        } catch (err) {
          if (err.code === "ESRCH") alive = false;
        }
        if (!alive) {
          await Promise.allSettled(
            ["SingletonLock", "SingletonCookie", "SingletonSocket"].map((n) => unlink(join(profileDirectory, n))),
          );
          return;
        }
      }
    } catch {}
    if (Date.now() >= deadline) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function evaluateCdpExpression(webSocketUrl, expression, timeoutMs = 2_500) {
  if (typeof globalThis.WebSocket !== "function") return null;
  return new Promise((resolveEval) => {
    let ws;
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {}
      resolveEval(val);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      ws = new globalThis.WebSocket(webSocketUrl);
      ws.onopen = () => {
        ws.send(JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        }));
      };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data || ""));
          if (data.id === 1) finish(data.result?.result?.value ?? null);
        } catch {
          finish(null);
        }
      };
      ws.onerror = () => finish(null);
      ws.onclose = () => finish(null);
    } catch {
      finish(null);
    }
  });
}
export const DEFAULT_GMAIL_URL = "https://mail.google.com/mail/u/0/#inbox";
export const GOSH_HOME_URL = "https://gosh.com/";

/**
 * Generates an email alias variant from a base email address using either:
 * - "dot": inserts dots between characters of the local part (e.g. a.bcdef@gmail.com)
 * - "plus": appends +tag to the local part (e.g. abcdef+gosh1@gmail.com)
 * - "both": combines dot placement and a +tag suffix
 */
export function generateEmailVariant(baseEmail, { mode = "dot", index = 1, tagPrefix = "gosh" } = {}) {
  const raw = String(baseEmail || "").trim().toLowerCase();
  const atIndex = raw.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === raw.length - 1) {
    throw new Error("Địa chỉ email gốc không hợp lệ.");
  }
  const rawLocal = raw.slice(0, atIndex);
  const domain = raw.slice(atIndex + 1);
  const baseLocal = rawLocal.split("+")[0].replace(/\./g, "");
  if (baseLocal.length < 2) {
    throw new Error("Phần tên trước @ của email quá ngắn để tạo biến thể.");
  }

  const safeIndex = Math.max(1, Math.floor(Number(index) || 1));
  const cleanMode = String(mode || "dot").toLowerCase();

  if (cleanMode === "plus") {
    return `${baseLocal}+${tagPrefix}${safeIndex}@${domain}`;
  }
  if (cleanMode === "hyphen" || cleanMode === "dash") {
    return `${baseLocal}-${tagPrefix}${safeIndex}@${domain}`;
  }
  // Number of non-zero bitmasks for (n - 1) gaps between n characters is 2^(n-1) - 1
  const maxDotMasks = (1 << Math.min(baseLocal.length - 1, 20)) - 1;
  const mask = ((safeIndex - 1) % maxDotMasks) + 1;
  let dotted = baseLocal[0];
  for (let i = 1; i < baseLocal.length; i++) {
    if (i <= 20 && (mask & (1 << (i - 1))) !== 0) {
      dotted += ".";
    }
    dotted += baseLocal[i];
  }

  if (cleanMode === "both" || safeIndex > maxDotMasks) {
    const cycle = Math.floor((safeIndex - 1) / maxDotMasks) + 1;
    return `${dotted}+${tagPrefix}${cycle}@${domain}`;
  }

  return `${dotted}@${domain}`;
}

/**
 * Extracts a 6-digit Gosh OTP verification code from email subject/snippet/body.
 */
export function extractGoshOtpFromText(text) {
  const clean = String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";

  // Prefer 6-digit numbers near verification/code/OTP keywords
  const contextualPatterns = [
    /(?:verification\s*code|security\s*code|verify\s*code|otp|code|mã\s*xác\s*minh|mã\s*xác\s*nhận)[^0-9]{0,40}\b(\d{6})\b/i,
    /\b(\d{6})\b[^0-9]{0,40}(?:is\s*your|verification\s*code|valid\s*for|minutes)/i,
  ];
  for (const pattern of contextualPatterns) {
    const match = clean.match(pattern);
    if (match?.[1]) return match[1];
  }

  // Fallback: any standalone 6-digit number in a Gosh email
  const allSixDigits = [...clean.matchAll(/\b(\d{6})\b/g)].map((m) => m[1]);
  return allSixDigits[0] || "";
}

/**
 * Parses Gmail's Atom XML feed (<entry> blocks) and returns candidate Gosh OTP messages.
 */
export function parseGmailAtomEntries(xmlText) {
  const xml = String(xmlText || "");
  if (!xml.includes("<feed")) return [];

  const fullEmailMatch = xml.match(/<title>[^<]*for\s+([^\s<]+@[^\s<]+)<\/title>/i);
  const accountEmail = fullEmailMatch?.[1]?.trim().toLowerCase() || "";

  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const id = block.match(/<id>([\s\S]*?)<\/id>/i)?.[1]?.trim() || "";
    const title = decodeXmlEntities(block.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "");
    const summary = decodeXmlEntities(block.match(/<summary>([\s\S]*?)<\/summary>/i)?.[1]?.trim() || "");
    const issued = block.match(/<issued>([\s\S]*?)<\/issued>/i)?.[1]?.trim() || "";
    const authorName = decodeXmlEntities(block.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>/i)?.[1]?.trim() || "");
    const authorEmail = decodeXmlEntities(block.match(/<author>[\s\S]*?<email>([\s\S]*?)<\/email>/i)?.[1]?.trim() || "");
    const combined = `${authorName} ${authorEmail} ${title} ${summary}`;
    const isGoshRelated = /gosh|verification\s*code|verify|security\s*code|otp/i.test(combined);
    const otp = isGoshRelated ? extractGoshOtpFromText(`${title} ${summary}`) : "";
    entries.push({
      id: id || `${issued}:${title}`,
      title,
      summary,
      issued,
      issuedMs: issued ? Date.parse(issued) || 0 : 0,
      authorName,
      authorEmail,
      isGoshRelated,
      otp,
      accountEmail,
    });
  }
  return entries;
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Generates valid Gosh registration profile fields (nickname, password, birthday).
 */
const VN_FAMILY = [
  "nguyen", "tran", "le", "pham", "huynh", "hoang", "phan", "vu", "vo", "dang",
  "bui", "do", "ho", "ngo", "duong", "ly", "trinh", "dinh", "lam", "mai",
];
const VN_MIDDLE = [
  "minh", "khanh", "hoang", "bao", "ngoc", "tuan", "quoc", "thao", "gia", "thanh",
  "duc", "phuc", "xuan", "thu", "hai", "anh", "nhat", "phuong", "hong", "kim",
];
const VN_GIVEN = [
  "anh", "linh", "vy", "nhi", "han", "kiet", "nam", "huy", "khang", "phuc",
  "long", "quan", "tung", "son", "khoa", "phong", "dat", "lam", "trang", "my",
  "chau", "ngan", "tuyen", "thao", "quynh", "truc", "uyen", "thien", "binh", "hung",
];
const CUTE_NOUNS = [
  "meo_luoi", "gau_truc", "tho_trang", "ca_map", "vit_vang", "soc_nau", "cua_bien", "chim_canh_cut",
  "tra_sua", "ca_phe_sua", "matcha_latte", "banh_mi", "kem_dua", "sua_tuoi", "sinh_to_bo", "hat_de",
  "may_trang", "ang_may", "nang_som", "mua_chieu", "gio_dong", "sao_dem", "anh_trang", "hoa_anh_dao",
];
const CUTE_ADJS = [
  "nho", "xinh", "cute", "ngoan", "vui_ve", "dang_yeu", "hay_cuoi", "me_ngu",
  "thich_hat", "thich_game", "me_phim", "di_phuot", "cham_chi", "ngoc_nghech", "lanh_lung", "am_ap",
];
const CITIES = [
  "saigon", "hanoi", "danang", "dalat", "cantho", "haiphong", "nhatrang", "vungtau", "hue", "halong",
];
const EN_ADJS = [
  "Silent", "Midnight", "Golden", "Velvet", "Cosmic", "Neon", "Crystal", "Shadow",
  "Arctic", "Crimson", "Lunar", "Solar", "Mystic", "Astral", "Frost", "Ember",
  "Sunny", "Lazy", "Lucky", "Happy", "Chill", "Cozy", "Swift", "Gentle",
];
const EN_NOUNS = [
  "Rider", "Wanderer", "Drifter", "Hunter", "Wolf", "Blade", "Falcon", "Phoenix",
  "Horizon", "Breeze", "Storm", "Wave", "Walker", "Seeker", "Fox", "Raven",
  "Cat", "Panda", "Cloud", "Star", "Moon", "Spark", "Dreamer", "Vibes",
];
const JP_HANDLES = [
  "haruki", "yukino", "sora", "akira", "sakura", "mochi", "hikari", "kuro",
  "kaito", "renji", "hinata", "ayaka", "kazuki", "mikasa", "takumi", "yuna",
];

function cap(word) {
  return word ? word[0].toUpperCase() + word.slice(1) : "";
}

export function generateGoshRegistrationProfile(seed = "") {
  const bytes = randomBytes(8);
  const suffix = (seed || bytes.toString("hex"))
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .slice(0, 10)
    .padEnd(8, "x");
  const n1 = parseInt(suffix.slice(0, 2), 36);
  const n2 = parseInt(suffix.slice(2, 4), 36);
  const n3 = parseInt(suffix.slice(4, 6), 36);
  const n4 = parseInt(suffix.slice(6, 8), 36);

  const fam = VN_FAMILY[(n1 + bytes[0]) % VN_FAMILY.length];
  const mid = VN_MIDDLE[(n2 + bytes[1]) % VN_MIDDLE.length];
  let giv = VN_GIVEN[(n3 + bytes[2]) % VN_GIVEN.length];
  if (giv === mid) giv = VN_GIVEN[(n3 + bytes[2] + 5) % VN_GIVEN.length];

  const cuteNoun = CUTE_NOUNS[(n1 + n3) % CUTE_NOUNS.length];
  const cuteAdj = CUTE_ADJS[(n2 + n4) % CUTE_ADJS.length];
  const city = CITIES[(n1 + n4) % CITIES.length];
  const enAdj = EN_ADJS[(n1 + bytes[3]) % EN_ADJS.length];
  const enNoun = EN_NOUNS[(n2 + bytes[4]) % EN_NOUNS.length];
  const jp = JP_HANDLES[(n3 + bytes[5]) % JP_HANDLES.length];
  const birthYear = 1996 + (bytes[6] % 9);
  const shortYear = String(birthYear).slice(-2);

  const style = (n4 + bytes[7]) % 16;
  let rawNick = "";
  switch (style) {
    case 0:
      // Full Vietnamese name joined lowercase: e.g. nguyenminhquan, tranbaochau
      rawNick = `${fam}${mid}${giv}`;
      break;
    case 1:
      // Full Vietnamese name with underscores: e.g. le_hoang_nam, pham_khanh_linh
      rawNick = `${fam}_${mid}_${giv}`;
      break;
    case 2:
      // PascalCase Vietnamese full name: e.g. HoangTuanKiet, DangNgocHan
      rawNick = `${cap(fam)}${cap(mid)}${cap(giv)}`;
      break;
    case 3:
      // Middle + Given + family: e.g. minhanh_nguyen, tuankiet_le
      rawNick = `${mid}${giv}_${fam}`;
      break;
    case 4:
      // Cute VN nickname + adjective (no numbers): e.g. gau_truc_nho, tra_sua_cute
      rawNick = `${cuteNoun}_${cuteAdj}`.slice(0, 20);
      break;
    case 5:
      // Cute VN nickname joined (no underscore, no numbers): e.g. meoluoixinh, banhmisaigon
      rawNick = `${cuteNoun.replace(/_/g, "")}${cuteAdj.replace(/_/g, "")}`.slice(0, 18);
      break;
    case 6:
      // English Aesthetic / Gaming PascalCase: e.g. MidnightRider, GoldenHorizon, SilentWolf
      rawNick = `${enAdj}${enNoun}${cap(giv)}`;
      break;
    case 7:
      // English Aesthetic with underscore: e.g. velvet_drifter_vn, cosmic_fox_nhi
      rawNick = `${enAdj.toLowerCase()}_${enNoun.toLowerCase()}_${giv}`;
      break;
    case 8:
      // Name + VN city: e.g. minhanh_saigon, khanhlinh_hanoi, tuankiet_dalat
      rawNick = `${mid}${giv}_${city}`;
      break;
    case 9:
      // Gen-Z phrase + name: e.g. chill_cung_linh, goc_nho_cua_vy, tiem_nho_cua_han
      rawNick = `${["chill_cung", "goc_cua", "nha_cua", "vibe_cua", "nhat_ky"][n1 % 5]}_${mid}_${giv}`;
      break;
    case 10:
      // Name + hobby/trait: e.g. khang_thich_hat, ngoc_hay_cuoi, nam_di_phuot
      rawNick = `${mid}${giv}_${cuteAdj}`;
      break;
    case 11:
      // Name + full birth year: e.g. minhanh1999, khanhlinh2002, hoangnam2000
      rawNick = `${fam[0]}${mid}${giv}${birthYear}`;
      break;
    case 12:
      // Japanese/Anime style + VN name: e.g. haruki_minh, sakura_linh, kaito_nam
      rawNick = `${jp}_${mid}${giv}`;
      break;
    case 13:
      // Repeated last letter Gen-Z VN (natural): e.g. khanhlinhhh_vn, baongoccc_sg
      rawNick = `${mid}${giv}${giv.slice(-1).repeat(2)}_${fam}`;
      break;
    case 14:
      // Initial + middle + given + short year: e.g. n_minhquan99, t_baongoc02
      rawNick = `${fam[0]}_${mid}${giv}${shortYear}`;
      break;
    default:
      // Clean camelCase English + VN: e.g. sunnyMinhAnh, cozyKhanhLinh, luckyTuanKiet
      rawNick = `${enAdj.toLowerCase()}${cap(mid)}${cap(giv)}`;
      break;
  }

  // Gosh nickname rule: 6-20 chars, /^[A-Za-z0-9_]+$/, cannot be all digits
  const nickname = rawNick.replace(/[^A-Za-z0-9_]/g, "").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 20).padEnd(6, "a");
  // Gosh password rule: 8-32 chars, must contain [a-z], [A-Z], \d, and [^A-Za-z0-9]
  const password = `Gosh@${suffix.slice(0, 6)}99!`;
  const month = String(1 + (n2 % 12)).padStart(2, "0");
  const day = String(1 + (n3 % 28)).padStart(2, "0");
  const birthday = `${birthYear}-${month}-${day}`;
  const birthdayUnix = Math.floor(new Date(`${birthday}T00:00:00Z`).getTime() / 1000);

  return {
    nickname,
    password,
    birthday,
    birthdayUnix,
  };
}

/**
 * Finds the next email variant (. or +) that Gosh reports as available (`can_register: true`).
 */
export async function findNextRegistrableEmail(baseEmail, {
  mode = "dot",
  startIndex = 1,
  maxAttempts = 50,
  usedEmails = new Set(),
  fetchImpl,
  allowCanonicalFallback = false,
} = {}) {
  let firstUnused = null;
  for (let offset = 0; offset < maxAttempts; offset++) {
    const index = startIndex + offset;
    const candidate = generateEmailVariant(baseEmail, { mode, index });
    if (usedEmails.has(candidate.toLowerCase())) continue;
    if (!firstUnused) firstUnused = { email: candidate, index, canonicalizedByCheck: true };

    const data = await goshApiRequest("/gosh_base/app/user/check_account_can_register", {
      method: "POST",
      body: { account: candidate },
      fetchImpl,
    });
    if (data?.can_register) {
      return { email: candidate, index, canonicalizedByCheck: false };
    }
    // If the very first check on a Gmail variant is false and not in usedEmails,
    // Gosh's check_account_can_register canonicalizes all . and + variants of that Gmail.
    if (allowCanonicalFallback && offset === 0) {
      return firstUnused;
    }
  }
  if (allowCanonicalFallback && firstUnused) return firstUnused;
  throw new Error(`Không tìm được biến thể email khả dụng sau ${maxAttempts} lần thử.`);
}

async function findChromeExecutable() {
  for (const candidate of getChromeCandidatePaths()) {
    try {
      await access(candidate, constants.F_OK);
      return candidate;
    } catch {}
  }
  throw new Error("Không tìm thấy Google Chrome hoặc Microsoft Edge trên máy.");
}

async function availableLocalPort() {
  return new Promise((resolvePort) => {
    const srv = createServer();
    srv.unref();
    srv.once("error", () => resolvePort(0));
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolvePort(port));
    });
  });
}

function isProcessAlive(child) {
  return Boolean(child && child.exitCode === null && !child.killed);
}

/**
 * Manages a dedicated Chrome window logged into Gmail (or Outlook) to read incoming Gosh OTPs.
 */
export class OtpMailBrowser {
  constructor({ profileDirectory }) {
    this.profileDirectory = profileDirectory;
    this.child = null;
    this.debugPort = null;
    this.seenOtpKeys = new Set();
  }

  async isDebuggerAlive(port = this.debugPort) {
    if (!port) return false;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  isRunning() {
    return isProcessAlive(this.child) || Boolean(this.debugPort);
  }

  async launch(targetUrl = DEFAULT_GMAIL_URL) {
    if (this.debugPort && (await this.isDebuggerAlive(this.debugPort))) {
      return { debugPort: this.debugPort, reused: true };
    }
    await mkdir(this.profileDirectory, { recursive: true });
    for (const fileName of ["cdp-port.txt", "DevToolsActivePort"]) {
      try {
        const raw = await readFile(join(this.profileDirectory, fileName), "utf8");
        const savedPort = Number(raw.split(/\r?\n/)[0]?.trim());
        if (savedPort > 0 && (await this.isDebuggerAlive(savedPort))) {
          this.debugPort = savedPort;
          return { debugPort: savedPort, reused: true };
        }
      } catch {}
    }

    const executablePath = await findChromeExecutable();
    await waitForProfileUnlock(this.profileDirectory);

    const debugPort = await availableLocalPort();
    const args = [
      `--user-data-dir=${this.profileDirectory}`,
      `--remote-debugging-port=${debugPort}`,
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
      // Same caps as CHROME_LIGHT_ARGS in browser-session.js (not imported
      // here to keep Playwright out of this script).
      "--disk-cache-size=52428800",
      "--media-cache-size=10485760",
      "--disable-component-update",
      targetUrl,
    ];
    const child = spawn(executablePath, args, {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    this.child = child;
    this.debugPort = debugPort;
    await writeFile(join(this.profileDirectory, "cdp-port.txt"), `${debugPort}\n`, "utf8").catch(() => {});
    child.once("exit", () => {
      if (this.child === child) {
        this.child = null;
        this.debugPort = null;
      }
    });
    return { debugPort, reused: false };
  }

  async getMailTargets() {
    if (!this.debugPort) return [];
    try {
      const res = await fetch(`http://127.0.0.1:${this.debugPort}/json`, {
        signal: AbortSignal.timeout(1_500),
      });
      if (!res.ok) return [];
      const list = await res.json();
      return (Array.isArray(list) ? list : []).filter((item) => {
        if (!item.webSocketDebuggerUrl || item.type !== "page") return false;
        return /mail\.google\.com|outlook\.live\.com|outlook\.office\.com|mail\.proton\.me|mail\.yahoo\.com/i.test(item.url || "");
      });
    } catch {
      return [];
    }
  }

  /**
   * Probes the open mail tab for login status, logged-in email address, and recent Gosh OTPs.
   */
  async pollMailState() {
    const targets = await this.getMailTargets();
    for (const target of targets) {
      const state = await evaluateCdpExpression(
        target.webSocketDebuggerUrl,
        gmailOtpProbeExpression(),
        4_000,
      );
      if (state) return state;
    }
    return { loggedIn: false, email: "", entries: [] };
  }
  /**
   * Automatically provisions a Yahoo Disposable Email Address (`deaPrefix-gosh{index}@yahoo.com`)
   * inside the logged-in Yahoo Mail tab via its Redux store (`window.__yahooStore`).
   */
  async ensureYahooDisposableEmail({ index = 1, tagPrefix = "gosh", preserveEmail = "" } = {}) {
    const targets = await this.getMailTargets();
    const yahooTarget = targets.find((t) => /mail\.yahoo\.com/i.test(t.url || ""));
    if (!yahooTarget) return null;
    const preserveLower = String(preserveEmail || "").toLowerCase();
    const expr = `(async () => {
      const findStore = () => {
        if (window.__yahooStore?.getState) return window.__yahooStore;
        const root = document.querySelector('#mail-app-component, #app, [data-test-id="mail-app"]');
        const key = root ? Object.keys(root).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$')) : null;
        if (!root || !key) return null;
        const queue = [root[key]];
        const seen = new Set();
        while (queue.length > 0 && seen.size < 2500) {
          const n = queue.shift();
          if (!n || seen.has(n)) continue;
          seen.add(n);
          const candidate = n.memoizedState?.store || n.stateNode?.store || n.memoizedProps?.store;
          if (candidate?.getState) {
            window.__yahooStore = candidate;
            return candidate;
          }
          if (n.child) queue.push(n.child);
          if (n.sibling) queue.push(n.sibling);
          if (n.return) queue.push(n.return);
        }
        return null;
      };

      const store = findStore();
      if (!store) return { error: 'Không tìm thấy Redux store của Yahoo Mail' };

      try {
        Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
      } catch {}

      const waitForStore = (predicate, timeoutMs = 4000) => new Promise((resolve) => {
        if (predicate()) return resolve(true);
        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          try { unsub(); } catch {}
          clearTimeout(timer);
          resolve(ok);
        };
        const unsub = store.subscribe(() => {
          if (predicate()) finish(true);
        });
        const timer = setTimeout(() => finish(predicate()), timeoutMs);
      });

      let mb = store.getState().mailboxes;
      const primaryEmail = mb?.allMailboxes?.[0]?.email || 'user@yahoo.com';
      const baseUser = primaryEmail.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      let prefix = mb?.deaBaseName?.deaPrefix || '';
      const domain = mb?.deaBaseName?.deaDomain || 'yahoo.com';

      if (!prefix) {
        prefix = baseUser + 'base';
        store.dispatch({
          type: 'DISPOSABLE_EMAIL_BASE_NAME_CREATE_REQUESTED',
          baseName: prefix,
          domain,
          actionTimestamp: Date.now(),
        });
        await waitForStore(() => Boolean(store.getState().mailboxes?.deaBaseName?.deaPrefix), 4000);
        prefix = store.getState().mailboxes?.deaBaseName?.deaPrefix || prefix;
      }

      const deaEmail = prefix + '-${tagPrefix}${index}@' + domain;
      const preserve = ${JSON.stringify("")} || '${preserveLower}';
      const existingDeas = Object.values(store.getState().mailboxes?.accounts || {}).filter(
        (a) => a?.type === 'DEA'
          && String(a?.email || '').toLowerCase() !== deaEmail.toLowerCase()
          && (!preserve || String(a?.email || '').toLowerCase() !== preserve)
      );
      const totalDeas = Object.values(store.getState().mailboxes?.accounts || {}).filter((a) => a?.type === 'DEA').length;
      if (totalDeas >= 3 && existingDeas.length >= 1) {
        for (const oldDea of existingDeas.slice(0, totalDeas - 2)) {
          store.dispatch({
            type: 'ACCOUNT_DELETE_REQUESTED',
            accountId: oldDea.id,
            actionTimestamp: Date.now(),
          });
        }
        await waitForStore(() => {
          const currentDeas = Object.values(store.getState().mailboxes?.accounts || {}).filter((a) => a?.type === 'DEA');
          return currentDeas.length < 3;
        }, 3000);
      }

      const isServerReady = () => {
        return Object.values(store.getState().mailboxes?.accounts || {}).some(
          (a) => String(a?.email || '').toLowerCase() === deaEmail.toLowerCase()
            && a?.status === 'ENABLED'
            && Boolean(a?.subscriptionId)
        );
      };
      if (!isServerReady()) {
        store.dispatch({
          type: 'ACCOUNT_ADD_REQUESTED',
          newAccount: {
            email: deaEmail,
            type: 'DEA',
            sendingName: 'Gosh User',
            description: 'Gosh ${index}',
            status: 'ENABLED',
          },
          actionTimestamp: Date.now(),
        });
        await waitForStore(isServerReady, 5000);
      }
      return { email: deaEmail, prefix };
    })()`;
    return evaluateCdpExpression(yahooTarget.webSocketDebuggerUrl, expr, 10_000);
  }

  /**
   * Uses a single ultra-lightweight tab on `https://gosh.com/robots.txt` (50 bytes plain text,
   * zero Next.js/React/video overhead) inside the same Chrome process to obtain a fresh
   * Cloudflare Turnstile token and ShuMei `sm_box_id`.
   */
  async solveTurnstileAndSmBoxId({ proxy = "", workerSlot = null } = {}) {
    await this.launch();
    const listRes = await fetch(`http://127.0.0.1:${this.debugPort}/json`, {
      signal: AbortSignal.timeout(1_500),
    });
    const list = listRes.ok ? await listRes.json() : [];
    const pages = (Array.isArray(list) ? list : []).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
    const workerTabs = pages.filter((t) => /gosh\.com\/robots\.txt/i.test(t.url || ""));
    let workerTab = null;
    if (workerTabs.length > 0) {
      const slot = workerSlot != null
        ? workerSlot % workerTabs.length
        : ((this.turnstileSlotCursor = (this.turnstileSlotCursor || 0) + 1) % workerTabs.length);
      workerTab = workerTabs[slot];
    }
    if (!workerTab) {
      const mailTabs = pages.filter((t) => /mail\.yahoo\.com|mail\.google\.com/i.test(t.url || ""));
      workerTab = mailTabs.length > 1 ? mailTabs[1] : pages.find((t) => !/mail\.yahoo\.com|mail\.google\.com/i.test(t.url || ""));
      if (!workerTab) {
        const newRes = await fetch(`http://127.0.0.1:${this.debugPort}/json/new?${encodeURIComponent("https://gosh.com/robots.txt")}`, {
          method: "PUT",
          signal: AbortSignal.timeout(2_000),
        }).catch(() => null);
        if (newRes?.ok) {
          workerTab = await newRes.json();
        }
      } else {
        await evaluateCdpExpression(workerTab.webSocketDebuggerUrl, `location.href = "https://gosh.com/robots.txt"`, 2_000);
      }
      await new Promise((r) => setTimeout(r, 1_500));
      const refreshed = await (await fetch(`http://127.0.0.1:${this.debugPort}/json`)).json();
      workerTab = refreshed.find((t) => t.type === "page" && /gosh\.com\/robots\.txt/i.test(t.url || "")) || workerTab;
    }

    if (!workerTab?.webSocketDebuggerUrl) {
      throw new Error("Không khởi tạo được tab Turnstile nhẹ.");
    }

    const expr = `(async () => {
      try {
        Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
        Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
      } catch {}

      if (!window.__turnstileReady || !window.turnstile) {
        document.head.innerHTML = '<title>Gosh Light Turnstile Worker</title>';
        document.body.innerHTML = '<div id="cf-box"></div>';
        await new Promise((resolve) => {
          const s = document.createElement('script');
          s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
          s.onload = resolve;
          document.head.appendChild(s);
        });
        window.__turnstileReady = true;
      }

      const freshSmPayloadPromise = (async () => {
        try {
          const iframe = document.createElement('iframe');
          iframe.style.display = 'none';
          iframe.src = '/robots.txt?r=' + Math.random();
          document.body.appendChild(iframe);
          await new Promise((r) => { iframe.onload = r; });
          const win = iframe.contentWindow;
          const doc = iframe.contentDocument;
          const rand = Math.floor(Math.random() * 100000000);
          const randHex = rand.toString(16).padStart(8, '0');
          Object.defineProperty(doc, 'cookie', { get: () => '', set: () => {}, configurable: true });
          win.Storage.prototype.getItem = () => null;
          win.Storage.prototype.setItem = () => {};
          Object.defineProperty(win.navigator, 'userAgent', {
            get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/14' + (rand % 9) + '.0.' + (rand % 9999) + '.0 Safari/537.36'
          });
          Object.defineProperty(win.navigator, 'appVersion', {
            get: () => '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/14' + (rand % 9) + '.0.' + (rand % 9999) + '.0 Safari/537.36'
          });
          Object.defineProperty(win.navigator, 'hardwareConcurrency', { get: () => 2 + (rand % 14) });
          Object.defineProperty(win.navigator, 'deviceMemory', { get: () => [2, 4, 8, 16, 32][rand % 5] });
          Object.defineProperty(win.screen, 'width', { get: () => 1280 + (rand % 640) });
          Object.defineProperty(win.screen, 'height', { get: () => 720 + (rand % 360) });
          if (win.WebGLRenderingContext) {
            const origGetParam = win.WebGLRenderingContext.prototype.getParameter;
            win.WebGLRenderingContext.prototype.getParameter = function(p) {
              if (p === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce RTX ' + (3050 + (rand % 140)) + ' Direct3D11 vs_5_0 ps_5_0, D3D11-' + randHex + ')';
              if (p === 37445) return 'Google Inc. (NVIDIA)';
              return origGetParam.call(this, p);
            };
          }
          const origGetContext = win.HTMLCanvasElement.prototype.getContext;
          win.HTMLCanvasElement.prototype.getContext = function(type, ...args) {
            const ctx = origGetContext.call(this, type, ...args);
            if (type === '2d' && ctx && !ctx.__hooked) {
              ctx.__hooked = true;
              const origFillText = ctx.fillText;
              ctx.fillText = function(text, x, y, ...rest) {
                return origFillText.call(this, String(text) + randHex, x, y, ...rest);
              };
            }
            return ctx;
          };
          let capturedPayload = null;
          const origStringify = win.JSON.stringify;
          win.JSON.stringify = function(val, ...rest) {
            if (val && typeof val === 'object' && val.organization === 'P0B5C8oZAWUX5ZohkdRW' && val.ep && val.data && val.encode === 5) {
              capturedPayload = { ...val };
            }
            return origStringify.call(this, val, ...rest);
          };
          win._smConf = {
            organization: 'P0B5C8oZAWUX5ZohkdRW',
            appId: 'default',
            publicKey: 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDBVSJkRhSERLWdLEjux1HuSCh2UYmjl4Sa6uO5dpzfthwwPV7SwJRkSmbjYeYAb+FfTRYTrijkdRGnJQYsrZ+dZIvjmNW9Bq3lz33Yj1wNUn6XjB12/7dRCK89hw5hMmx48i5oV2/Z+eo/ngLK6r7Ockg9bHpazlJiDgrOtU9Z0wIDAQAB',
            staticHost: 'static.portal101.cn',
            protocol: 'https',
            apiHost: 'fp-sa-it-acc.portal101.cn'
          };
          await new Promise((r) => {
            const s = doc.createElement('script');
            s.src = 'https://static.portal101.cn/dist/web/v3.0.0/fp.min.js';
            s.onload = r;
            s.onerror = r;
            doc.head.appendChild(s);
          });
          await win.SMSdk?.createDeviceId?.();
          for (let i = 0; i < 35; i++) {
            await new Promise((r) => setTimeout(r, 80));
            const id = win.SMSdk?.getDeviceId?.() || '';
            if (id && id.length === 89 && id.startsWith('B')) {
              iframe.remove();
              return { smBoxId: id, smPayload: capturedPayload };
            }
          }
          const fallback = win.SMSdk?.getDeviceId?.() || '';
          iframe.remove();
          return { smBoxId: fallback, smPayload: capturedPayload };
        } catch {
          return { smBoxId: '', smPayload: null };
        }
      })();

      const turnstilePromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Turnstile timeout')), 10000);
        const box = document.getElementById('cf-box');
        box.innerHTML = '';
        window.turnstile.render(box, {
          sitekey: '0x4AAAAAAB59foUGeT1OCqJx',
          callback: (token) => { clearTimeout(timer); resolve(token); },
          'error-callback': (err) => { clearTimeout(timer); reject(new Error('Turnstile error: ' + err)); }
        });
      });

      const [turnstileToken, smInfo] = await Promise.all([turnstilePromise, freshSmPayloadPromise]);
      return { turnstileToken, smBoxId: smInfo?.smBoxId || '', smPayload: smInfo?.smPayload || null };
    })()`;
    let res = await evaluateCdpExpression(workerTab.webSocketDebuggerUrl, expr, 14_000);
    if (!res?.turnstileToken || !res?.smBoxId) {
      await evaluateCdpExpression(workerTab.webSocketDebuggerUrl, `location.href = "https://gosh.com/robots.txt?t=" + Date.now()`, 2_000).catch(() => {});
      await new Promise((r) => setTimeout(r, 1_200));
      res = await evaluateCdpExpression(workerTab.webSocketDebuggerUrl, expr, 14_000);
    }
    return res;
  }
  /**
   * Snapshot existing OTPs so we only return newly-arrived codes after `markBaseline()`.
   */
  async markBaseline() {
    const state = await this.pollMailState();
    for (const item of state.entries || []) {
      if (item.otp) {
        this.seenOtpKeys.add(`${item.id}:${item.otp}`);
        this.seenOtpKeys.add(`code:${item.otp}`);
      }
    }
    return state;
  }

  /**
   * Waits until a logged-in Gmail/Webmail account is detected in the Chrome window.
   */
  async waitForMailLogin({ timeoutMs = 300_000, onTick } = {}) {
    await this.launch();
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (!(await this.isDebuggerAlive())) {
        throw new Error("Cửa sổ Chrome hộp thư đã bị đóng trước khi đăng nhập xong.");
      }
      const state = await this.pollMailState();
      if (state.loggedIn && state.email) {
        return state;
      }
      onTick?.(state);
      await new Promise((r) => setTimeout(r, 1_200));
    }
    throw new Error("Quá thời gian chờ đăng nhập hộp thư.");
  }

  /**
   * Polls the logged-in mailbox for a new 6-digit Gosh OTP code.
   */
  async waitForNewGoshOtp({ timeoutMs = 28_000, targetEmail = "", onTick } = {}) {
    await this.launch();
    const cleanTarget = String(targetEmail || "").trim().toLowerCase();
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (!(await this.isDebuggerAlive())) {
        throw new Error("Cửa sổ Chrome hộp thư đã bị đóng trong lúc chờ OTP.");
      }
      const state = await this.pollMailState();
      for (const entry of state.entries || []) {
        if (!entry.otp) continue;
        if (cleanTarget && entry.toEmail && entry.toEmail.toLowerCase() !== cleanTarget) continue;
        const entryKey = `${entry.id}:${entry.otp}`;
        const codeKey = `code:${entry.otp}`;
        if (this.seenOtpKeys.has(entryKey) || this.seenOtpKeys.has(codeKey)) continue;
        this.seenOtpKeys.add(entryKey);
        this.seenOtpKeys.add(codeKey);
        return {
          otp: entry.otp,
          entry,
          email: state.email,
        };
      }
      onTick?.(state);
      await new Promise((r) => setTimeout(r, 600));
    }
    throw new Error("Quá thời gian chờ mã OTP từ Gosh.");
  }

  async close() {
    if (this.child && isProcessAlive(this.child)) {
      try {
        this.child.kill("SIGTERM");
      } catch {}
    }
    this.child = null;
    this.debugPort = null;
  }
}

/**
 * In-page expression evaluated inside the Gmail / Outlook tab via CDP.
 * Combines Gmail's Atom XML feed with DOM inbox row/body scraping so OTPs are
 * caught immediately even if the user hasn't clicked the email row.
 */
export function gmailOtpProbeExpression() {
  return `(async () => {
    const extractOtp = (raw) => {
      const clean = String(raw || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\\s+/g, ' ').trim();
      if (!clean) return '';
      const patterns = [
        /(?:verification\\s*code|security\\s*code|verify\\s*code|otp|code|mã\\s*xác\\s*minh|mã\\s*xác\\s*nhận)[^0-9]{0,40}\\b(\\d{6})\\b/i,
        /\\b(\\d{6})\\b[^0-9]{0,40}(?:is\\s*your|verification\\s*code|valid\\s*for|minutes)/i
      ];
      for (const p of patterns) {
        const m = clean.match(p);
        if (m && m[1]) return m[1];
      }
      const six = clean.match(/\\b(\\d{6})\\b/);
      return six ? six[1] : '';
    };

    const host = location.hostname.toLowerCase();
    const entries = [];
    let email = '';

    // 1. Detect email from title, DOM attributes, or Yahoo/Google global config
    const titleEmail = (document.title || '').match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})/);
    if (titleEmail) email = titleEmail[1].toLowerCase();
    if (!email) {
      const el = document.querySelector('[data-email], [aria-label*="@gmail.com"], [aria-label*="@yahoo."], [aria-label*="@outlook."], [aria-label*="@hotmail."]');
      const attr = el ? (el.getAttribute('data-email') || el.getAttribute('aria-label') || '') : '';
      const m = attr.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,})/);
      if (m) email = m[1].toLowerCase();
    }
    if (!email && host.includes('mail.yahoo.com')) {
      const htmlMatch = (document.body?.innerText || '').match(/([a-zA-Z0-9._+-]+@yahoo\\.[a-z.]+)/i);
      if (htmlMatch) email = htmlMatch[1].toLowerCase();
    }
    // 2. If on Gmail, fetch the built-in Atom feed for unread emails
    if (host.includes('mail.google.com')) {
      try {
        const pathPrefix = location.pathname.match(/^\\/mail\\/u\\/\\d+/)?.[0] || '/mail/u/0';
        const res = await fetch(pathPrefix + '/feed/atom?zx=' + Date.now(), {
          credentials: 'include',
          cache: 'no-store'
        });
        if (res.ok) {
          const xml = await res.text();
          const feedEmail = xml.match(/<title>[^<]*for\\s+([^\\s<]+@[^\\s<]+)<\\/title>/i);
          if (feedEmail && feedEmail[1]) email = feedEmail[1].toLowerCase();
          const blocks = xml.match(/<entry>[\\s\\S]*?<\\/entry>/gi) || [];
          for (const block of blocks) {
            const id = (block.match(/<id>([\\s\\S]*?)<\\/id>/i)?.[1] || '').trim();
            const title = (block.match(/<title>([\\s\\S]*?)<\\/title>/i)?.[1] || '').trim();
            const summary = (block.match(/<summary>([\\s\\S]*?)<\\/summary>/i)?.[1] || '').trim();
            const issued = (block.match(/<issued>([\\s\\S]*?)<\\/issued>/i)?.[1] || '').trim();
            const author = (block.match(/<author>([\\s\\S]*?)<\\/author>/i)?.[1] || '').trim();
            const combined = author + ' ' + title + ' ' + summary;
            if (/gosh|verification|verify|security\\s*code|otp/i.test(combined)) {
              const otp = extractOtp(title + ' ' + summary);
              entries.push({ id: id || ('atom:' + issued + ':' + title), title, summary, issued, otp, source: 'gmail_atom' });
            }
          }
        }
      } catch {}

      // 3. Also scan visible Gmail inbox rows (tr.zA) and any open message body (.a3s)
      try {
        const rows = Array.from(document.querySelectorAll('tr.zA')).slice(0, 15);
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const text = (row.innerText || '').replace(/\\s+/g, ' ').trim();
          if (/gosh|verification|verify|security\\s*code|otp/i.test(text)) {
            const otp = extractOtp(text);
            const rowId = row.getAttribute('data-legacy-thread-id') || row.id || ('row-' + i + '-' + text.slice(0, 40));
            entries.push({ id: 'dom_row:' + rowId, title: text.slice(0, 120), summary: text, otp, source: 'gmail_dom_row' });
            // If unread Gosh row has no OTP in snippet, click it once to open body
            if (!otp && row.classList.contains('zE') && !row.dataset.goshAutoOpened) {
              row.dataset.goshAutoOpened = '1';
              row.click();
            }
          }
        }
        const bodies = Array.from(document.querySelectorAll('.a3s, [role="listitem"]')).slice(-5);
        for (let i = 0; i < bodies.length; i++) {
          const text = (bodies[i].innerText || '').replace(/\\s+/g, ' ').trim();
          if (/gosh|verification\\s*code/i.test(text)) {
            const otp = extractOtp(text);
            if (otp) {
              entries.push({ id: 'dom_body:' + otp, title: 'Gosh Email Body', summary: text.slice(0, 200), otp, source: 'gmail_dom_body' });
            }
          }
        }
      } catch {}
    } else if (host.includes('mail.yahoo.com')) {
      // 1. Read directly from Yahoo Mail's Redux store (subjectsAndSnippets) if available
      try {
        const root = document.querySelector('#mail-app-component, #app, [data-test-id="mail-app"]');
        const key = root ? Object.keys(root).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$')) : null;
        if (!window.__yahooStore && root && key) {
          const queue = [root[key]];
          const seen = new Set();
          while (queue.length > 0 && seen.size < 2500) {
            const n = queue.shift();
            if (!n || seen.has(n)) continue;
            seen.add(n);
            const candidate = n.memoizedState?.store || n.stateNode?.store || n.memoizedProps?.store;
            if (candidate?.getState) {
              window.__yahooStore = candidate;
              break;
            }
            if (n.child) queue.push(n.child);
            if (n.sibling) queue.push(n.sibling);
            if (n.return) queue.push(n.return);
          }
        }
        const store = window.__yahooStore;
        if (store?.getState) {
          const st = store.getState();
          const primaryEmail = st?.mailboxes?.allMailboxes?.[0]?.email;
          if (primaryEmail) email = primaryEmail.toLowerCase();
          const subjects = st?.subjectsAndSnippets?.subjects || {};
          const snippets = st?.subjectsAndSnippets?.snippets || {};
          const messages = st?.messages || {};
          for (const msgId of Object.keys(snippets).slice(-30)) {
            const subj = Object.values(subjects[msgId] || {})[0] || '';
            const snip = Object.values(snippets[msgId] || {})[0] || '';
            const toEmail = String(messages[msgId]?.headers?.to?.[0]?.email || '').toLowerCase();
            const combined = subj + ' ' + snip;
            if (/gosh|verification|verify|security\\s*code|otp/i.test(combined)) {
              const otp = extractOtp(combined);
              if (otp) {
                entries.push({ id: 'yahoo_redux:' + msgId, title: subj, summary: snip, otp, toEmail, source: 'yahoo_redux' });
              }
            }
          }
          // Periodically trigger lightweight Redux sync to fetch new messages from server
          const now = Date.now();
          if (!window.__lastYahooSyncAt || now - window.__lastYahooSyncAt > 2500) {
            window.__lastYahooSyncAt = now;
            store.dispatch({ type: 'SYNC_DATA', forceSync: true, userInitiated: true, actionTimestamp: now });
            const inboxLink = document.querySelector('[data-test-id="menu-list-item-link"]');
            if (inboxLink) inboxLink.click();
          }
        }
      } catch {}

      // 2. Also scan Yahoo Mail DOM inbox rows and message body
      const rows = Array.from(document.querySelectorAll('[data-test-id="message-list-item"], [data-test-id="virtual-list"] li, a[role="article"]')).slice(0, 20);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const text = (row.innerText || '').replace(/\\s+/g, ' ').trim();
        if (/gosh|verification|verify|security\\s*code|otp/i.test(text)) {
          const otp = extractOtp(text);
          const rowId = row.getAttribute('data-test-id') + '-' + i + '-' + text.slice(0, 40);
          entries.push({ id: 'yahoo_row:' + rowId, title: text.slice(0, 120), summary: text.slice(0, 200), otp, source: 'yahoo_dom_row' });
          if (!otp && !row.dataset.goshAutoOpened) {
            row.dataset.goshAutoOpened = '1';
            row.click();
          }
        }
      }
      const bodies = Array.from(document.querySelectorAll('[data-test-id="message-view-body"], [data-test-id="message-view-body-content"], .msg-body')).slice(-5);
      for (let i = 0; i < bodies.length; i++) {
        const text = (bodies[i].innerText || '').replace(/\\s+/g, ' ').trim();
        if (/gosh|verification|verify|security\\s*code|otp/i.test(text)) {
          const otp = extractOtp(text);
          if (otp) {
            entries.push({ id: 'yahoo_body:' + otp, title: 'Yahoo Gosh Email Body', summary: text.slice(0, 200), otp, source: 'yahoo_dom_body' });
          }
        }
      }
    } else {
      // Generic Webmail (Outlook / Proton) DOM scan
      const items = Array.from(document.querySelectorAll('[role="option"], [role="listitem"], [data-convid], article, .ReadingPaneContent')).slice(0, 20);
      for (let i = 0; i < items.length; i++) {
        const text = (items[i].innerText || '').replace(/\\s+/g, ' ').trim();
        if (/gosh|verification|verify|security\\s*code|otp/i.test(text)) {
          const otp = extractOtp(text);
          if (otp) {
            entries.push({ id: 'webmail:' + otp, title: text.slice(0, 120), summary: text.slice(0, 200), otp, source: 'webmail_dom' });
          }
        }
      }
    }

    const loggedIn = Boolean(email)
      || (host.includes('mail.google.com') && Boolean(document.querySelector('tr.zA, [role="main"]')))
      || (host.includes('mail.yahoo.com') && Boolean(document.querySelector('[data-test-id="mail-app-container"], [data-test-id="compose-button"], [data-test-id="folder-list-item"]')));
    return { loggedIn, email, entries };
  })()`;
}

/**
 * In-page expression to drive the Gosh Sign Up modal in Chrome:
 * - Opens LoginModal if not open
 * - Switches to SignUp tab
 * - Fills Email, Birthday, Username, Password
 * - Or fills the 6-digit OTP when on the OTP step
 */
export function goshSignupStepExpression({ email, nickname, password, birthday, otpToFill = "" }) {
  const payload = JSON.stringify({ email, nickname, password, birthday, otpToFill });
  return `(async () => {
    const cfg = ${payload};

    // Hook fetch once to allow testing . / + variants even when check_account_can_register canonicalizes Gmail,
    // and capture new_send_code / login responses for diagnostics.
    if (!window.__goshFetchHooked) {
      window.__goshFetchHooked = true;
      window.__goshLastApi = {};
      const origFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : (input?.url || '');
        const res = await origFetch(input, init);
        if (url.includes('/gosh_base/app/user/check_account_can_register')) {
          try {
            const clone = res.clone();
            const json = await clone.json();
            window.__goshLastApi.checkRegister = json;
            if (json && json.code === 0 && json.data && json.data.can_register === false) {
              const patched = { ...json, data: { ...json.data, can_register: true } };
              return new Response(JSON.stringify(patched), {
                status: res.status,
                statusText: res.statusText,
                headers: res.headers,
              });
            }
          } catch {}
        } else if (url.includes('/gosh_base/app/sms/new_send_code') || url.includes('/gosh_base/app/user/login')) {
          try {
            const clone = res.clone();
            const json = await clone.json();
            if (url.includes('new_send_code')) window.__goshLastApi.sendCode = json;
            if (url.includes('/user/login')) window.__goshLastApi.login = json;
          } catch {}
        }
        return res;
      };
    }

    const cookies = document.cookie || '';
    const tokenMatch = cookies.match(/(?:^|;\\s*)token=([^;]+)/);
    const uidMatch = cookies.match(/(?:^|;\\s*)uid=(\\d+)/);
    const didMatch = cookies.match(/(?:^|;\\s*)did=([^;]+)/);
    const sigMatch = cookies.match(/(?:^|;\\s*)tim_user_sig=([^;]+)/);
    const userTypeMatch = cookies.match(/(?:^|;\\s*)user_type=(\\d+)/);
    const loginData = window.__goshLastApi?.login?.data;

    if (loginData?.token && loginData?.user?.id && Number(loginData.user.user_type) === 2) {
      return {
        stage: 'authenticated',
        uid: String(loginData.user.id),
        did: String(loginData.user.login_did || (didMatch ? decodeURIComponent(didMatch[1]) : '')),
        token: String(loginData.token),
        timUserSig: String(loginData.tim_user_sig || (sigMatch ? decodeURIComponent(sigMatch[1]) : '')),
        ctry: String(loginData.user.country || 'vn'),
        lastApi: window.__goshLastApi || {},
      };
    }

    if (tokenMatch && uidMatch && sigMatch && userTypeMatch?.[1] !== '1') {
      return {
        stage: 'authenticated',
        uid: uidMatch[1],
        did: didMatch ? decodeURIComponent(didMatch[1]) : '',
        token: decodeURIComponent(tokenMatch[1]),
        timUserSig: decodeURIComponent(sigMatch[1]),
        ctry: 'vn',
        lastApi: window.__goshLastApi || {},
      };
    }
    const setNativeValue = (el, val) => {
      if (!el) return false;
      el.focus();
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, val);
      else el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      return true;
    };

    const findReactFiber = (dom) => {
      if (!dom) return null;
      const key = Object.keys(dom).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      return key ? dom[key] : null;
    };

    // Check if OTP input is currently visible
    const otpInput = document.querySelector('input[data-input-otp]');
    if (otpInput) {
      if (cfg.otpToFill && otpInput.value !== cfg.otpToFill) {
        const fiber = findReactFiber(otpInput);
        let cur = fiber;
        while (cur) {
          const p = cur.memoizedProps;
          if (p && typeof p === 'object' && typeof p.onChange === 'function' && p.maxLength === 6) {
            try {
              p.onChange(cfg.otpToFill);
              return { stage: 'otp_filled', otp: cfg.otpToFill, lastApi: window.__goshLastApi || {} };
            } catch {}
          }
          cur = cur.return;
        }
        setNativeValue(otpInput, cfg.otpToFill);
        return { stage: 'otp_filled', otp: cfg.otpToFill, lastApi: window.__goshLastApi || {} };
      }
      return { stage: 'waiting_otp', currentOtpValue: otpInput.value || '', lastApi: window.__goshLastApi || {} };
    }

    // Check if LoginModal is open
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) {
      // Find Sign Up or Log In button in header
      const buttons = Array.from(document.querySelectorAll('button, a'));
      const signUpBtn = buttons.find((b) => /sign\\s*up|đăng\\s*ký|log\\s*in|đăng\\s*nhập/i.test((b.innerText || '').trim()));
      if (signUpBtn) {
        signUpBtn.click();
        return { stage: 'opening_modal' };
      }
      return { stage: 'no_modal_button' };
    }

    // Ensure SignUp tab is active inside the modal (Radix UI Tabs uses onValueChange)
    const tabs = Array.from(dialog.querySelectorAll('[role="tab"], button'));
    const signUpTab = tabs.find((t) => /^(sign\\s*up|đăng\\s*ký)$/i.test((t.innerText || '').trim()));
    if (signUpTab && signUpTab.getAttribute('aria-selected') !== 'true' && signUpTab.dataset.state !== 'active') {
      let cur = findReactFiber(signUpTab);
      while (cur) {
        if (typeof cur.memoizedProps?.onValueChange === 'function') {
          cur.memoizedProps.onValueChange('SignUp');
          break;
        }
        cur = cur.return;
      }
      signUpTab.click();
      return { stage: 'switched_to_signup_tab' };
    }
    // Fill Email, Birthday, Username, Password inputs inside the form
    const form = dialog.querySelector('form');
    if (!form) return { stage: 'waiting_form' };

    const formFiber = findReactFiber(form);
    if (formFiber) {
      const queue = [formFiber];
      const visited = new Set();
      while (queue.length > 0) {
        const node = queue.shift();
        if (!node || visited.has(node)) continue;
        visited.add(node);
        const props = node.memoizedProps;
        if (props && typeof props === 'object' && typeof props.onChange === 'function') {
          if (typeof props.onBlur === 'function' && 'errorMessage' in props) {
            if (props.value !== cfg.email) {
              props.onChange(cfg.email);
            } else if (!form.dataset.goshEmailBlurred) {
              form.dataset.goshEmailBlurred = '1';
              props.onBlur();
            }
          } else if (!('errorMessage' in props) && !('validateStrength' in props) && typeof props.value === 'string' && props.value !== cfg.birthday && /^(\\d{4}-\\d{2}-\\d{2}|)$/.test(props.value)) {
            props.onChange(cfg.birthday);
          }
        }
        if (node.child) queue.push(node.child);
        if (node.sibling && node !== formFiber) queue.push(node.sibling);
      }
    }

    const emailInput = form.querySelector('input[name="email"], input[type="email"]');
    const passInput = form.querySelector('input[name="password"], input[type="password"]');
    const textInputs = Array.from(form.querySelectorAll('input')).filter((i) => i !== emailInput && i !== passInput && i.type !== 'hidden');
    const nickInput = textInputs[0] || null;

    let changed = false;
    if (emailInput && emailInput.value !== cfg.email) {
      setNativeValue(emailInput, cfg.email);
      form.dataset.goshEmailBlurred = '';
      changed = true;
    }
    if (nickInput && nickInput.value !== cfg.nickname) {
      setNativeValue(nickInput, cfg.nickname);
      changed = true;
    }
    if (passInput && passInput.value !== cfg.password) {
      setNativeValue(passInput, cfg.password);
      changed = true;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    if (!changed && submitBtn && !submitBtn.disabled && !form.dataset.goshSubmitted) {
      form.dataset.goshSubmitted = '1';
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else submitBtn.click();
      return { stage: 'form_submitted' };
    }

    return {
      stage: changed ? 'form_filling' : 'form_ready',
      emailFilled: emailInput?.value === cfg.email,
      nickFilled: nickInput?.value === cfg.nickname,
      passFilled: passInput?.value === cfg.password,
      submitDisabled: Boolean(submitBtn?.disabled),
      lastApi: window.__goshLastApi || {},
    };
  })()`;
}

/**
 * Interactive / Semi-automated Gosh registration flow using:
 * 1. A Chrome window logged into Gmail (`OtpMailBrowser`)
 * 2. A Chrome window for the new Gosh account
 */
export async function runGoshOtpRegistration({
  dataDirectory = resolve("data"),
  mode = "dot",
  baseEmail = "",
  accountName = "",
  proxy = "",
  prefetched = null,
  prefetchNext = false,
} = {}) {
  const startedAt = Date.now();
  const mailProfileDir = join(dataDirectory, "otp-mail-profile");
  const stateFilePath = join(dataDirectory, "otp-reg-state.json");
  const mailBrowser = new OtpMailBrowser({ profileDirectory: mailProfileDir });

  const mailState = await mailBrowser.waitForMailLogin();
  const detectedBaseEmail = (baseEmail || mailState.email || "").trim().toLowerCase();
  if (!detectedBaseEmail.includes("@")) {
    throw new Error("Không nhận diện được địa chỉ email từ tab hộp thư.");
  }

  let regState = { lastIndex: 0, usedEmails: [], registeredAccounts: [] };
  try {
    regState = JSON.parse(await readFile(stateFilePath, "utf8"));
  } catch {}
  const usedSet = new Set((regState.usedEmails || []).map((e) => String(e).toLowerCase()));
  await mailBrowser.markBaseline();

  let variantIndex = (Number(regState.lastIndex) || 0) + 1;
  let variantEmail = "";
  let turnstileInfo = null;

  if (prefetched?.email && prefetched?.turnstileInfo?.turnstileToken && !usedSet.has(prefetched.email.toLowerCase())) {
    variantEmail = prefetched.email;
    variantIndex = prefetched.index;
    turnstileInfo = prefetched.turnstileInfo;
  } else if (/@yahoo\./i.test(detectedBaseEmail)) {
    while (usedSet.has(`nttafibase-gosh${variantIndex}@yahoo.com`)) {
      variantIndex += 1;
    }
    console.log(`⚡ [1/3] Tạo địa chỉ phụ Yahoo #${variantIndex} & giải Turnstile song song...`);
    const [deaInfo, solved] = await Promise.all([
      mailBrowser.ensureYahooDisposableEmail({ index: variantIndex, tagPrefix: "gosh" }),
      mailBrowser.solveTurnstileAndSmBoxId({ proxy }),
    ]);
    if (!deaInfo?.email) throw new Error("Không tạo được địa chỉ phụ Yahoo.");
    await new Promise((r) => setTimeout(r, 1500));
    variantEmail = deaInfo.email;
    turnstileInfo = solved;
  } else {
    console.log("⚡ [1/3] Tìm biến thể email & giải Turnstile song song...");
    const [found, solved] = await Promise.all([
      findNextRegistrableEmail(detectedBaseEmail, {
        mode,
        startIndex: variantIndex,
        usedEmails: usedSet,
        allowCanonicalFallback: true,
      }),
      mailBrowser.solveTurnstileAndSmBoxId({ proxy }),
    ]);
    variantEmail = found.email;
    variantIndex = found.index;
    turnstileInfo = solved;
  }

  if (!turnstileInfo?.turnstileToken) {
    throw new Error("Không lấy được Turnstile token từ tab nhẹ.");
  }

  regState.lastIndex = variantIndex;
  regState.usedEmails = [...new Set([...(regState.usedEmails || []), variantEmail.toLowerCase()])];
  await writeFile(stateFilePath, `${JSON.stringify(regState, null, 2)}\n`, "utf8");

  const usedNicks = new Set((regState.registeredAccounts || []).map((a) => String(a?.nickname || "").toLowerCase()));
  let profile = generateGoshRegistrationProfile();
  for (let attempt = 0; attempt < 25 && usedNicks.has(profile.nickname.toLowerCase()); attempt++) {
    profile = generateGoshRegistrationProfile();
  }
  if (usedNicks.has(profile.nickname.toLowerCase())) {
    profile.nickname = `${profile.nickname.slice(0, 15)}${Math.floor(100 + Math.random() * 899)}`;
  }
  const did = randomUUID().replace(/-/g, "");
  console.log(`⚡ [2/3] Gửi OTP -> ${variantEmail} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)${proxy ? ` [qua proxy]` : ""}...`);
  await goshApiRequest("/gosh_base/app/sms/new_send_code", {
    method: "POST",
    did,
    proxy,
    body: {
      account_type: 1,
      account: variantEmail,
      sms_type: 2,
      turnstile_token: turnstileInfo.turnstileToken,
      sm_box_id: turnstileInfo.smBoxId || "",
    },
  });

  let nextPrefetchPromise = null;
  if (prefetchNext && /@yahoo\./i.test(detectedBaseEmail)) {
    const nextIdx = variantIndex + 1;
    nextPrefetchPromise = Promise.all([
      mailBrowser.ensureYahooDisposableEmail({
        index: nextIdx,
        tagPrefix: "gosh",
        preserveEmail: variantEmail,
      }),
      mailBrowser.solveTurnstileAndSmBoxId({ proxy }),
    ]).then(([deaInfo, solved]) => (deaInfo?.email && solved?.turnstileToken ? {
      email: deaInfo.email,
      index: nextIdx,
      turnstileInfo: solved,
    } : null)).catch(() => null);
  }

  const { otp } = await mailBrowser.waitForNewGoshOtp({
    timeoutMs: 28_000,
    targetEmail: variantEmail,
  });
  console.log(`   🎉 Bắt OTP: ${otp} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);

  const loginData = await goshApiRequest("/gosh_base/app/user/login", {
    method: "POST",
    did,
    proxy,
    body: {
      account_type: 9,
      account_id: variantEmail,
      password: profile.password,
      sms_code: otp,
      nickname: profile.nickname,
      birthday: profile.birthdayUnix,
      sm_box_id: turnstileInfo.smBoxId || "",
      is_use_password: false,
    },
  });

  if (!loginData?.token || !loginData?.user?.id) {
    throw new Error("Gosh không trả về token sau khi xác thực OTP.");
  }

  const store = new JsonStore(dataDirectory);
  await store.init();
  let vaultLabel = accountName || profile.nickname;
  let newAccount;
  try {
    newAccount = await store.addAccount(vaultLabel, "gosh");
  } catch {
    vaultLabel = `${profile.nickname.slice(0, 15)}${Math.floor(100 + Math.random() * 899)}`;
    newAccount = await store.addAccount(vaultLabel, "gosh");
  }
  await store.updateAccountProfileName(newAccount.id, profile.nickname);
  const vault = new TokenVault(join(dataDirectory, "account-tokens.json"));
  await vault.init();
  await vault.set(newAccount.id, {
    platform: "gosh",
    credentials: {
      token: String(loginData.token),
      uid: String(loginData.user.id),
      did: String(loginData.user.login_did || did),
      timUserSig: String(loginData.tim_user_sig || ""),
      ctry: String(loginData.user.country || "VN"),
    },
    source: "otp_reg_fast",
  });

  regState.registeredAccounts = [
    ...(regState.registeredAccounts || []),
    {
      accountId: newAccount.id,
      email: variantEmail,
      nickname: profile.nickname,
      password: profile.password,
      birthday: profile.birthday,
      uid: String(loginData.user.id),
      createdAt: new Date().toISOString(),
    },
  ];
  await writeFile(stateFilePath, `${JSON.stringify(regState, null, 2)}\n`, "utf8");

  const nextPrefetched = nextPrefetchPromise ? await nextPrefetchPromise : null;
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`✅ HOÀN TẤT TRONG ${elapsedSec}s! UID: ${loginData.user.id} | ${variantEmail} | ${profile.nickname} | Pass: ${profile.password}`);
  return {
    accountId: newAccount.id,
    uid: String(loginData.user.id),
    email: variantEmail,
    nickname: profile.nickname,
    password: profile.password,
    elapsedSec: Number(elapsedSec),
    nextPrefetched,
  };
}
export function extractGoshTargetUid(target) {
  const raw = String(target || "").trim();
  if (!raw) return "";
  if (/^\d+$/.test(raw)) return raw;
  try {
    const normalized = /^https?:\/\//i.test(raw)
      ? raw
      : (/^(?:www\.)?(?:gosh6\.app|gosh\.com)\//i.test(raw) ? `https://${raw}` : "");
    if (normalized) {
      const parsed = new URL(normalized);
      if (!/(^|\.)(?:gosh6\.app|gosh\.com)$/i.test(parsed.hostname)) return "";
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (!segments.length) return "";
      const first = segments[0];
      if (segments.length >= 2 && /^[a-z]{2}(?:-[A-Za-z]{2,4})?$/.test(first)) {
        return /^[A-Za-z0-9_.-]{2,64}$/.test(segments[1]) ? segments[1] : "";
      }
      if (/^[a-z]{2}(?:-[A-Za-z]{2,4})?$/i.test(first)) return "";
      return /^[A-Za-z0-9_.-]{2,64}$/.test(first) ? first : "";
    }
  } catch {}
  if (!raw.includes("/") && !raw.includes(":") && /^[A-Za-z0-9_.-]{2,64}$/.test(raw)) {
    return raw;
  }
  return "";
}

export async function runGoshFollowBoost({
  dataDirectory = resolve("data"),
  target = "",
  count = 0,
  unfollow = false,
  concurrency = 12,
} = {}) {
  const rawTarget = extractGoshTargetUid(target);
  if (!rawTarget) {
    throw new Error("Vui lòng nhập URL kênh Gosh (ví dụ https://gosh.com/zaucute00) hoặc UID/ID của kênh.");
  }

  const store = new JsonStore(dataDirectory);
  await store.init();
  const vault = new TokenVault(join(dataDirectory, "account-tokens.json"));
  await vault.init();

  const enabledGosh = store.getEnabledAccounts("gosh").filter((acc) => Boolean(vault.get(acc.id)?.credentials?.token));
  if (!enabledGosh.length) {
    throw new Error("Không tìm thấy tài khoản Gosh nào đang bật và có sẵn token.");
  }
  const selected = count > 0 ? enabledGosh.slice(0, count) : enabledGosh;
  const firstCred = vault.get(selected[0].id).credentials;

  let targetUid = rawTarget;
  if (!/^\d+$/.test(targetUid)) {
    try {
      const batch = await goshApiRequest("/gosh_base/app/live/batch_get_by_anchor", {
        method: "POST",
        body: { anchor_ids: [rawTarget] },
        did: firstCred.did,
        uid: firstCred.uid,
        token: firstCred.token,
      });
      const resolved = batch?.lives?.[0]?.uid || batch?.lives?.[0]?.user?.id;
      if (resolved) targetUid = String(resolved);
    } catch {}
    if (!/^\d+$/.test(targetUid)) {
      const anchor = await goshApiRequest("/gosh_base/app/live/get_by_anchor_v1", {
        method: "GET",
        query: { anchor_id: rawTarget },
        did: firstCred.did,
        uid: firstCred.uid,
        token: firstCred.token,
      });
      const resolved = anchor?.live?.uid || anchor?.live?.user?.id;
      if (resolved) targetUid = String(resolved);
    }
  }

  const getFollowerInfo = async () => {
    try {
      const info = await goshApiRequest("/gosh_base/app/user/profile_card", {
        method: "GET",
        query: { target_uid: targetUid },
        did: firstCred.did,
        uid: firstCred.uid,
        token: firstCred.token,
      });
      return {
        nickname: String(info?.user?.nickname || info?.user?.show_id || targetUid),
        followers: Number(info?.relation_info?.follower_num ?? info?.user?.follower_num ?? 0),
      };
    } catch {
      return { nickname: targetUid, followers: null };
    }
  };

  const beforeInfo = await getFollowerInfo();
  console.log(`\n🚀 Đang ${unfollow ? "bỏ follow" : "tăng follow"} cho kênh ${beforeInfo.nickname} (UID: ${targetUid})${beforeInfo.followers != null ? ` | Hiện có: ${beforeInfo.followers} followers` : ""} với ${selected.length} tài khoản...`);

  const startedAt = Date.now();
  const path = unfollow ? "/gosh_social/app/relationship/unfollow" : "/gosh_social/app/relationship/follow";
  let successCount = 0;
  let failureCount = 0;

  for (let offset = 0; offset < selected.length; offset += concurrency) {
    const batch = selected.slice(offset, offset + concurrency);
    await Promise.all(batch.map(async (acc) => {
      const cred = vault.get(acc.id)?.credentials;
      if (!cred?.token) {
        failureCount += 1;
        return;
      }
      try {
        await goshApiRequest(path, {
          method: "POST",
          body: { target_uid: Number(targetUid) },
          did: cred.did,
          uid: cred.uid,
          token: cred.token,
          proxy: acc.proxy || "",
        });
        successCount += 1;
      } catch {
        // Fallback to direct request if account's sticky proxy session expired
        try {
          await goshApiRequest(path, {
            method: "POST",
            body: { target_uid: Number(targetUid) },
            did: cred.did,
            uid: cred.uid,
            token: cred.token,
          });
          successCount += 1;
        } catch {
          failureCount += 1;
        }
      }
    }));
  }

  const afterInfo = await getFollowerInfo();
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`✅ Hoàn tất trong ${elapsedSec}s! Thành công: ${successCount}/${selected.length} acc${failureCount ? ` (${failureCount} lỗi)` : ""}${beforeInfo.followers != null && afterInfo.followers != null ? ` | Followers: ${beforeInfo.followers} → ${afterInfo.followers}` : ""}.`);

  try {
    const historyPath = join(dataDirectory, "follow-history.json");
    let history = [];
    try {
      const parsed = JSON.parse(await readFile(historyPath, "utf8"));
      if (Array.isArray(parsed)) history = parsed;
    } catch {}
    const now = new Date();
    history.unshift({
      time: now.toLocaleTimeString("vi-VN", { hour12: false }),
      createdAt: now.toISOString(),
      unfollow,
      targetUid,
      nickname: afterInfo.nickname || beforeInfo.nickname || targetUid,
      beforeFollowers: beforeInfo.followers ?? null,
      afterFollowers: afterInfo.followers ?? null,
      successCount,
      total: selected.length,
    });
    await writeFile(historyPath, `${JSON.stringify(history.slice(0, 100), null, 2)}\n`, "utf8");
  } catch {}

  return {
    targetUid,
    nickname: afterInfo.nickname || beforeInfo.nickname,
    beforeFollowers: beforeInfo.followers,
    afterFollowers: afterInfo.followers,
    totalAccounts: selected.length,
    successCount,
    failureCount,
  };
}

async function runCli() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const command = (positional[0] || "help").toLowerCase();
  const getFlag = (name, fallback = "") => {
    const prefix = `--${name}=`;
    const found = args.find((a) => a.startsWith(prefix));
    return found ? found.slice(prefix.length) : fallback;
  };

  const dataDirectory = resolve(getFlag("data", "data"));
  const mailProfileDir = join(dataDirectory, "otp-mail-profile");

  if (command === "login-mail" || command === "mail") {
    const mailBrowser = new OtpMailBrowser({ profileDirectory: mailProfileDir });
    console.log("Đang mở Chrome hộp thư tại:", mailProfileDir);
    console.log("Hãy đăng nhập tài khoản Gmail / Yahoo / Outlook của bạn trong cửa sổ Chrome vừa mở...");
    const state = await mailBrowser.waitForMailLogin();
    console.log(`✅ Đã nhận diện đăng nhập hộp thư thành công: ${state.email}`);
    return;
  }

  if (command === "watch-otp" || command === "otp") {
    const mailBrowser = new OtpMailBrowser({ profileDirectory: mailProfileDir });
    console.log("Đang kết nối Chrome hộp thư nhận OTP...");
    const state = await mailBrowser.waitForMailLogin();
    await mailBrowser.markBaseline();
    console.log(`✅ Đang lắng nghe mã OTP Gosh mới trên hộp thư: ${state.email}`);
    while (true) {
      const result = await mailBrowser.waitForNewGoshOtp({ timeoutMs: 600_000 });
      console.log(`\n🔔 [${new Date().toLocaleTimeString()}] MÃ OTP GOSH MỚI: ${result.otp}`);
      console.log(`   Tiêu đề: ${result.entry.title}`);
    }
  }

  if (command === "follow" || command === "unfollow") {
    const target = positional[1] || getFlag("target", "") || getFlag("url", "");
    const count = Number(getFlag("count", "0")) || 0;
    await runGoshFollowBoost({
      dataDirectory,
      target,
      count,
      unfollow: command === "unfollow" || args.includes("--unfollow"),
    });
    return;
  }

  if (command === "reg" || command === "register") {
    const mode = getFlag("mode", "dot");
    const baseEmail = getFlag("email", "");
    const followTarget = getFlag("follow", "");
    const count = Math.max(1, Math.min(5000, Number(getFlag("count", "1")) || 1));
    const singleProxy = getFlag("proxy", "");
    const proxyFile = getFlag("proxy-file", "");
    const geonodeCreds = getFlag("geonode", "");
    let proxies = [];
    if (geonodeCreds) {
      const [gUser, gPass] = geonodeCreds.split(":");
      const gHost = getFlag("geonode-host", "rotating-datacenter.geonode.io");
      const gPort = getFlag("geonode-port", "10000");
      const nonce = randomBytes(3).toString("hex");
      proxies = Array.from({ length: 5000 }, (_, idx) => (
        `http://${gUser}-session-s${nonce}${String(idx + 1).padStart(4, "0")}:${gPass}@${gHost}:${gPort}`
      ));
    } else if (proxyFile) {
      const rawProxies = await readFile(resolve(proxyFile), "utf8");
      proxies = rawProxies.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    } else if (singleProxy) {
      proxies = singleProxy.split(",").map((s) => s.trim()).filter(Boolean);
    }

    let proxyIdx = 0;
    let succeeded = 0;
    let failures = 0;
    let prefetched = null;
    const batchStartedAt = Date.now();

    while (succeeded < count) {
      const currentProxy = proxies.length ? proxies[proxyIdx % proxies.length] : "";
      if (count > 1) {
        console.log(`\n>>> [${succeeded + 1}/${count}] Tổng thời gian: ${((Date.now() - batchStartedAt) / 1000).toFixed(1)}s${currentProxy ? ` | Session #${(proxyIdx % proxies.length) + 1}` : ""}`);
      }
      try {
        const res = await runGoshOtpRegistration({
          dataDirectory,
          mode,
          baseEmail,
          proxy: currentProxy,
          prefetched,
          prefetchNext: succeeded + 1 < count,
        });
        succeeded += 1;
        failures = 0;
        if (proxies.length > 1 && succeeded % 3 === 0) {
          proxyIdx += 1;
        }
        prefetched = res.nextPrefetched || null;
      } catch (err) {
        failures += 1;
        prefetched = null;
        if (proxies.length > 1) {
          proxyIdx += 1;
        }
        console.warn(`⚠️ Lượt thử gặp lỗi (${err.message}) -> Tự động xoay sang session/địa chỉ tiếp theo...`);
        if (failures >= 25) {
          throw new Error(`Dừng sau ${failures} lần lỗi liên tiếp: ${err.message}`);
        }
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    console.log(`\n🎉 ĐÃ ĐĂNG KÝ HOÀN TẤT ${succeeded}/${count} TÀI KHOẢN GOSH TRONG ${((Date.now() - batchStartedAt) / 1000).toFixed(1)}s!`);
    if (followTarget) {
      await runGoshFollowBoost({ dataDirectory, target: followTarget });
    }
    return;
  }

  console.log(`
Công cụ Nhận OTP, Đăng ký & Tăng Follow Gosh
-----------------------------------------------------------
Các lệnh:
  1. Mở Chrome đăng nhập hộp thư Gmail / Yahoo:
     npm run gosh:mail

  2. Đăng ký tài khoản Gosh tự động (có thể kèm --follow=<url_kênh>):
     npm run gosh:reg -- --count=100 --geonode=USER:PASS
     npm run gosh:reg -- --count=10 --geonode=USER:PASS --follow=https://gosh.com/vi/16427037

  3. Tăng follow (hoặc unfollow) cho một kênh Gosh bất kỳ bằng toàn bộ tài khoản đang có:
     npm run gosh:follow -- https://gosh.com/vi/16427037
     npm run gosh:follow -- 16427037 --count=50
`);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error) => {
    console.error("❌ Lỗi:", error.message);
    process.exitCode = 1;
  });
}
