import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { Realtime } from "../src/realtime.js";
import { DraftStore } from "../src/drafts.js";

async function readEvents(url, { until, timeoutMs = 3000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const response = await fetch(url, { signal: controller.signal });
  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  try {
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let index = buffer.indexOf("\n\n");
      while (index >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf("\n\n");
        const name = /^event: (.+)$/m.exec(frame)?.[1];
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        if (name) events.push({ name, data: data ? JSON.parse(data) : null });
      }
      if (until(events)) break;
    }
  } catch (error) {
    if (error.name !== "AbortError") throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  return events;
}

test("realtime gửi ảnh chụp cho thiết bị mới và chỉ đẩy khi dữ liệu đổi", async () => {
  const realtime = new Realtime();
  let value = 1;
  let builds = 0;
  realtime.register("counter", async () => {
    builds += 1;
    return { value };
  }, { throttleMs: 10 });
  const app = express();
  app.get("/events", realtime.handler());
  const server = app.listen(0);
  const url = `http://127.0.0.1:${server.address().port}/events`;
  try {
    const first = readEvents(url, { until: (events) => events.filter((event) => event.name === "counter").length >= 2 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    realtime.invalidate("counter"); // không đổi gì: không được gửi lại
    await new Promise((resolve) => setTimeout(resolve, 50));
    value = 2;
    realtime.invalidate("counter");
    const events = await first;
    const counters = events.filter((event) => event.name === "counter").map((event) => event.data.value);
    assert.deepEqual(counters, [1, 2]);
    assert.ok(events.some((event) => event.name === "ready"));
    assert.ok(builds >= 2);
  } finally {
    realtime.close();
    server.close();
  }
});

test("bản nháp lưu theo khoá, bỏ khoá sai và ghi xuống đĩa", async () => {
  const directory = await mkdtemp(join(tmpdir(), "alc-drafts-"));
  const drafts = await new DraftStore({ dataDirectory: directory }).init();
  const first = drafts.patch({ "viewbot.url": "https://t.me/abc", "bad key!": "x", "viewbot.bots": 50 }, "client-a");
  assert.equal(first.rev, 1);
  assert.equal(first.origin, "client-a");
  assert.deepEqual(first.values, { "viewbot.url": "https://t.me/abc", "viewbot.bots": 50 });
  const same = drafts.patch({ "viewbot.url": "https://t.me/abc" }, "client-b");
  assert.equal(same.rev, 1, "giá trị không đổi thì không tăng rev");
  const removed = drafts.patch({ "viewbot.bots": null }, "client-b");
  assert.equal(removed.rev, 2);
  assert.equal("viewbot.bots" in removed.values, false);
  await drafts.flush();
  const saved = JSON.parse(await readFile(join(directory, "ui-drafts.json"), "utf8"));
  assert.equal(saved.rev, 2);
  const reloaded = await new DraftStore({ dataDirectory: directory }).init();
  assert.deepEqual(reloaded.snapshot().values, { "viewbot.url": "https://t.me/abc" });
});
