import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  activeScheduleOccurrence,
  nextScheduleOccurrence,
  normalizeSchedule,
  normalizeScheduleSlot,
  normalizeScheduleTime,
} from "../src/schedule.js";
import { JsonStore } from "../src/store.js";
import { startServer } from "../src/server.js";

// 2026-10-26 is a Monday (getDay() === 1).
const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute);
const slot = (fields) => normalizeScheduleSlot({ days: [0, 1, 2, 3, 4, 5, 6], ...fields });

test("chuẩn hóa giờ HH:MM và từ chối giờ sai", () => {
  assert.equal(normalizeScheduleTime("9:05"), "09:05");
  assert.equal(normalizeScheduleTime("21:30"), "21:30");
  assert.throws(() => normalizeScheduleTime("24:00"), /HH:MM/);
  assert.throws(() => normalizeScheduleTime("12:60"), /HH:MM/);
  assert.throws(() => normalizeScheduleTime(""), /HH:MM/);
});

test("khung giờ cần ngày hợp lệ và giờ kết thúc khác giờ bắt đầu", () => {
  assert.throws(() => normalizeScheduleSlot({ start: "19:00", end: "19:00", days: [1] }), /khác giờ bắt đầu/);
  assert.throws(() => normalizeScheduleSlot({ start: "19:00", end: "20:00", days: [] }), /ít nhất một ngày/);
  const created = normalizeScheduleSlot({ start: "19:00", end: "20:00", days: [5, 1, 1, 9] });
  assert.deepEqual(created.days, [1, 5]);
  assert.equal(created.enabled, true);
});

test("normalizeSchedule bỏ khung lỗi nhưng giữ khung hợp lệ", () => {
  const schedule = normalizeSchedule({
    enabled: true,
    slots: [
      { id: "ok", start: "19:00", end: "21:00", days: [1] },
      { id: "bad", start: "25:00", end: "21:00", days: [1] },
      null,
    ],
  });
  assert.equal(schedule.enabled, true);
  assert.deepEqual(schedule.slots.map((item) => item.id), ["ok"]);
  assert.deepEqual(normalizeSchedule(undefined), { enabled: false, slots: [] });
});

test("activeScheduleOccurrence chỉ bật trong khung giờ và đúng ngày", () => {
  const weekdays = slot({ start: "19:30", end: "21:30", days: [1, 2, 3, 4, 5] });
  assert.equal(activeScheduleOccurrence([weekdays], at(26, 19, 29)), null);
  const active = activeScheduleOccurrence([weekdays], at(26, 19, 30));
  assert.equal(active.slotId, weekdays.id);
  assert.deepEqual(active.endAt, at(26, 21, 30));
  assert.equal(activeScheduleOccurrence([weekdays], at(26, 21, 30)), null);
  // 2026-10-25 is a Sunday.
  assert.equal(activeScheduleOccurrence([weekdays], at(25, 20)), null);
});

test("khung giờ qua nửa đêm tính cho ngày bắt đầu", () => {
  const night = slot({ start: "23:00", end: "01:00", days: [5] }); // Friday night
  assert.equal(activeScheduleOccurrence([night], at(23, 23, 30)).slotId, night.id); // Fri 23:30
  const afterMidnight = activeScheduleOccurrence([night], at(24, 0, 30)); // Sat 00:30
  assert.equal(afterMidnight.slotId, night.id);
  assert.deepEqual(afterMidnight.endAt, at(24, 1));
  assert.equal(activeScheduleOccurrence([night], at(24, 1)), null);
  assert.equal(activeScheduleOccurrence([night], at(25, 0, 30)), null); // Sun 00:30
});

test("khung bị tắt không chạy và không được tính là lịch kế tiếp", () => {
  const off = slot({ start: "19:00", end: "20:00", enabled: false });
  assert.equal(activeScheduleOccurrence([off], at(26, 19, 30)), null);
  assert.equal(nextScheduleOccurrence([off], at(26, 10)), null);
});

