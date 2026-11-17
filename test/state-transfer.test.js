import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { gunzipSync } from "node:zlib";
import express from "express";
import { accountsRevision, compactJsonResponses } from "../src/state-transfer.js";

const accounts = Array.from({ length: 200 }, (_, index) => ({ id: `acc-${index}`, name: `Tài khoản ${index}`, enabled: true }));

async function withApp(run) {
  const app = express();
  app.use(compactJsonResponses());
  app.get("/state", (_request, response) => response.json({ accounts, settings: { delaySeconds: 5 } }));
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ headers: response.headers, raw: Buffer.concat(chunks) }));
    }).on("error", reject);
  });
}

test("bỏ danh sách tài khoản khi client đã có cùng revision", async () => {
  await withApp(async (base) => {
    const first = JSON.parse((await get(`${base}/state`)).raw);
    assert.equal(first.accounts.length, 200);
    assert.equal(first.accountsRev, accountsRevision(accounts));

    const second = JSON.parse((await get(`${base}/state`, { "x-accounts-rev": first.accountsRev })).raw);
    assert.equal(second.accounts, undefined);
    assert.equal(second.accountsUnchanged, true);
    assert.equal(second.settings.delaySeconds, 5);

    const stale = JSON.parse((await get(`${base}/state`, { "x-accounts-rev": "cu" })).raw);
    assert.equal(stale.accounts.length, 200);
  });
});

test("nén gzip phản hồi JSON lớn khi client hỗ trợ", async () => {
  await withApp(async (base) => {
    const plain = await get(`${base}/state`);
    assert.equal(plain.headers["content-encoding"], undefined);

    const zipped = await get(`${base}/state`, { "accept-encoding": "gzip" });
    assert.equal(zipped.headers["content-encoding"], "gzip");
    assert.ok(zipped.raw.length < plain.raw.length / 3);
    assert.deepEqual(JSON.parse(gunzipSync(zipped.raw)), JSON.parse(plain.raw));
  });
});
