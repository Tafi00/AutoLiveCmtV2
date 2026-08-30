import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import http from "node:http";
import { startServer } from "../src/server.js";

test("startServer khởi động server Express và phản hồi /api/state", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "server-test-"));
  const port = 43999;
  const instance = await startServer({ port, dataDirectory: tempDir });

  try {
    const data = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/api/state`, (res) => {
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve(JSON.parse(body)));
      }).on("error", reject);
    });

    assert.ok(data.accounts);
    assert.equal(Array.isArray(data.accounts), true);
  } finally {
    await instance.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("DELETE /api/messages xóa toàn bộ kho bình luận", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "server-message-delete-test-"));
  const instance = await startServer({ port: 0, dataDirectory: tempDir });
  const port = instance.server.address().port;

  try {
    const addResponse = await fetch(`http://127.0.0.1:${port}/api/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Một\nHai\nBa" }),
    });
    assert.equal(addResponse.status, 201);
    assert.equal((await addResponse.json()).messages.length, 3);

    const deleteResponse = await fetch(`http://127.0.0.1:${port}/api/messages`, { method: "DELETE" });
    assert.equal(deleteResponse.status, 200);
    const deleted = await deleteResponse.json();
    assert.equal(deleted.deletedCount, 3);
    assert.deepEqual(deleted.messages, []);
    assert.equal(deleted.nextMessage, null);
  } finally {
    await instance.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("API chỉ cho tài khoản Gosh đổi tên", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "server-gosh-rename-test-"));
  const instance = await startServer({ port: 0, dataDirectory: tempDir });
  const port = instance.server.address().port;

  try {
    const addResponse = await fetch(`http://127.0.0.1:${port}/api/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Loco 1", platform: "loco" }),
    });
    assert.equal(addResponse.status, 201);
    const state = await addResponse.json();
    const account = state.accounts.find((item) => item.platform === "loco");
    assert.ok(account);

    const renameResponse = await fetch(`http://127.0.0.1:${port}/api/accounts/${account.id}/display-name`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Tên mới" }),
    });
    assert.equal(renameResponse.status, 400);
    assert.match((await renameResponse.json()).error, /chỉ áp dụng cho tài khoản Gosh/);
  } finally {
    await instance.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("gửi cùng một bình luận tới Gosh và Loco theo cách song song", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "server-parallel-platform-test-"));
  const instance = await startServer({ port: 0, dataDirectory: tempDir });
  const port = instance.server.address().port;

  try {
    await instance.store.addAccount("Loco 1", "loco");
    await instance.store.updateSettings({
      channelUrls: {
        gosh: "https://gosh.com/vi/16427037",
        loco: "https://loco.com/stream/fb32a361-b6aa-46f4-b618-029743a0978a",
      },
      delaySeconds: 0,
      displayNames: [],
      renameEveryComments: 1,
    });
    await instance.store.addMessage("Chào hai website\nMẫu thứ hai");

    const calls = [];
    let active = 0;
    let maximumActive = 0;
    instance.sessions.sendComment = async (accountId, input, platform) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      calls.push({ accountId, input, platform });
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { sentAt: new Date().toISOString(), transport: "test" };
    };
    instance.sessions.statuses = async (accounts) => accounts.map((account) => ({
      ...account,
      session: { running: true, loginState: "signed_in", readyToComment: true },
    }));

    const response = await fetch(`http://127.0.0.1:${port}/api/comments/send-next`, { method: "POST" });
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(maximumActive, 2);
    assert.equal(body.result.successCount, 2);
    assert.equal(body.result.failureCount, 0);
    assert.deepEqual(new Set(calls.map((call) => call.platform)), new Set(["gosh", "loco"]));
    assert.ok(calls.every((call) => call.input.content === "Chào hai website"));
    assert.equal(calls.find((call) => call.platform === "gosh").input.channelUrl, "https://gosh.com/vi/16427037");
    assert.equal(calls.find((call) => call.platform === "loco").input.channelUrl, "https://loco.com/stream/fb32a361-b6aa-46f4-b618-029743a0978a");

    instance.sessions.sendComment = async (_accountId, _input, platform) => {
      if (platform === "loco") throw new Error("Loco tạm lỗi");
      return { sentAt: new Date().toISOString(), transport: "test" };
    };
    const partialResponse = await fetch(`http://127.0.0.1:${port}/api/comments/send-next`, { method: "POST" });
    assert.equal(partialResponse.status, 200);
    const partialBody = await partialResponse.json();
    assert.equal(partialBody.result.successCount, 1);
    assert.equal(partialBody.result.failureCount, 1);
    assert.match(partialBody.result.results.find((result) => result.platform === "loco").error, /tạm lỗi/);
  } finally {
    await instance.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
