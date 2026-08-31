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

test("DELETE /api/messages xóa riêng từng kho hoặc cả hai kho", async () => {
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

    const locoResponse = await fetch(`http://127.0.0.1:${port}/api/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Loco một\nLoco hai", platform: "loco" }),
    });
    assert.equal(locoResponse.status, 201);
    assert.equal((await locoResponse.json()).messagesByPlatform.loco.length, 2);

    const deleteGoshResponse = await fetch(`http://127.0.0.1:${port}/api/messages?platform=gosh`, { method: "DELETE" });
    assert.equal(deleteGoshResponse.status, 200);
    const deletedGosh = await deleteGoshResponse.json();
    assert.equal(deletedGosh.deletedCount, 3);
    assert.deepEqual(deletedGosh.messagesByPlatform.gosh, []);
    assert.equal(deletedGosh.messagesByPlatform.loco.length, 2);

    const deleteResponse = await fetch(`http://127.0.0.1:${port}/api/messages`, { method: "DELETE" });
    assert.equal(deleteResponse.status, 200);
    const deleted = await deleteResponse.json();
    assert.equal(deleted.deletedCount, 2);
    assert.deepEqual(deleted.messages, []);
    assert.deepEqual(deleted.messagesByPlatform.loco, []);
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

test("gửi hai mẫu riêng tới Gosh và Loco theo cách song song", async () => {
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
    await instance.store.addMessage("Mẫu Gosh 1\nMẫu Gosh 2", "gosh");
    await instance.store.addMessage("Mẫu Loco 1\nMẫu Loco 2", "loco");

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
    assert.equal(calls.find((call) => call.platform === "gosh").input.content, "Mẫu Gosh 1");
    assert.equal(calls.find((call) => call.platform === "loco").input.content, "Mẫu Loco 1");
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
    assert.equal(partialBody.nextMessages.gosh.content, "Mẫu Gosh 1");
    assert.equal(partialBody.nextMessages.loco.content, "Mẫu Loco 2");
    assert.equal(partialBody.result.results.find((result) => result.platform === "loco").message, "Mẫu Loco 2");
    assert.match(partialBody.result.results.find((result) => result.platform === "loco").error, /tạm lỗi/);
  } finally {
    await instance.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("không dùng URL Gosh cho tài khoản Loco khi ô Loco để trống", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "server-independent-url-test-"));
  const instance = await startServer({ port: 0, dataDirectory: tempDir });
  const port = instance.server.address().port;

  try {
    await instance.store.addAccount("Loco 1", "loco");
    await instance.store.updateSettings({
      channelUrls: {
        gosh: "https://gosh.com/vi/16427037",
        loco: "",
      },
      platform: "loco",
      delaySeconds: 0,
      displayNames: [],
      renameEveryComments: 1,
    });
    await instance.store.addMessage("Mẫu Gosh", "gosh");
    await instance.store.addMessage("Mẫu Loco", "loco");

    const calls = [];
    instance.sessions.sendComment = async (accountId, input, platform) => {
      calls.push({ accountId, input, platform });
      return { sentAt: new Date().toISOString(), transport: "test" };
    };
    instance.sessions.statuses = async (accounts) => accounts.map((account) => ({
      ...account,
      session: { running: true, loginState: "signed_in", readyToComment: true },
    }));

    const response = await fetch(`http://127.0.0.1:${port}/api/comments/send-next`, { method: "POST" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.settings.channelUrls.gosh, "https://gosh.com/vi/16427037");
    assert.equal(body.settings.channelUrls.loco, "");
    assert.equal(body.result.successCount, 1);
    assert.deepEqual(calls.map((call) => call.platform), ["gosh"]);
  } finally {
    await instance.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("Chạy tất cả xử lý hết từng kho riêng khi số mẫu khác nhau", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "server-bulk-platform-queues-test-"));
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
    await instance.store.addMessage("Gosh 1\nGosh 2\nGosh 3", "gosh");
    await instance.store.addMessage("Loco 1", "loco");
    instance.sessions.statuses = async (accounts) => accounts.map((account) => ({
      ...account,
      session: { running: true, loginState: "signed_in", readyToComment: true },
    }));

    const calls = [];
    let active = 0;
    let maximumActive = 0;
    instance.sessions.sendComment = async (accountId, input, platform) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      calls.push({ accountId, content: input.content, platform });
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { sentAt: new Date().toISOString(), transport: "test" };
    };

    const response = await fetch(`http://127.0.0.1:${port}/api/comments/send-all`, { method: "POST" });
    assert.equal(response.status, 202);
    while (instance.bulkSend.running) await new Promise((resolve) => setTimeout(resolve, 5));

    assert.equal(maximumActive, 2);
    assert.equal(instance.bulkSend.sent, 4);
    assert.equal(instance.bulkSend.failed, 0);
    assert.deepEqual(calls.filter((call) => call.platform === "gosh").map((call) => call.content), ["Gosh 1", "Gosh 2", "Gosh 3"]);
    assert.deepEqual(calls.filter((call) => call.platform === "loco").map((call) => call.content), ["Loco 1"]);
  } finally {
    await instance.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
