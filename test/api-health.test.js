import assert from "node:assert/strict";
import test from "node:test";
import { checkTarget, classifyHttpStatus, healthTargets } from "../src/api-health.js";

test("phân loại trạng thái endpoint", () => {
  assert.equal(classifyHttpStatus(200), "up");
  assert.equal(classifyHttpStatus(401), "up");
  assert.equal(classifyHttpStatus(429), "degraded");
  assert.equal(classifyHttpStatus(500), "down");
});

test("thêm endpoint chat khi URL Loco có stream id", () => {
  const targets = healthTargets({
    gosh: "https://gosh.com/vi/16427037",
    loco: "https://loco.com/stream/fb32a361-b6aa-46f4-b618-029743a0978a",
  });
  assert.ok(targets.some((item) => item.id === "loco-chat" && item.url.includes("fb32a361")));
  assert.equal(targets.some((item) => item.id === "loco-profile-update"), false);
});

test("kiểm tra endpoint chat cho từng phòng Loco đã cấu hình", () => {
  const targets = healthTargets({
    gosh: [],
    loco: [
      "https://loco.com/stream/fb32a361-b6aa-46f4-b618-029743a0978a",
      "https://loco.com/stream/aa32a361-b6aa-46f4-b618-029743a0978b",
    ],
  }).filter((item) => item.id.startsWith("loco-chat"));
  assert.equal(targets.length, 2);
  assert.ok(targets[0].url.includes("fb32a361"));
  assert.ok(targets[1].url.includes("aa32a361"));
});

test("đo endpoint bằng fetch có thể thay thế trong test", async () => {
  const result = await checkTarget(
    { id: "test", platform: "gosh", name: "Test", url: "https://example.test/" },
    { fetchImpl: async () => ({ status: 204 }) },
  );
  assert.equal(result.status, "up");
  assert.equal(result.httpStatus, 204);
  assert.ok(Number.isInteger(result.latencyMs));
});
