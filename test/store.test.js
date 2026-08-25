import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  JsonStore,
  normalizeDelay,
  normalizeDisplayNames,
  normalizeGoshUrl,
  normalizeChannelUrl,
  normalizeAccountName,
  normalizeRenameEveryComments,
} from "../src/store.js";

test("chỉ chấp nhận URL HTTPS của gosh6.app", () => {
  assert.equal(normalizeGoshUrl("https://gosh6.app/15942759"), "https://gosh6.app/15942759");
  assert.throws(() => normalizeGoshUrl("http://gosh6.app/15942759"));
  assert.throws(() => normalizeGoshUrl("https://example.com/15942759"));
});

test("chấp nhận phòng live Gosh và Loco, từ chối URL ngoài hệ thống", () => {
  assert.equal(normalizeChannelUrl("https://loco.com/stream/fb32a361-b6aa-46f4-b618-029743a0978a"), "https://loco.com/stream/fb32a361-b6aa-46f4-b618-029743a0978a");
  assert.equal(normalizeChannelUrl("https://loco.com/streamers/Supreme.Heart109"), "https://loco.com/streamers/Supreme.Heart109");
  assert.throws(() => normalizeChannelUrl("https://loco.com/browse"), /chưa phải phòng live/);
  assert.throws(() => normalizeChannelUrl("https://example.com/live"));
});

test("chấp nhận mọi thời gian chờ nguyên không âm", () => {
  assert.equal(normalizeDelay(0), 0);
  assert.equal(normalizeDelay("30"), 30);
  assert.equal(normalizeDelay(86_400), 86_400);
  assert.throws(() => normalizeDelay(-1));
  assert.throws(() => normalizeDelay(12.5));
});

test("chuẩn hóa danh sách tên và chu kỳ đổi tên", () => {
  assert.deepEqual(normalizeDisplayNames(" An\nBình\nAn\n\n"), ["An", "Bình"]);
  assert.equal(normalizeRenameEveryComments("3"), 3);
  assert.throws(() => normalizeDisplayNames("a".repeat(21)));
  assert.throws(() => normalizeRenameEveryComments(0));
});

test("chuẩn hóa tên tài khoản", () => {
  assert.equal(normalizeAccountName("  Shop chính  "), "Shop chính");
  assert.throws(() => normalizeAccountName("   "));
  assert.throws(() => normalizeAccountName("a".repeat(41)));
});

test("tự chuyển dữ liệu một tài khoản cũ thành tài khoản mặc định", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gosh-comment-assistant-"));
  try {
    await writeFile(join(directory, "state.json"), JSON.stringify({
      messages: [{ id: "legacy-message", content: "Tin cũ", createdAt: "2026-01-01T00:00:00.000Z" }],
      cursor: 0,
      settings: { channelUrl: "", delaySeconds: 30 },
      lastSentAt: null,
    }));
    const store = new JsonStore(directory);
    const state = await store.init();

    assert.equal(state.accounts.length, 1);
    assert.equal(state.accounts[0].id, "default");
    assert.equal(state.accounts[0].name, "Tài khoản 1");
    assert.equal(state.accounts[0].profileName, "");
    assert.equal(state.accounts[0].platform, "gosh");
    assert.equal(state.messages[0].content, "Tin cũ");
    assert.match(await readFile(join(directory, "state.json"), "utf8"), /"accounts"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("thêm, đổi tên, bật tắt và xóa tài khoản", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gosh-comment-assistant-"));
  try {
    const store = new JsonStore(directory);
    await store.init();
    const second = await store.addAccount("Shop phụ", "loco");
    assert.equal(store.snapshot().accounts.length, 2);
    await assert.rejects(store.addAccount("shop PHỤ", "loco"), /đã tồn tại/);
    const third = await store.addAccount("Shop phụ", "gosh");

    await store.updateAccount(second.id, { name: "Shop 02", enabled: false });
    assert.equal(store.getAccount(second.id).name, "Shop 02");
    assert.equal(store.getEnabledAccounts("loco").length, 0);
    await store.updateAccountProfileName(second.id, "Tên từ hồ sơ");
    assert.equal(store.getAccount(second.id).profileName, "Tên từ hồ sơ");
    await store.updateAccount("default", { enabled: false });
    await assert.rejects(store.updateAccount(third.id, { enabled: false }), /ít nhất một/);

    await store.deleteAccount("default");
    assert.equal(store.snapshot().accounts.length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("kho tin nhắn quay vòng sau mỗi lần gửi", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gosh-comment-assistant-"));
  try {
    const store = new JsonStore(directory);
    await store.init();
    const first = await store.addMessage("Tin thứ nhất");
    const second = await store.addMessage("Tin thứ hai");

    assert.equal(store.getNextMessage().id, first.id);
    await store.markSent();
    assert.equal(store.getNextMessage().id, second.id);
    await store.markSent();
    assert.equal(store.getNextMessage().id, first.id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("xóa tin đứng trước con trỏ không làm bỏ qua tin kế tiếp", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gosh-comment-assistant-"));
  try {
    const store = new JsonStore(directory);
    await store.init();
    const first = await store.addMessage("Tin thứ nhất");
    const second = await store.addMessage("Tin thứ hai");
    await store.addMessage("Tin thứ ba");

    await store.markSent();
    assert.equal(store.getNextMessage().id, second.id);
    await store.deleteMessage(first.id);
    assert.equal(store.getNextMessage().id, second.id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("đổi tên đúng chu kỳ và xoay vòng danh sách", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gosh-comment-assistant-"));
  try {
    const store = new JsonStore(directory);
    await store.init();
    await store.updateSettings({
      channelUrl: "https://gosh6.app/15942759",
      delaySeconds: 0,
      displayNames: ["Tên một", "Tên hai"],
      renameEveryComments: 2,
    });

    await store.markSent();
    assert.equal(store.getPendingDisplayName(), null);
    await store.markSent();
    assert.equal(store.getPendingDisplayName(), "Tên một");
    await store.markDisplayNameUpdated();
    assert.equal(store.getPendingDisplayName(), null);
    await store.markSent();
    await store.markSent();
    assert.equal(store.getPendingDisplayName(), "Tên hai");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
