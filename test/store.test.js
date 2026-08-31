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
  normalizeMessages,
} from "../src/store.js";

test("chấp nhận URL HTTPS của cả hai miền Gosh", () => {
  assert.equal(normalizeGoshUrl("https://gosh6.app/15942759"), "https://gosh6.app/15942759");
  assert.equal(normalizeGoshUrl("https://gosh.com/vi/16427037"), "https://gosh.com/vi/16427037");
  assert.throws(() => normalizeGoshUrl("http://gosh6.app/15942759"));
  assert.throws(() => normalizeGoshUrl("http://gosh.com/vi/16427037"));
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
    assert.equal(state.messagesByPlatform.gosh[0].content, "Tin cũ");
    assert.equal(state.messagesByPlatform.loco[0].content, "Tin cũ");
    assert.deepEqual(state.settings.channelUrls, { gosh: "", loco: "" });
    assert.match(await readFile(join(directory, "state.json"), "utf8"), /"accounts"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("lưu đồng thời phòng live Gosh và Loco", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dual-platform-settings-"));
  try {
    const store = new JsonStore(directory);
    await store.init();
    const settings = await store.updateSettings({
      channelUrls: {
        gosh: "https://gosh.com/vi/16427037",
        loco: "https://loco.com/stream/fb32a361-b6aa-46f4-b618-029743a0978a",
      },
      delaySeconds: 0,
      displayNames: [],
      renameEveryComments: 1,
    });

    assert.equal(settings.channelUrls.gosh, "https://gosh.com/vi/16427037");
    assert.equal(settings.channelUrls.loco, "https://loco.com/stream/fb32a361-b6aa-46f4-b618-029743a0978a");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("giữ kho bình luận và con trỏ riêng cho từng nền tảng", async () => {
  const directory = await mkdtemp(join(tmpdir(), "platform-message-queues-"));
  try {
    const store = new JsonStore(directory);
    await store.init();
    await store.addMessage("Gosh một\nGosh hai", "gosh");
    await store.addMessage("Loco một\nLoco hai", "loco");

    assert.equal(store.getNextMessage("gosh").content, "Gosh một");
    assert.equal(store.getNextMessage("loco").content, "Loco một");
    await store.markSent({ platforms: ["gosh"] });
    assert.equal(store.getNextMessage("gosh").content, "Gosh hai");
    assert.equal(store.getNextMessage("loco").content, "Loco một");
    await store.clearMessages("loco");
    assert.equal(store.getMessages("gosh").length, 2);
    assert.equal(store.getMessages("loco").length, 0);

    const reloaded = new JsonStore(directory);
    await reloaded.init();
    assert.equal(reloaded.getNextMessage("gosh").content, "Gosh hai");
    assert.equal(reloaded.getNextMessage("loco"), null);
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

test("xóa toàn bộ kho bình luận và đặt lại con trỏ", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gosh-comment-assistant-"));
  try {
    const store = new JsonStore(directory);
    await store.init();
    await store.addMessage("Tin thứ nhất\nTin thứ hai\nTin thứ ba");
    await store.markSent();

    assert.equal(store.snapshot().messages.length, 3);
    assert.equal(store.snapshot().cursor, 1);
    assert.equal(await store.clearMessages(), 3);
    assert.deepEqual(store.snapshot().messages, []);
    assert.equal(store.snapshot().cursor, 0);
    assert.equal(store.getNextMessage(), null);
    assert.equal(await store.clearMessages(), 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("đổi tên đúng chu kỳ và chọn ngẫu nhiên từ danh sách", async () => {
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
    assert.equal(store.shouldRename(), false);
    assert.equal(store.getPendingDisplayName(), null);
    await store.markSent();
    assert.equal(store.shouldRename(), true);
    assert.ok(["Tên một", "Tên hai"].includes(store.getPendingDisplayName()));
    await store.markDisplayNameUpdated();
    assert.equal(store.shouldRename(), false);
    assert.equal(store.getPendingDisplayName(), null);
    await store.markSent();
    await store.markSent();
    assert.equal(store.shouldRename(), true);
    assert.ok(["Tên một", "Tên hai"].includes(store.getPendingDisplayName()));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("sau mỗi mẫu thành công thì đổi tên ngay và khóa gửi theo delay", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gosh-comment-workflow-"));
  try {
    const store = new JsonStore(directory);
    await store.init();
    await store.updateSettings({
      channelUrl: "https://gosh6.app/15942759",
      delaySeconds: 30,
      displayNames: ["Tên một", "Tên hai"],
      renameEveryComments: 1,
    });
    const first = await store.addMessage("Mẫu một");
    const second = await store.addMessage("Mẫu hai");

    assert.equal(store.getNextMessage().id, first.id);
    assert.equal(store.cooldown().ready, true);

    await store.markSent();
    assert.equal(store.getNextMessage().id, second.id);
    assert.equal(store.shouldRename(), true);
    assert.ok(["Tên một", "Tên hai"].includes(store.getPendingDisplayName()));
    assert.equal(store.cooldown().ready, false);
    assert.ok(store.cooldown().remainingSeconds > 0);

    await store.markDisplayNameUpdated();
    assert.equal(store.getPendingDisplayName(), null);
    assert.equal(store.snapshot().commentsSinceRename, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bình luận Loco không được tính vào chu kỳ đổi tên Gosh", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gosh-only-rename-cycle-"));
  try {
    const store = new JsonStore(directory);
    await store.init();
    await store.updateSettings({
      channelUrl: "",
      delaySeconds: 0,
      displayNames: ["Tên một"],
      renameEveryComments: 1,
    });

    await store.markSent({ countForRename: false });
    assert.equal(store.shouldRename(), false);
    assert.equal(store.snapshot().commentsSinceRename, 0);

    await store.markSent({ countForRename: true });
    assert.equal(store.shouldRename(), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("nhiều tài khoản gửi các bình luận khác nhau theo thứ tự hàng đợi", async () => {
  const directory = await mkdtemp(join(tmpdir(), "multi-account-cmt-"));
  try {
    const store = new JsonStore(directory);
    await store.init();
    await store.addMessage("Comment A\nComment B\nComment C\nComment D");

    const accounts = ["acc1", "acc2", "acc3"];
    const sent = [];

    for (const acc of accounts) {
      const msg = store.getNextMessage();
      sent.push({ account: acc, content: msg.content });
      await store.markSent();
    }

    assert.deepEqual(sent, [
      { account: "acc1", content: "Comment A" },
      { account: "acc2", content: "Comment B" },
      { account: "acc3", content: "Comment C" },
    ]);

    // Tiếp tục tài khoản tiếp theo sẽ lấy Comment D
    const nextMsg = store.getNextMessage();
    assert.equal(nextMsg.content, "Comment D");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
