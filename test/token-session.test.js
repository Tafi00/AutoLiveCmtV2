import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TokenSession } from "../src/token-session.js";
import { TokenVault } from "../src/token-vault.js";
import { fakeFetch, FakeWebSocket } from "./fakes.js";

function jwt(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

function fakeBrowser(cookies = []) {
  return {
    identity: null,
    reads: 0,
    written: [],
    manual: false,
    isManualLoginRunning() { return this.manual; },
    isRunning() { return this.manual; },
    async readCookies() { this.reads += 1; return cookies; },
    async writeCookies(value) { this.written.push(...value); },
  };
}

async function withVault(run) {
  const directory = await mkdtemp(join(tmpdir(), "token-session-test-"));
  const vault = new TokenVault(join(directory, "account-tokens.json"));
  await vault.init();
  try {
    await run(vault, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function locoJwt(name, expiresInSeconds = 3600) {
  return jwt({ user_uid: "UID1", username: name, device_id: "dev", exp: Math.floor(Date.now() / 1000) + expiresInSeconds });
}

test("gửi bằng token đã lưu mà không mở Chrome", async () => {
  await withVault(async (vault) => {
    await vault.set("acc-1", { platform: "loco", source: "chrome", credentials: { accessToken: locoJwt("loco_user"), refreshToken: "r", deviceId: "dev" } });
    const browser = fakeBrowser();
    const { fetchImpl, calls } = fakeFetch(() => ({ body: { code: "C10" } }));
    const session = new TokenSession({ accountId: "acc-1", platform: "loco", vault, browser, deps: { fetch: fetchImpl } });
    const result = await session.sendComment({ channelUrl: "https://loco.com/stream/fb32a361-b6aa-46f4-b618-029743a0978a", content: "Chào" });
    assert.equal(result.transport, "token");
    assert.equal(browser.reads, 0);
    assert.equal(calls.length, 1);
    assert.equal(session.status().readyToComment, true);
    assert.equal(session.status().identity.displayName, "loco_user");
  });
});

test("rút token từ profile Chrome một lần rồi lưu lại", async () => {
  await withVault(async (vault, directory) => {
    const accessToken = locoJwt("from_profile");
    const browser = fakeBrowser([
      { domain: ".loco.com", name: "access_token", value: accessToken },
      { domain: ".loco.com", name: "refresh_token", value: "profile-refresh" },
    ]);
    const { fetchImpl } = fakeFetch(() => ({ body: { code: "C10" } }));
    const session = new TokenSession({ accountId: "acc-2", platform: "loco", vault, browser, deps: { fetch: fetchImpl } });
    assert.equal(session.status().readyToComment, false);
    const url = "https://loco.com/stream/fb32a361-b6aa-46f4-b618-029743a0978a";
    await Promise.all([session.sendComment({ channelUrl: url, content: "1" }), session.sendComment({ channelUrl: url, content: "2" })]);
    assert.equal(browser.reads, 1);
    const saved = JSON.parse(await readFile(join(directory, "account-tokens.json"), "utf8"));
    assert.equal(saved.accounts["acc-2"].credentials.accessToken, accessToken);
    assert.equal(saved.accounts["acc-2"].source, "chrome");
  });
});

test("báo cần đăng nhập khi profile không có token", async () => {
  await withVault(async (vault) => {
    const session = new TokenSession({ accountId: "acc-3", platform: "gaquaytv", vault, browser: fakeBrowser([]) });
    await assert.rejects(
      session.sendComment({ channelUrl: "https://gaquaytv.com/live/fc51a33f-56a9-4238-8551-5dc56dde79b1", content: "x" }),
      { code: "LOGIN_REQUIRED" },
    );
    assert.equal(session.status().loginState, "signed_out");
  });
});

test("token Loco hết hạn được làm mới rồi gửi lại đúng một lần", async () => {
  await withVault(async (vault) => {
    const oldToken = locoJwt("loco_user");
    const newToken = locoJwt("loco_user", 7200);
    await vault.set("acc-4", { platform: "loco", source: "chrome", credentials: { accessToken: oldToken, refreshToken: "old-refresh", deviceId: "dev" } });
    const { fetchImpl, calls } = fakeFetch((call) => {
      if (call.url.includes("refresh_token")) return { body: { access_token: newToken, refresh_token: "new-refresh" } };
      return call.headers.authorization === oldToken
        ? { status: 401, body: { error_code: "E005" } }
        : { body: { code: "C10" } };
    });
    const browser = fakeBrowser();
    const session = new TokenSession({ accountId: "acc-4", platform: "loco", vault, browser, deps: { fetch: fetchImpl } });
    await session.sendComment({ channelUrl: "https://loco.com/stream/fb32a361-b6aa-46f4-b618-029743a0978a", content: "x" });
    assert.deepEqual(calls.map((call) => call.url.includes("refresh_token") ? "refresh" : "chat"), ["chat", "refresh", "chat"]);
    assert.equal(JSON.parse(calls[1].body).refresh_token, "old-refresh");
    assert.equal(vault.get("acc-4").credentials.refreshToken, "new-refresh");
    assert.equal(vault.get("acc-4").source, "refresh");
    assert.equal(browser.reads, 0);

    // The rotated token is written back before a visible Chrome window opens.
    await session.syncToProfile();
    assert.ok(browser.written.some((cookie) => cookie.name === "refresh_token" && cookie.value === "new-refresh"));
    assert.equal(vault.get("acc-4").source, "chrome");
  });
});

test("gửi Gosh qua Tencent IM với payload của website", async () => {
  await withVault(async (vault) => {
    await vault.set("acc-5", {
      platform: "gosh",
      source: "chrome",
      credentials: { token: "gosh-token", uid: "123", did: "dev", ctry: "vn", timUserSig: "sig" },
    });
    const { fetchImpl, calls } = fakeFetch((call) => {
      if (call.url.includes("batch_get_by_anchor")) return { body: { code: 0, data: { lives: [{ id: "live-9", im_room: "@AVC#16427037" }] } } };
      if (call.url.includes("user_info")) return { body: { code: 0, data: { user: { id: 123, nickname: "Gosh User", tim_user_sig: "sig", ip: "x" } } } };
      return { status: 404, body: {} };
    });
    const im = { logins: [], joins: [], sent: [] };
    const createTencentChat = () => ({
      EVENT: { SDK_READY: "ready", KICKED_OUT: "kicked" },
      TYPES: { CONV_GROUP: "GROUP" },
      create() {
        const listeners = {};
        return {
          setLogLevel() {},
          on(event, listener) { listeners[event] = listener; },
          off() {},
          isReady: () => true,
          async login(options) { im.logins.push(options); listeners.ready?.(); },
          async joinGroup(options) { im.joins.push(options.groupID); },
          createCustomMessage(options) { return options; },
          async sendMessage(message) { im.sent.push(message); return { data: { message: { ID: "tim-1" } } }; },
          async logout() {},
          async destroy() {},
        };
      },
    });
    const session = new TokenSession({ accountId: "acc-5", platform: "gosh", vault, browser: fakeBrowser(), deps: { fetch: fetchImpl, createTencentChat } });
    const url = "https://gosh.com/vi/16427037";
    const result = await session.sendComment({ channelUrl: url, content: "Xin chào" });
    await session.sendComment({ channelUrl: url, content: "Lần hai" });
    assert.equal(result.providerMessageId, "tim-1");
    assert.deepEqual(im.logins, [{ userID: "123", userSig: "sig" }]);
    assert.deepEqual(im.joins, ["@AVC#16427037"]);
    assert.equal(im.sent[0].to, "@AVC#16427037");
    assert.equal(im.sent[0].conversationType, "GROUP");
    const payload = JSON.parse(im.sent[0].payload.data);
    assert.equal(payload.live_id, "live-9");
    assert.equal(payload.user.nickname, "Gosh User");
    assert.equal(payload.user.tim_user_sig, undefined);
    assert.equal(calls.filter((call) => call.url.includes("user_info")).length, 1);
    assert.match(calls.find((call) => call.url.includes("user_info")).headers.cookie, /token=gosh-token/);
    await session.close();
  });
});

test("kiểm tra tên hiển thị trước khi gọi API đổi tên", async () => {
  await withVault(async (vault) => {
    const gosh = new TokenSession({ accountId: "a", platform: "gosh", vault, browser: fakeBrowser() });
    await assert.rejects(gosh.updateDisplayName("   "), /không được để trống/);
    await assert.rejects(gosh.updateDisplayName("a".repeat(21)), /không được vượt quá 20 ký tự/);
    const loco = new TokenSession({ accountId: "b", platform: "loco", vault, browser: fakeBrowser() });
    await assert.rejects(loco.updateDisplayName("Tên mới"), /chỉ áp dụng cho tài khoản Gosh và GaQuayTV/);
  });
});

test("đổi tên GaQuayTV qua API rồi dùng tên mới khi gửi", async () => {
  await withVault(async (vault) => {
    await vault.set("gq", { platform: "gaquaytv", source: "chrome", credentials: { accessToken: jwt({ exp: Math.floor(Date.now() / 1000) + 3600 }), refreshToken: "r" } });
    const { fetchImpl, calls } = fakeFetch((call) => {
      if (call.url.endsWith("/auth/me")) return { body: { data: { display_name: "Cũ", username: "gq_user", avatar: "a.png", social_links: [] } } };
      if (call.url.endsWith("/auth/update-profile")) return { body: { data: {} } };
      return { status: 404, body: {} };
    });
    const session = new TokenSession({ accountId: "gq", platform: "gaquaytv", vault, browser: fakeBrowser(), deps: { fetch: fetchImpl } });
    const result = await session.updateDisplayName("Tên Mới");
    assert.equal(result.displayName, "Tên Mới");
    const update = calls.find((call) => call.url.endsWith("/auth/update-profile"));
    assert.equal(update.method, "PATCH");
    assert.equal(JSON.parse(update.body).display_name, "Tên Mới");
    assert.match(update.headers.authorization, /^Bearer /);
    assert.equal(session.status().identity.displayName, "Tên Mới");
  });
});

test("làm nóng kết nối GaQuayTV trước rồi gửi trên cùng socket", async () => {
  await withVault(async (vault) => {
    const roomId = "fc51a33f-56a9-4238-8551-5dc56dde79b1";
    await vault.set("gq", { platform: "gaquaytv", source: "chrome", credentials: { accessToken: jwt({ exp: Math.floor(Date.now() / 1000) + 3600 }), refreshToken: "r" } });
    const { fetchImpl } = fakeFetch(() => ({ body: { data: { display_name: "GQ", username: "gq_user", avatar: "" } } }));
    FakeWebSocket.instances = [];
    const session = new TokenSession({ accountId: "gq", platform: "gaquaytv", vault, browser: fakeBrowser(), deps: { fetch: fetchImpl, WebSocket: FakeWebSocket } });
    await session.prepare({ channelUrl: `https://gaquaytv.com/live/${roomId}` });
    const ws = FakeWebSocket.instances[0];
    assert.ok(ws.sent.some((packet) => packet.includes("join_room")));
    ws.onEmit = (event, payload) => {
      if (event === "send_message") queueMicrotask(() => ws.receive(`42${JSON.stringify(["onReceiveMessage", { msgs: [{ username: "gq_user", content: payload.data.msgs[0].content }] }])}`));
    };
    const result = await session.sendComment({ channelUrl: `https://gaquaytv.com/live/${roomId}`, content: "Chào" });
    assert.equal(result.confirmed, true);
    assert.equal(FakeWebSocket.instances.length, 1);
    assert.equal(ws.sent.filter((packet) => packet.includes("join_room")).length, 1);
    await session.close();
  });
});

test("không làm nóng tài khoản chưa có token để khỏi mở Chrome nền", async () => {
  await withVault(async (vault) => {
    const browser = fakeBrowser([]);
    const session = new TokenSession({ accountId: "none", platform: "loco", vault, browser });
    await session.prepare({ channelUrl: "https://loco.com/stream/fb32a361-b6aa-46f4-b618-029743a0978a" });
    assert.equal(browser.reads, 0);
  });
});
