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
