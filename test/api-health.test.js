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
  const targets = healthTargets("https://loco.com/stream/fb32a361-b6aa-46f4-b618-029743a0978a");
  assert.ok(targets.some((item) => item.id === "loco-chat" && item.url.includes("fb32a361")));
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
