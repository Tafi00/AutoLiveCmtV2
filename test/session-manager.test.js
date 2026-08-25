import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { accountProfileDirectory } from "../src/session-manager.js";

test("giữ nguyên thư mục session cũ cho tài khoản mặc định", () => {
  assert.equal(
    accountProfileDirectory("/tmp/gosh-data", "default"),
    join("/tmp/gosh-data", "browser-profile"),
  );
});

test("mỗi tài khoản mới có thư mục session riêng", () => {
  assert.equal(
    accountProfileDirectory("/tmp/gosh-data", "account-02"),
    join("/tmp/gosh-data", "browser-profiles", "account-02"),
  );
  assert.throws(() => accountProfileDirectory("/tmp/gosh-data", "../escape"), /không hợp lệ/);
});
