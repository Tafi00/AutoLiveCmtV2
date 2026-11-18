import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// 18/11: proxy dùng chung kho code-tele-v4 (settings.json "proxies"), ô proxy riêng chỉ khi tắt kho chung.
async function load(dir) {
  process.env.CODE_TELE_DATA = dir;
  delete process.env.CODE_TELE_PROXY;
  return import(`../src/proxy-pool.js?case=${Math.random()}`);
}

test("đọc kho proxy chung của code-tele, bỏ dòng trống / trùng, chuyển được sang URL proxy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "alc-proxy-"));
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ proxies: ["1.2.3.4:8080:user1:pass1", "", "1.2.3.4:8080:user1:pass1", "5.6.7.8:3128"] }));
  const pool = await load(dir);
  assert.equal(pool.sharedProxyEnabled(), true);
  assert.deepEqual(pool.sharedProxies(), ["1.2.3.4:8080:user1:pass1", "5.6.7.8:3128"]);
  assert.equal(pool.effectiveProxies("9.9.9.9:1:a:b"), "1.2.3.4:8080:user1:pass1\n5.6.7.8:3128");   // bỏ ô proxy riêng
  const { parseProxyList } = await import("../src/viewbot/manager.js");
  assert.deepEqual(parseProxyList(pool.sharedProxies().join("\n")), ["http://user1:pass1@1.2.3.4:8080", "http://5.6.7.8:3128"]);
  const summary = pool.sharedProxySummary();
  assert.equal(summary.count, 2);
  assert.deepEqual(summary.proxies, ["1.2.3.4:8080:user1:***", "5.6.7.8:3128"]);       // web không thấy mật khẩu
  assert.ok(!JSON.stringify(summary).includes("pass1"));
});

test("không có kho code-tele (hoặc CODE_TELE_PROXY=0): dùng ô proxy riêng như cũ", async () => {
  const dir = mkdtempSync(join(tmpdir(), "alc-proxy-"));
  const pool = await load(join(dir, "none"));
  assert.equal(pool.sharedProxyEnabled(), false);
  assert.equal(pool.effectiveProxies("9.9.9.9:1:a:b"), "9.9.9.9:1:a:b");
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ proxies: ["1.2.3.4:8080"] }));
  process.env.CODE_TELE_DATA = dir;
  process.env.CODE_TELE_PROXY = "0";
  assert.equal(pool.effectiveProxies("9.9.9.9:1:a:b"), "9.9.9.9:1:a:b");
  delete process.env.CODE_TELE_PROXY;
});

test("che mật khẩu cả dạng URL", async () => {
  const pool = await load(mkdtempSync(join(tmpdir(), "alc-proxy-")));
  assert.equal(pool.maskProxy("socks5://u:secret@10.0.0.1:1080"), "socks5://10.0.0.1:1080:u:***");
  assert.equal(pool.maskProxy("http://10.0.0.1:3128"), "http://10.0.0.1:3128");
});
