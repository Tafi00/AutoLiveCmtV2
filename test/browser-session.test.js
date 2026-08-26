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
  LOCO_API_ENDPOINTS,
  locoLoginProbeExpression,
  observeManualLoginUrls,
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

test("đổi tên Loco dùng endpoint hiện hành của bundle website", () => {
  assert.equal(LOCO_API_ENDPOINTS.profile, "https://api.loco.com/ivr/v1/profile/me/");
  assert.equal(LOCO_API_ENDPOINTS.updateProfile, "https://api.loco.com/ivr/v1/profile/update/");
  assert.equal(LOCO_API_ENDPOINTS.refreshToken, "https://api.loco.com/auth/v1/user/refresh_token/");
});

test("từ chối tên hiển thị trống trước khi mở trình duyệt", async () => {
  const browser = new BrowserSession({ profileDirectory: "/tmp/unused-gosh-profile" });
  await assert.rejects(browser.updateDisplayName("   "), /không được để trống/);
});

test("từ chối tên hiển thị dài hơn giới hạn của website", async () => {
  const goshBrowser = new BrowserSession({ profileDirectory: "/tmp/unused-gosh-profile", platform: "gosh" });
  await assert.rejects(goshBrowser.updateDisplayName("a".repeat(21)), /không được vượt quá 20 ký tự/);

  const locoBrowser = new BrowserSession({ profileDirectory: "/tmp/unused-loco-profile", platform: "loco" });
  await assert.rejects(locoBrowser.updateDisplayName("a".repeat(31)), /không được vượt quá 30 ký tự/);
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
