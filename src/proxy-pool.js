// Kho proxy dùng chung với code-tele-v4: danh sách "proxies" trong ~/CodeTestDual/settings.json (sửa ở trang Cài đặt của code-tele).
// 18/11 người dùng: mọi chỗ cần proxy (tăng mắt web, tăng mắt Telegram, hub phụ) lấy từ kho chung này thay vì ô proxy riêng.
// Chỉ đọc file — code-tele là chủ kho. CODE_TELE_PROXY=0 quay lại ô proxy riêng của AutoLiveCmtV2.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CACHE_MS = 10000;
let cache = { at: 0, mtime: 0, file: "", list: [] };

export function sharedProxyFile() {
  return join(process.env.CODE_TELE_DATA || join(homedir(), "CodeTestDual"), "settings.json");
}

export function sharedProxyEnabled() {
  return process.env.CODE_TELE_PROXY !== "0" && existsSync(sharedProxyFile());
}

// Dòng proxy của kho chung (định dạng code-tele: host:port[:user:pass] hoặc URL), bỏ dòng trống / trùng.
export function sharedProxies() {
  if (!sharedProxyEnabled()) return [];
  const file = sharedProxyFile();
  let mtime = 0;
  try {
    mtime = statSync(file).mtimeMs;
  } catch {
    return [];
  }
  if (cache.file === file && cache.mtime === mtime && Date.now() - cache.at < CACHE_MS) return cache.list;
  let list = [];
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    const raw = Array.isArray(data?.proxies) ? data.proxies : [];
    list = [...new Set(raw.map((item) => String(item ?? "").trim()).filter(Boolean))];
  } catch {
    list = cache.file === file ? cache.list : [];
  }
  cache = { at: Date.now(), mtime, file, list };
  return list;
}

// Hiển thị trên web: bỏ mật khẩu (host:port:user:***).
export function maskProxy(line) {
  const raw = String(line || "").trim();
  const url = /^([a-z0-9]+:\/\/)?(?:([^:@/]+)(?::[^@/]*)?@)?([^:/@]+):(\d+)(?::([^:]+):(.+))?$/i.exec(raw);
  if (!url) return raw.replace(/:[^:]+$/, ":***");
  const [, scheme = "", userA, host, port, userB] = url;
  const user = userA || userB || "";
  return `${scheme}${host}:${port}${user ? `:${user}:***` : ""}`;
}

export function sharedProxySummary() {
  const list = sharedProxies();
  return { enabled: sharedProxyEnabled(), source: "code-tele-v4", count: list.length, proxies: list.map(maskProxy) };
}

// Proxy dùng cho một lượt chạy: kho chung khi bật, còn không thì danh sách người dùng nhập.
export function effectiveProxies(input) {
  return sharedProxyEnabled() ? sharedProxies().join("\n") : String(input || "");
}
