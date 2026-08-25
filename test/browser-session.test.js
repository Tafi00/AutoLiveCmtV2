import assert from "node:assert/strict";
import test from "node:test";
import {
  BrowserSession,
  extractDisplayName,
  isBrowserProcessRunning,
  observeManualLoginUrls,
} from "../src/browser-session.js";

test("đọc tên hiển thị từ các dạng response hồ sơ", () => {
  assert.equal(extractDisplayName({ data: { nickname: "Streamer A" } }), "Streamer A");
  assert.equal(extractDisplayName({ result: { userInfo: { displayName: "Shop B" } } }), "Shop B");
  assert.equal(extractDisplayName({ message: "success", data: {} }), "");
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

