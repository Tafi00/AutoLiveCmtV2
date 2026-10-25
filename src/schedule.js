import { randomUUID } from "node:crypto";

export const MAX_SCHEDULE_SLOTS = 20;
// Scheduled runs loop over the comment queues for the whole window, so a
// zero-second delay would flood the rooms for hours.
export const MIN_SCHEDULE_DELAY_SECONDS = 5;
export const ALL_SCHEDULE_DAYS = [0, 1, 2, 3, 4, 5, 6];

export function normalizeScheduleTime(value, label = "Giờ") {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value ?? "").trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new Error(`${label} phải có dạng HH:MM.`);
  }
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

export function normalizeScheduleDays(value) {
  const entries = Array.isArray(value) ? value : [];
  const days = [...new Set(entries.map(Number))]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((left, right) => left - right);
  if (!days.length) throw new Error("Hãy chọn ít nhất một ngày cho khung giờ.");
  return days;
}

export function normalizeScheduleSlot(input = {}, existing = null) {
  const start = Object.hasOwn(input, "start")
    ? normalizeScheduleTime(input.start, "Giờ bắt đầu")
    : existing?.start;
  const end = Object.hasOwn(input, "end")
    ? normalizeScheduleTime(input.end, "Giờ kết thúc")
    : existing?.end;
  if (!start) throw new Error("Giờ bắt đầu phải có dạng HH:MM.");
  if (!end) throw new Error("Giờ kết thúc phải có dạng HH:MM.");
  if (start === end) throw new Error("Giờ kết thúc phải khác giờ bắt đầu.");
  return {
    id: existing?.id || (typeof input.id === "string" && /^[a-zA-Z0-9_-]+$/.test(input.id) ? input.id : randomUUID()),
    start,
    end,
    days: Object.hasOwn(input, "days") ? normalizeScheduleDays(input.days) : existing?.days || [...ALL_SCHEDULE_DAYS],
    enabled: Object.hasOwn(input, "enabled") ? input.enabled !== false : existing?.enabled ?? true,
  };
}

export function normalizeSchedule(value) {
  const schedule = { enabled: false, slots: [] };
  if (!value || typeof value !== "object") return schedule;
  schedule.enabled = value.enabled === true;
  const usedIds = new Set();
  for (const item of Array.isArray(value.slots) ? value.slots : []) {
    if (!item || typeof item !== "object" || schedule.slots.length >= MAX_SCHEDULE_SLOTS) continue;
    try {
      const slot = normalizeScheduleSlot(item);
      if (usedIds.has(slot.id)) slot.id = randomUUID();
      usedIds.add(slot.id);
      schedule.slots.push(slot);
    } catch {
      // Drop slots that no longer validate instead of discarding the whole schedule.
    }
  }
  return schedule;
}

function timeParts(time) {
  return time.split(":").map(Number);
}

// Builds the window of `slot` that starts `dayOffset` days from `now`. A slot
// whose end is not after its start runs past midnight into the next day.
function occurrenceOn(slot, now, dayOffset) {
  const [startHour, startMinute] = timeParts(slot.start);
  const [endHour, endMinute] = timeParts(slot.end);
  const startAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, startHour, startMinute);
  if (!slot.days.includes(startAt.getDay())) return null;
  const overnight = endHour * 60 + endMinute <= startHour * 60 + startMinute;
  const endAt = new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate() + (overnight ? 1 : 0), endHour, endMinute);
  return { slotId: slot.id, startAt, endAt };
}

// Returns the enabled window that contains `now`, preferring the one that ends
// last when windows overlap.
export function activeScheduleOccurrence(slots, now = new Date()) {
  let active = null;
  for (const slot of slots) {
    if (!slot.enabled) continue;
    for (const dayOffset of [-1, 0]) {
      const occurrence = occurrenceOn(slot, now, dayOffset);
      if (!occurrence || occurrence.startAt > now || occurrence.endAt <= now) continue;
      if (!active || occurrence.endAt > active.endAt) active = occurrence;
    }
  }
  return active;
}

export function nextScheduleOccurrence(slots, now = new Date()) {
  let next = null;
  for (const slot of slots) {
    if (!slot.enabled) continue;
    for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
      const occurrence = occurrenceOn(slot, now, dayOffset);
      if (!occurrence || occurrence.startAt <= now) continue;
      if (!next || occurrence.startAt < next.startAt) next = occurrence;
      break;
    }
  }
  return next;
}
