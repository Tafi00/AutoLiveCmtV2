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
