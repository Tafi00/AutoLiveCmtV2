import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BrowserSession,
  CHROME_PROFILE_IGNORE_DEFAULT_ARGS,
  extractDisplayName,
  isBrowserProcessRunning,
  gaquaytvLoginProbeExpression,
  locoLoginProbeExpression,
  observeManualLoginUrls,
  shouldBlockBrowserResource,
  waitForProfileUnlock,
} from "../src/browser-session.js";

test("headless dùng cùng macOS Keychain với Chrome đăng nhập", () => {
  assert.ok(CHROME_PROFILE_IGNORE_DEFAULT_ARGS.includes("--password-store=basic"));
  assert.ok(CHROME_PROFILE_IGNORE_DEFAULT_ARGS.includes("--use-mock-keychain"));
});

test("đọc tên hiển thị từ các dạng response hồ sơ", () => {
  assert.equal(extractDisplayName({ data: { nickname: "Streamer A" } }), "Streamer A");
  assert.equal(extractDisplayName({ result: { userInfo: { displayName: "Shop B" } } }), "Shop B");
  assert.equal(extractDisplayName({ message: "success", data: {} }), "");
});

test("probe Loco nhận diện JWT và store đăng nhập hiện hành", () => {
  const expression = locoLoginProbeExpression();
  assert.match(expression, /access_token/);
  assert.match(expression, /app-store/);
  assert.match(expression, /findIdentity/);
  assert.doesNotMatch(expression, /fetch\(['"]https:\/\/api\.loco\.com/);
});

test("probe GaQuayTV đọc token từ cookie và gọi auth/me", () => {
  const expression = gaquaytvLoginProbeExpression();
  assert.match(expression, /document\.cookie/);
  assert.match(expression, /api\.gaquaytv\.com\/api\/v2\/auth\/me/);
  assert.match(expression, /Authorization/);
});

test("chờ Chrome nhả khóa profile trước khi mở tiến trình tiếp theo", async () => {
  const directory = await mkdtemp(join(tmpdir(), "live-comment-profile-"));
  const lockPath = join(directory, "SingletonLock");
  try {
    await symlink(`test-host-${process.pid}`, lockPath);
    setTimeout(() => void unlink(lockPath).catch(() => {}), 75);
    const startedAt = Date.now();
    await waitForProfileUnlock(directory, 1_000);
    assert.ok(Date.now() - startedAt >= 50);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("tự dọn SingletonLock khi PID Chrome trong lock đã chết", async () => {
  const directory = await mkdtemp(join(tmpdir(), "live-comment-stale-profile-"));
  const lockPath = join(directory, "SingletonLock");
  try {
    await symlink("test-host-99999999", lockPath);
    await waitForProfileUnlock(directory, 1_000);
    await assert.rejects(() => unlink(lockPath), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("không xem process đăng nhập rỗng là đang chạy", () => {
  assert.equal(isBrowserProcessRunning(null), false);
  assert.equal(isBrowserProcessRunning(undefined), false);
  assert.equal(isBrowserProcessRunning({ exitCode: 0 }), false);
  assert.equal(isBrowserProcessRunning({ exitCode: null }), true);
});

test("chỉ hoàn tất đăng nhập sau khi Google quay lại đúng website", () => {
  const before = observeManualLoginUrls(["https://gosh6.app/"], "https://gosh6.app", false);
  assert.deepEqual(before, { sawProvider: false, complete: false });

  const during = observeManualLoginUrls([
    "https://gosh6.app/",
    "https://accounts.google.com/v3/signin/identifier",
  ], "https://gosh6.app", false);
  assert.deepEqual(during, { sawProvider: true, complete: false });

  const after = observeManualLoginUrls(["https://gosh6.app/vi"], "https://gosh6.app", true);
  assert.deepEqual(after, { sawProvider: true, complete: true });
});

test("đọc tên hiển thị từ user id, số hoặc email khi không có nickname", () => {
  assert.equal(extractDisplayName({ data: { uid: 123456 } }), "123456");
  assert.equal(extractDisplayName({ user: { email: "streamer@gosh.app" } }), "streamer@gosh.app");
  assert.equal(extractDisplayName({ username: "LocoGamer99" }), "LocoGamer99");
});

test("observed endpoints stay bounded and retain the most recently seen entry", async () => {
  const { discoveredApiEndpoints, recordObservedEndpoint, MAX_OBSERVED_ENDPOINTS } = await import("../src/browser-session.js");
  discoveredApiEndpoints.clear();
  try {
    for (let i = 0; i < MAX_OBSERVED_ENDPOINTS; i++) {
      recordObservedEndpoint(`https://api.gosh.com/live/${i}`);
    }
    recordObservedEndpoint("https://api.gosh.com/live/0");
    recordObservedEndpoint("https://api.gosh.com/live/new");
    assert.equal(discoveredApiEndpoints.size, MAX_OBSERVED_ENDPOINTS);
    assert.ok([...discoveredApiEndpoints.values()].some((entry) => entry.path === "/live/0"));
    assert.ok(![...discoveredApiEndpoints.values()].some((entry) => entry.path === "/live/1"));
  } finally {
    discoveredApiEndpoints.clear();
  }
});

test("BrowserSession giữ proxy riêng cho cửa sổ Chrome của tài khoản", () => {
  const sessionWithProxy = new BrowserSession({
    profileDirectory: "/tmp/fake-profile",
    platform: "gaquaytv",
    proxy: "http://usr:pwd@127.0.0.1:8080",
  });
  assert.equal(sessionWithProxy.proxy, "http://usr:pwd@127.0.0.1:8080");
  assert.equal(sessionWithProxy.isRunning(), false);

  const sessionNoProxy = new BrowserSession({
    profileDirectory: "/tmp/fake-profile",
    platform: "gaquaytv",
  });
  assert.equal(sessionNoProxy.proxy, "");
});

test("chặn video và tài nguyên nền nhưng giữ API/JavaScript chat", () => {
  assert.equal(shouldBlockBrowserResource({
    resourceType: "xhr",
    url: "https://pull.gosh6.app/live/channel.m3u8?signature=redacted",
  }), true);
  assert.equal(shouldBlockBrowserResource({
    resourceType: "media",
    url: "https://example.com/video.mp4",
  }), true);
  assert.equal(shouldBlockBrowserResource({
    resourceType: "image",
    url: "https://static.goshcdn.com/_ugc/avatar/example.png",
  }), true);
  assert.equal(shouldBlockBrowserResource({
    resourceType: "script",
    url: "https://static.goshcdn.com/fe_live/gosh/prod/chat-sdk.js",
  }), false);
  assert.equal(shouldBlockBrowserResource({
    platform: "loco",
    resourceType: "script",
    url: "https://www.googletagmanager.com/gtm.js?id=redacted",
  }), true);
  assert.equal(shouldBlockBrowserResource({
    platform: "loco",
    resourceType: "fetch",
    url: "https://api.loco.com/chat/v2/streams/stream-1/chat/?send=true",
  }), false);
});

test("Gosh stream segments are blocked when the CDN hostname changes", () => {
  for (const extension of ["m3u8", "m4s", "ts", "mp4", "flv", "mpd", "aac"]) {
    assert.equal(shouldBlockBrowserResource({ platform: "gosh", resourceType: "fetch", url: `https://new-cdn.example/live/video.${extension}?token=test` }), true);
  }
  assert.equal(shouldBlockBrowserResource({ platform: "gosh", resourceType: "fetch", url: "https://api.gosh.com/live/join" }), false);
});
