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

test("từ chối tên hiển thị trống trước khi mở trình duyệt", async () => {
  const browser = new BrowserSession({ profileDirectory: "/tmp/unused-gosh-profile" });
  await assert.rejects(browser.updateDisplayName("   "), /không được để trống/);
});

test("từ chối tên hiển thị dài hơn giới hạn của website", async () => {
  const goshBrowser = new BrowserSession({ profileDirectory: "/tmp/unused-gosh-profile", platform: "gosh" });
  await assert.rejects(goshBrowser.updateDisplayName("a".repeat(21)), /không được vượt quá 20 ký tự/);
});

test("không cho phiên Loco dùng chức năng đổi tên", async () => {
  const locoBrowser = new BrowserSession({ profileDirectory: "/tmp/unused-loco-profile", platform: "loco" });
  await assert.rejects(locoBrowser.updateDisplayName("Tên mới"), /chỉ áp dụng cho tài khoản Gosh/);
});

test("một browser session giữ tab riêng và gửi song song tới nhiều phòng", async () => {
  let active = 0;
  let maximumActive = 0;
  const pages = [];
  const createLocator = () => ({
    first() { return this; },
    async isVisible() { return false; },
    async waitFor() {},
    async fill() {},
  });
  const createPage = (name) => {
    let currentUrl = "about:blank";
    const page = {
      name,
      isClosed: () => false,
      url: () => currentUrl,
      once: () => {},
      getByRole: () => createLocator(),
      locator: () => createLocator(),
      goto: async (url) => { currentUrl = url; },
      waitForTimeout: async () => {},
      evaluate: async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return {
          status: "sent",
          sentAt: Date.now(),
          provider: name,
          providerMessageId: name,
        };
      },
    };
    pages.push(page);
    return page;
  };

  const browser = new BrowserSession({ profileDirectory: "/tmp/unused-multi-room-profile", platform: "gosh" });
  browser.commentPage = createPage("room-1");
  browser.context = {
    pages: () => pages,
    newPage: async () => createPage(`room-${pages.length + 1}`),
  };

  const urls = ["https://gosh.com/vi/16427037", "https://gosh6.app/15942759"];
  const results = await Promise.all(urls.map((channelUrl) => browser.sendComment({
    channelUrl,
    content: "Cùng một mẫu",
  })));

  assert.equal(maximumActive, 2);
  assert.equal(pages.length, 2);
  assert.equal(browser.roomPages.size, 2);
  assert.deepEqual(new Set(pages.map((page) => page.url())), new Set(urls));
  assert.deepEqual(results.map((result) => result.transport), ["websocket", "websocket"]);
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

function createLifecycleSession() {
  const browser = new BrowserSession({ profileDirectory: "/tmp/unused-lifecycle" });
  const pages = [];
  const locator = {
    first() { return this; },
    async isVisible() { return false; },
    async waitFor() {},
    async fill() {},
  };
  const newPage = () => {
    let url = "about:blank";
    let closed = false;
    let onClose;
    const page = {
      reloads: 0,
      sends: 0,
      isClosed: () => closed,
      url: () => url,
      once: (_, callback) => { onClose = callback; },
      async goto(value) { url = value; },
      async reload() { this.reloads++; },
      async close() { closed = true; onClose?.(); },
      getByRole: () => locator,
      locator: () => locator,
      async evaluate() { this.sends++; return { status: "sent" }; },
    };
    pages.push(page);
    return page;
  };
  browser.context = { pages: () => pages.filter((page) => !page.isClosed()), newPage: async () => newPage() };
  browser.commentPage = newPage();
  return { browser, pages };
}

test("old live pages reload only between sends and keep their room", async () => {
  const { ROOM_PAGE_MAX_AGE_MS } = await import("../src/browser-session.js");
  const { browser, pages } = createLifecycleSession();
  const input = { channelUrl: "https://gosh.com/vi/16427037", content: "test" };
  await browser.sendComment(input);
  const timing = [...browser.roomPageTimes.values()][0];
  timing.createdAt = Date.now() - ROOM_PAGE_MAX_AGE_MS;
  await Promise.all([browser.sendComment(input), browser.sendComment(input)]);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].reloads, 1);
  assert.equal(pages[0].sends, 3);
  assert.equal(pages[0].url(), input.channelUrl);
  assert.equal(browser.roomLocks.size, 0);
});

test("idle cleanup skips active sends, releases pages, and permits sending again", async () => {
  const { ROOM_PAGE_IDLE_MS } = await import("../src/browser-session.js");
  const { browser, pages } = createLifecycleSession();
  const input = { channelUrl: "https://gosh.com/vi/16427037", content: "test" };
  await browser.sendComment(input);
  const key = [...browser.roomPages.keys()][0];
  const future = Date.now() + ROOM_PAGE_IDLE_MS + 1;
  browser.roomLocks.set(key, Promise.resolve());
  await browser.pruneIdleRoomPages(future);
  assert.equal(pages[0].isClosed(), false);
  browser.roomLocks.delete(key);
  const cleanup = browser.pruneIdleRoomPages(future);
  const send = browser.sendComment(input);
  await Promise.all([cleanup, send]);
  assert.equal(pages[0].isClosed(), true);
  assert.equal(pages.length, 2);
  assert.equal(pages[1].sends, 1);
  assert.equal(browser.roomPages.size, 1);
  assert.equal(browser.roomPageTimes.size, 1);
  assert.equal(browser.roomLocks.size, 0);
  await browser.pruneIdleRoomPages(Date.now() + ROOM_PAGE_IDLE_MS + 1);
  assert.equal(browser.roomPages.size, 0);
  assert.equal(browser.roomPageTimes.size, 0);
  assert.equal(browser.commentPage, null);
});