test("nextScheduleOccurrence chọn lần bắt đầu gần nhất", () => {
  const evening = slot({ start: "19:30", end: "21:30", days: [1, 2, 3, 4, 5] });
  const weekend = slot({ start: "10:00", end: "12:00", days: [0, 6] });
  assert.deepEqual(nextScheduleOccurrence([evening, weekend], at(26, 8)).startAt, at(26, 19, 30));
  // After Friday's window the next start is Saturday morning.
  const next = nextScheduleOccurrence([evening, weekend], at(30, 22));
  assert.equal(next.slotId, weekend.id);
  assert.deepEqual(next.startAt, at(31, 10));
  assert.equal(nextScheduleOccurrence([], at(26, 8)), null);
});

test("JsonStore lưu, sửa, xóa khung giờ và công tắc tổng", async () => {
  const dir = await mkdtemp(join(tmpdir(), "schedule-store-test-"));
  try {
    const store = new JsonStore(dir);
    await store.init();
    assert.deepEqual(store.snapshot().schedule, { enabled: false, slots: [] });

    const created = await store.addScheduleSlot({ start: "19:30", end: "21:30", days: [1, 2] });
    await store.updateSchedule({ enabled: true });
    const updated = await store.updateScheduleSlot(created.id, { enabled: false, end: "22:00" });
    assert.equal(updated.id, created.id);
    assert.equal(updated.start, "19:30");
    assert.equal(updated.end, "22:00");
    assert.equal(updated.enabled, false);
    await assert.rejects(() => store.updateScheduleSlot(created.id, { start: "22:00" }), /khác giờ bắt đầu/);

    const reloaded = new JsonStore(dir);
    await reloaded.init();
    assert.equal(reloaded.snapshot().schedule.enabled, true);
    assert.deepEqual(reloaded.snapshot().schedule.slots, [updated]);

    assert.equal(await reloaded.deleteScheduleSlot(created.id), true);
    assert.equal(await reloaded.deleteScheduleSlot(created.id), false);
    assert.equal(await reloaded.updateScheduleSlot("missing", { start: "10:00" }), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function prepareScheduledServer() {
  const dir = await mkdtemp(join(tmpdir(), "schedule-server-test-"));
  const instance = await startServer({ port: 0, dataDirectory: dir });
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  await instance.store.updateSettings({
    channelUrls: { gosh: "https://gosh.com/vi/16427037" },
    delaySeconds: 0,
    displayNames: [],
    renameEveryComments: 1,
  });
  await instance.store.addMessage("Mẫu 1\nMẫu 2", "gosh");
  instance.sessions.statuses = async (accounts) => accounts.map((account) => ({
    ...account,
    session: { running: true, loginState: "signed_in", readyToComment: true },
  }));
  const calls = [];
  instance.sessions.sendComment = async (_accountId, input) => {
    calls.push(input.content);
    return { sentAt: new Date().toISOString(), transport: "test" };
  };
  const call = (path, method, body) => fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const cleanup = async () => {
    instance.bulkSend.stopRequested = true;
    instance.bulkSend.wakeWaiter?.();
    while (instance.bulkSend.running) await new Promise((resolve) => setTimeout(resolve, 5));
    await instance.close();
    await rm(dir, { recursive: true, force: true });
  };
  return { instance, calls, call, cleanup };
}

const allDay = { start: "00:00", end: "23:59", days: [0, 1, 2, 3, 4, 5, 6] };

test("API lịch: tạo, sửa, xóa khung và bật tắt công tắc tổng", async () => {
  const { call, cleanup } = await prepareScheduledServer();
  try {
    const created = await call("/api/schedule/slots", "POST", { start: "19:30", end: "21:30", days: [1, 2, 3] });
    assert.equal(created.status, 201);
    const state = await created.json();
    assert.equal(state.schedule.enabled, false);
    assert.equal(state.schedule.slots.length, 1);
    const [{ id }] = state.schedule.slots;

    const invalid = await call("/api/schedule/slots", "POST", { start: "19:30", end: "19:30", days: [1] });
    assert.equal(invalid.status, 400);

    const patched = await (await call(`/api/schedule/slots/${id}`, "PATCH", { enabled: false })).json();
    assert.equal(patched.schedule.slots[0].enabled, false);
    assert.equal((await call("/api/schedule/slots/missing", "PATCH", { enabled: true })).status, 404);

    const toggled = await (await call("/api/schedule", "PUT", { enabled: true })).json();
    assert.equal(toggled.schedule.enabled, true);
    assert.equal(toggled.scheduleStatus.runningSlotId, null);

    const removed = await (await call(`/api/schedule/slots/${id}`, "DELETE")).json();
    assert.deepEqual(removed.schedule.slots, []);
    assert.equal((await call(`/api/schedule/slots/${id}`, "DELETE")).status, 404);
  } finally {
    await cleanup();
  }
});

test("lịch bật: tự chạy trong khung giờ, tắt lịch thì dừng", async () => {
  const { instance, calls, call, cleanup } = await prepareScheduledServer();
  try {
    await call("/api/schedule/slots", "POST", allDay);
    // Disabled schedule must not start anything.
    instance.runScheduleTick();
    assert.equal(instance.bulkSend.running, false);

    const enabled = await (await call("/api/schedule", "PUT", { enabled: true })).json();
    assert.equal(instance.bulkSend.running, true);
    assert.equal(instance.bulkSend.mode, "schedule");
    assert.equal(enabled.scheduleStatus.runningSlotId, enabled.schedule.slots[0].id);
    assert.ok(enabled.scheduleStatus.endsAt);

    // delaySeconds is 0 but scheduled runs keep a minimum gap, so wait for the first send only.
    while (!calls.length) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(calls[0], "Mẫu 1");

    // Manual sends are rejected while the schedule runs.
    assert.equal((await call("/api/comments/send-all", "POST")).status, 409);

    const disabled = await (await call("/api/schedule", "PUT", { enabled: false })).json();
    while (instance.bulkSend.running) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(disabled.schedule.enabled, false);
    assert.equal(instance.bulkSend.phase, "stopped");
    instance.runScheduleTick();
    assert.equal(instance.bulkSend.running, false);
  } finally {
    await cleanup();
  }
});

test("dừng tay một lượt theo lịch thì không tự chạy lại trong cùng khung giờ", async () => {
  const { instance, call, cleanup } = await prepareScheduledServer();
  try {
    await call("/api/schedule/slots", "POST", allDay);
    await call("/api/schedule", "PUT", { enabled: true });
    assert.equal(instance.bulkSend.running, true);

    await call("/api/comments/send-all/stop", "POST");
    while (instance.bulkSend.running) await new Promise((resolve) => setTimeout(resolve, 5));
    instance.runScheduleTick();
    assert.equal(instance.bulkSend.running, false);

    // Turning the schedule off and on again resumes it.
    await call("/api/schedule", "PUT", { enabled: false });
    await call("/api/schedule", "PUT", { enabled: true });
    assert.equal(instance.bulkSend.running, true);
  } finally {
    await cleanup();
  }
});

test("lịch báo lỗi và thử lại sau khi thiếu link hoặc kho bình luận", async () => {
  const { instance, call, cleanup } = await prepareScheduledServer();
  try {
    await instance.store.clearMessages("gosh");
    await call("/api/schedule/slots", "POST", allDay);
    const state = await (await call("/api/schedule", "PUT", { enabled: true })).json();
    assert.equal(instance.bulkSend.running, false);
    assert.match(state.scheduleStatus.error, /Kho bình luận/);
  } finally {
    await cleanup();
  }
});
