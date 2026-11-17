import assert from "node:assert/strict";
import test from "node:test";
import { formatMemory, startMemoryGuard } from "../src/memory-guard.js";
import { GOSH_IM_SDK_APP_ID, loadTencentChat, releaseTencentChat } from "../src/token-transport.js";

const MB = 1024 * 1024;
const sampleOf = (footprintMb) => () => ({
  rss: 300 * MB,
  heapUsed: footprintMb * MB,
  heapTotal: footprintMb * MB,
  external: 0,
  arrayBuffers: 0,
  footprint: footprintMb * MB,
});

function guard(options) {
  const logs = [];
  const exits = [];
  const instance = startMemoryGuard({
    limitMb: 1024,
    checkEveryMs: 60_000,
    log: (line) => logs.push(line),
    onLimit: () => exits.push(Date.now()),
    ...options,
  });
  instance.stop();
  return { instance, logs, exits };
}

test("ghi log bộ nhớ ngay khi bắt đầu, kèm số liệu phụ", () => {
  const { logs } = guard({ sample: sampleOf(200), details: () => ({ sdkCopies: 3 }) });
  assert.match(logs[0], /^\[mem\] .* heapUsed=200MB .* footprint=200MB sdkCopies=3$/);
  assert.match(formatMemory(sampleOf(10)()), /rss=300MB/);
});

test("thoát khi vượt giới hạn và không có lượt gửi nào đang chạy", async () => {
  const { exits } = guard({ sample: sampleOf(1100), isBusy: () => false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(exits.length, 1);
});

test("chờ lượt gửi đang chạy, nhưng vẫn thoát khi vượt ngưỡng cứng", async () => {
  let footprint = 1100;
  const { instance, exits, logs } = guard({ sample: () => sampleOf(footprint)(), isBusy: () => true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(exits.length, 0);
  assert.ok(logs.some((line) => line.includes("chờ lượt gửi")));

  footprint = 1600;
  instance.check();
  instance.check();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(exits.length, 1);
});

test("không thoát khi không có launchd để khởi động lại (onLimit rỗng) hoặc giới hạn bằng 0", async () => {
  const noSupervisor = guard({ sample: sampleOf(5000), onLimit: null });
  const disabled = guard({ sample: sampleOf(5000), limitMb: 0 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(noSupervisor.exits.length + disabled.exits.length, 0);
});

test("releaseTencentChat đóng socket của bản SDK để bản đó được giải phóng", () => {
  const sockets = [];
  class FakeSocket {
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.closed = false;
      sockets.push(this);
    }
    send() {}
    close() { this.closed = true; }
    addEventListener() {}
    removeEventListener() {}
  }
  const TencentCloudChat = loadTencentChat(FakeSocket);
  const chat = TencentCloudChat.create({ SDKAppID: GOSH_IM_SDK_APP_ID, unlimitedAVChatRoom: true });
  chat.setLogLevel?.(4);
  assert.ok(sockets.length > 0);
  releaseTencentChat(TencentCloudChat);
  assert.ok(sockets.every((socket) => socket.closed));
  // Releasing twice is harmless.
  releaseTencentChat(TencentCloudChat);
});
