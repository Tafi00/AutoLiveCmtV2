import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodeTelePool } from "../src/telegram/codetele-pool.js";

// 18/11: AutoLiveCmtV2 mượn acc Telegram từ kho code-tele thay vì dùng bản sao phiên (cùng auth key -> Telegram vô hiệu phiên).
function setup() {
  const root = mkdtempSync(join(tmpdir(), "alc-pool-"));
  const kho = join(root, "CodeTestDual");
  mkdirSync(join(kho, "tg_pool_lease"), { recursive: true });
  writeFileSync(join(kho, "tg_pool.json"), "{}");
  writeFileSync(join(kho, "tg_pool_lease", "accounts.json"), JSON.stringify({
    accounts: [
      { id: "acc1", phone: "+1 830 394 2540", name: "Dan Thao", tag: "", status: "ok", dead: false, frozen: false, held_by: "" },
      { id: "acc2", phone: "18303942556", name: "Dồn Lý", tag: "donttttwwq", status: "ok", dead: false, frozen: false, held_by: "mac-mini" },
      { id: "acc3", phone: "18303942606", name: "Chết", tag: "", status: "chết", dead: true, frozen: false, held_by: "" },
    ],
  }));
  const busy = new Set();
  const pool = new CodeTelePool({ dataDirectory: kho, leaseDirectory: join(root, "leased"), heldPhones: () => busy });
  return { root, kho, busy, pool };
}

const grantFile = (kho) => join(kho, "tg_pool_lease", "autolive.grant.json");
const reqFile = (kho) => join(kho, "tg_pool_lease", "autolive.req.json");
const statusFile = (kho) => join(kho, "nodes", "autolive", "status.json");
const read = (path) => JSON.parse(readFileSync(path, "utf8"));

test("không có kho code-tele trên máy thì tắt (dùng bản sao cũ chỉ khi không có kho)", () => {
  const root = mkdtempSync(join(tmpdir(), "alc-pool-"));
  const pool = new CodeTelePool({ dataDirectory: join(root, "none"), leaseDirectory: join(root, "leased"), heldPhones: () => new Set() });
  assert.equal(pool.enabled, false);
});

test("xin acc: ghi yêu cầu, chờ kho giao, ghi file phiên mượn đúng api / thiết bị của kho", async () => {
  const { kho, pool } = setup();
  setTimeout(() => {
    const req = read(reqFile(kho));
    assert.deepEqual(req.phones, ["18303942540"]);
    assert.equal(req.want, 1);
    assert.equal(req.pid, process.pid);
    writeFileSync(grantFile(kho), JSON.stringify({
      accounts: { acc1: { phone: "18303942540", name: "Dan Thao", tag: "8499735012", session_str: "1AbC", api_id: 2040, api_hash: "h",
        device: { device_model: "PC 64bit", system_version: "Windows 10", app_version: "5.1.7 x64", lang_code: "vi" } } },
    }));
  }, 300);
  const ready = await pool.acquire(["18303942540"], 5000);
  assert.deepEqual(ready, ["18303942540"]);
  const file = join(pool.leaseDirectory, "18303942540", "18303942540.json");
  const acc = read(file);
  assert.equal(acc.session_str, "1AbC");
  assert.equal(acc.app_id, 2040);
  assert.equal(acc.device, "PC 64bit");
  assert.equal(acc.username, "");                       // tag toàn số = không có username
  assert.equal(acc.pool_id, "acc1");
  assert.equal(statSync(file).mode & 0o777, 0o600);      // phiên: chỉ chủ máy đọc
});

test("acc kho không giao kịp thì bỏ, không chờ mãi", async () => {
  const { kho, pool } = setup();
  writeFileSync(grantFile(kho), JSON.stringify({ accounts: {} }));
  const ready = await pool.acquire(["18303942556"], 1200);
  assert.deepEqual(ready, []);
  assert.equal(read(reqFile(kho)).want, 0);                // thôi xin acc không giao được
});

test("đang chạy: báo kho đúng acc đang mở; dừng: trả acc và xoá file phiên mượn", async () => {
  const { kho, busy, pool } = setup();
  writeFileSync(grantFile(kho), JSON.stringify({ accounts: { acc1: { phone: "18303942540", session_str: "1AbC" } } }));
  await pool.acquire(["18303942540"], 2000);
  busy.add("18303942540");
  pool.release();
  let status = read(statusFile(kho));
  assert.deepEqual(status.pool_held, ["acc1"]);
  assert.equal(status.pid, process.pid);
  busy.clear();
  // vẫn trong hạn giữ sau khi xin (worker hub chưa kịp báo chạy) -> chưa trả
  pool.release();
  assert.deepEqual(read(reqFile(kho)).phones, ["18303942540"]);
  status = read(statusFile(kho));
  assert.deepEqual(status.pool_held, []);                   // không còn mở acc nào
});

test("danh sách acc lấy từ kho chung (để hiển thị giống trang /telegram)", () => {
  const { pool } = setup();
  const rows = pool.accounts();
  assert.equal(rows.length, 3);
  assert.equal(rows.find((row) => row.id === "acc2").held_by, "mac-mini");
  assert.equal(rows.find((row) => row.id === "acc3").dead, true);
  assert.ok(existsSync(join(pool.leaseDirectory, "..")));
});
