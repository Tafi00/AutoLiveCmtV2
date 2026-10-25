import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { AccountSessionManager } from "./session-manager.js";
import { JsonStore } from "./store.js";
import { checkApiHealth, healthTargets } from "./api-health.js";
import { PLATFORMS } from "./platforms.js";
import { discoveredApiEndpoints } from "./browser-session.js";
import {
  activeScheduleOccurrence,
  MIN_SCHEDULE_DELAY_SECONDS,
  nextScheduleOccurrence,
} from "./schedule.js";

import { readFileSync } from "node:fs";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = dirname(currentDirectory);

let appVersion = "2.0.0";
try {
  const pkg = JSON.parse(readFileSync(join(rootDirectory, "package.json"), "utf8"));
  if (pkg.version) appVersion = pkg.version;
} catch {}

export async function createServerApp({
  dataDirectory = process.env.DATA_DIRECTORY
    ? resolve(process.env.DATA_DIRECTORY)
    : join(rootDirectory, "data"),
  publicDirectory = join(rootDirectory, "public"),
  lucideDirectory = join(rootDirectory, "node_modules", "lucide", "dist", "esm"),
} = {}) {
  const store = new JsonStore(dataDirectory);
  await store.init();

  const sessions = new AccountSessionManager({ dataDirectory });
  await sessions.init();

const PLATFORM_IDS = Object.keys(PLATFORMS);
const RENAME_PLATFORMS = new Set(["gosh", "gaquaytv"]);

const bulkSend = {
  running: false,
  stopRequested: false,
  total: 0,
  sent: 0,
  failed: 0,
  totalMessages: 0,
  completedMessages: 0,
  startedAt: null,
  completedAt: null,
  error: null,
  failures: [],
  currentAccount: "",
  activePlatforms: [],
  linkTotals: Object.fromEntries(PLATFORM_IDS.map((platform) => [platform, 0])),
  messageTotals: Object.fromEntries(PLATFORM_IDS.map((platform) => [platform, 0])),
  completedByPlatform: Object.fromEntries(PLATFORM_IDS.map((platform) => [platform, 0])),
  phase: "idle",
  wakeWaiter: null,
  // "all" sends every queued message once; "schedule" loops the queues until endsAt.
  mode: "all",
  endsAt: null,
  scheduleSlotId: null,
};
const SCHEDULE_TICK_MS = 5_000;
const SCHEDULE_RETRY_MS = 60_000;
const scheduler = {
  timer: null,
  // Slots the user stopped by hand stay idle until their current window ends.
  skippedUntil: new Map(),
  retryAt: 0,
  error: "",
};
let manualSendRunning = false;
const displayNameUpdates = new Set();
let apiHealth = healthTargets().map((target) => ({ ...target, status: "unknown", httpStatus: null, latencyMs: null, checkedAt: null, error: "" }));

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use("/vendor/lucide", express.static(lucideDirectory));
app.use(express.static(publicDirectory));

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response)).catch(next);
}

function bulkSendState() {
  return {
    running: bulkSend.running,
    stopRequested: bulkSend.stopRequested,
    total: bulkSend.total,
    sent: bulkSend.sent,
    failed: bulkSend.failed,
    totalMessages: bulkSend.totalMessages,
    completedMessages: bulkSend.completedMessages,
    startedAt: bulkSend.startedAt,
    completedAt: bulkSend.completedAt,
    error: bulkSend.error,
    failures: bulkSend.failures.slice(-30),
    currentAccount: bulkSend.currentAccount,
    activePlatforms: [...bulkSend.activePlatforms],
    linkTotals: { ...bulkSend.linkTotals },
    messageTotals: { ...bulkSend.messageTotals },
    completedByPlatform: { ...bulkSend.completedByPlatform },
    phase: bulkSend.phase,
    mode: bulkSend.mode,
    endsAt: bulkSend.endsAt,
    scheduleSlotId: bulkSend.scheduleSlotId,
  };
}

function scheduleStatus(now = new Date()) {
  const { enabled, slots } = store.snapshot().schedule;
  const runningSchedule = bulkSend.running && bulkSend.mode === "schedule";
  const next = enabled ? nextScheduleOccurrence(slots, now) : null;
  return {
    runningSlotId: runningSchedule ? bulkSend.scheduleSlotId : null,
    endsAt: runningSchedule ? bulkSend.endsAt : null,
    nextStartAt: next ? next.startAt.toISOString() : null,
    nextSlotId: next?.slotId || null,
    skippedSlotIds: [...scheduler.skippedUntil]
      .filter(([, until]) => until > now.getTime())
      .map(([slotId]) => slotId),
    error: enabled ? scheduler.error : "",
  };
}

async function dashboardState() {
  let state = store.snapshot();
  const accountStatuses = await sessions.statuses(state.accounts);
  for (const account of accountStatuses) {
    const detectedName = account.session?.identity?.displayName;
    const identitySource = account.session?.identity?.source;
    if (detectedName && identitySource !== "explicit_update" && detectedName !== account.profileName) {
      await store.updateAccountProfileName(account.id, detectedName);
    }
  }
  state = store.snapshot();
  const sessionsById = new Map(accountStatuses.map((account) => [account.id, account.session]));
  return {
    ...state,
    accounts: state.accounts.map((account) => ({ ...account, session: sessionsById.get(account.id) })),
    nextMessages: Object.fromEntries(PLATFORM_IDS.map((platform) => [platform, store.getNextMessage(platform)])),
    nextMessage: store.getNextMessage(state.settings.platform),
    cooldown: store.cooldown(),
    bulkSend: bulkSendState(),
    scheduleStatus: scheduleStatus(),
    platforms: Object.values(PLATFORMS).map(({ id, name, homeUrl }) => ({ id, name, homeUrl })),
    version: appVersion,
  };
}

function rejectDuringBulk(response) {
  if (!bulkSend.running) return false;
  response.status(409).json({ error: "Hãy dừng lượt gửi hàng loạt trước khi thay đổi dữ liệu." });
  return true;
}

function accountOrThrow(accountId) {
  const account = store.getAccount(accountId);
  if (!account) {
    const error = new Error("Không tìm thấy tài khoản.");
    error.status = 404;
    throw error;
  }
  return account;
}

function channelLinksForPlatform(state, platform) {
  const links = state.settings.channelLinks?.[platform];
  if (Array.isArray(links)) return links.filter(Boolean);
  if (state.settings.channelUrls && typeof state.settings.channelUrls === "object") {
    const legacy = state.settings.channelUrls[platform];
    return legacy ? [legacy] : [];
  }
  return state.settings.platform === platform && state.settings.channelUrl
    ? [state.settings.channelUrl]
    : [];
}

function channelUrlForPlatform(state, platform) {
  return channelLinksForPlatform(state, platform)[0] || "";
}

function availableDestinations(state) {
  return Object.keys(PLATFORMS).flatMap((platform) => {
    const channelLinks = channelLinksForPlatform(state, platform);
    const accounts = store.getEnabledAccounts(platform);
    return channelLinks.length && accounts.length
      ? channelLinks.map((channelUrl, linkIndex) => ({
        id: `${platform}:${channelUrl}`,
        platform,
        channelUrl,
        linkIndex,
        accounts,
      }))
      : [];
  });
}

function destinationsWithMessages(state, platforms = null) {
  const allowed = platforms ? new Set(platforms) : null;
  return availableDestinations(state).filter(({ platform }) => (
    (!allowed || allowed.has(platform)) && store.getNextMessage(platform)
  ));
}

function assertDestinations(state, { requireMessages = false, platforms = null } = {}) {
  const requestedPlatforms = platforms || PLATFORM_IDS;
  const destinations = availableDestinations(state)
    .filter(({ platform }) => requestedPlatforms.includes(platform));
  if (destinations.length && !requireMessages) return destinations;
  if (destinations.length) {
    const withMessages = destinationsWithMessages(state, requestedPlatforms);
    if (withMessages.length) return withMessages;
    throw new Error("Kho bình luận của website đang hoạt động đang trống.");
  }
  const hasRoom = requestedPlatforms.some((platform) => channelLinksForPlatform(state, platform).length);
  if (!hasRoom) {
    const names = Object.values(PLATFORMS).map((platform) => platform.name).join(" hoặc ");
    throw new Error(`Hãy lưu URL phòng live cho ${names} trước.`);
  }
  throw new Error("Cần bật ít nhất một tài khoản phù hợp với website đã nhập URL.");
}

function waitForBulk(milliseconds) {
  if (milliseconds <= 0 || bulkSend.stopRequested) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    function finish() {
      clearTimeout(timer);
      if (bulkSend.wakeWaiter === finish) bulkSend.wakeWaiter = null;
      resolve();
    }
    bulkSend.wakeWaiter = finish;
  });
}

async function updateDisplayName(accountId, displayName) {
  const account = accountOrThrow(accountId);
  if (!RENAME_PLATFORMS.has(account.platform)) {
    const names = [...RENAME_PLATFORMS].map((platform) => PLATFORMS[platform].name).join(" và ");
    const error = new Error(`Chức năng đổi tên chỉ áp dụng cho tài khoản ${names}.`);
    error.status = 400;
    throw error;
  }
  if (displayNameUpdates.has(accountId)) {
    throw new Error("Tài khoản này đang được đổi tên.");
  }
  displayNameUpdates.add(accountId);
  try {
    const result = await sessions.updateDisplayName(accountId, displayName, account.platform, account.proxy);
    await store.updateAccountProfileName(accountId, result.displayName);
    return result;
  } finally {
    displayNameUpdates.delete(accountId);
  }
}

async function updateAutomaticDisplayNames(accounts) {
  if (!store.shouldRename()) return null;
  const renameAccounts = [...new Map(
    accounts
      .filter((account) => RENAME_PLATFORMS.has(account.platform))
      .map((account) => [account.id, account]),
  ).values()];
  if (!renameAccounts.length) return null;
  if (bulkSend.running) bulkSend.phase = "renaming";

  const results = [];
  const chosenNames = [];

  for (const account of renameAccounts) {
    const currentName = account.profileName || account.name;
    const displayName = store.getRandomDisplayName(currentName);
    if (!displayName) continue;

    try {
      await updateDisplayName(account.id, displayName);
      chosenNames.push(displayName);
      results.push({
        accountId: account.id,
        accountName: account.profileName || account.name,
        newName: displayName,
        ok: true,
      });
    } catch (error) {
      results.push({
        accountId: account.id,
        accountName: account.profileName || account.name,
        ok: false,
        error: error.message,
      });
    }
  }

  if (results.some((result) => result.ok)) await store.markDisplayNameUpdated();
  return { displayName: chosenNames[0] || null, displayNames: chosenNames, results };
}

const accountCursors = new Map();

function destinationCursorKey(destination) {
  return `${destination.platform}:${destination.channelUrl}`;
}

function destinationLabel(destination) {
  const ordinal = Number.isInteger(destination.linkIndex) ? ` #${destination.linkIndex + 1}` : "";
  return `${PLATFORMS[destination.platform].name}${ordinal}`;
}

async function sendNextComment({ advanceOnTotalFailure = false, platforms = null } = {}) {
  const state = store.snapshot();
  const destinations = assertDestinations(state, { requireMessages: true, platforms });
  const selected = destinations.map((destination) => {
    const key = destinationCursorKey(destination);
    const cursor = accountCursors.get(key) || 0;
    const account = destination.accounts[cursor % destination.accounts.length];
    accountCursors.set(key, cursor + 1);
    return { ...destination, account, message: store.getNextMessage(destination.platform) };
  });

  if (bulkSend.running) {
    bulkSend.currentAccount = selected
      .map((destination) => `${destinationLabel(destination)}: ${destination.account.profileName || destination.account.name}`)
      .join(" + ");
  }

  const settled = await Promise.allSettled(selected.map(({ account, channelUrl, message }) => (
    sessions.sendComment(account.id, {
      channelUrl,
      content: message.content,
    }, account.platform, account.proxy)
  )));
  const results = settled.map((outcome, index) => {
    const { platform, channelUrl, account, message } = selected[index];
    const accountName = account.profileName || account.name;
    if (outcome.status === "fulfilled") {
      return {
        platform,
        channelUrl,
        linkIndex: selected[index].linkIndex,
        accountId: account.id,
        accountName,
        message: message.content,
        ok: true,
        result: outcome.value,
      };
    }
    return {
      platform,
      channelUrl,
      linkIndex: selected[index].linkIndex,
      accountId: account.id,
      accountName,
      message: message.content,
      ok: false,
      error: outcome.reason?.message || "Không thể gửi bình luận.",
    };
  });
  const successes = results.filter((result) => result.ok);
  const failures = results.filter((result) => !result.ok);

  if (!successes.length && !advanceOnTotalFailure) {
    throw new Error(failures
      .map((failure) => `${destinationLabel(failure)} · ${failure.accountName}: ${failure.error}`)
      .join(" · "));
  }

  const platformsToAdvance = advanceOnTotalFailure
    ? selected.map(({ platform }) => platform)
    : successes.map(({ platform }) => platform);
  await store.markSent({
    platforms: platformsToAdvance,
    countForRename: successes.some((result) => RENAME_PLATFORMS.has(result.platform)),
  });

  let rename = null;
  const successfulRenameAccounts = selected
    .filter(({ account, platform }) => successes.some((result) => result.accountId === account.id && result.platform === platform && RENAME_PLATFORMS.has(platform)))
    .map(({ account }) => account);
  if (successfulRenameAccounts.length && store.shouldRename()) {
    rename = await updateAutomaticDisplayNames(successfulRenameAccounts);
  }

  return {
    message: selected[0]?.message || null,
    messages: [...new Map(selected.map(({ platform, message }) => [
      platform,
      { platform, ...message },
    ])).values()],
    account: successes[0] ? { id: successes[0].accountId, name: successes[0].accountName } : null,
    accounts: results.map((result) => ({
      id: result.accountId,
      name: result.accountName,
      platform: result.platform,
      channelUrl: result.channelUrl,
      linkIndex: result.linkIndex,
    })),
    result: successes[0]?.result || null,
    results,
    rename,
    successCount: successes.length,
    failureCount: failures.length,
    totalAccounts: new Set(selected.map(({ account }) => account.id)).size,
    totalLinks: selected.length,
    activePlatforms: [...new Set(selected.map(({ platform }) => platform))],
    activeLinks: selected.map(({ platform, channelUrl, linkIndex }) => ({ platform, channelUrl, linkIndex })),
  };
}

// Starts connecting the accounts that will send next while the delay runs.
function prepareNextAccounts(platforms) {
  if (!platforms.length) return;
  for (const destination of destinationsWithMessages(store.snapshot(), platforms)) {
    const cursor = accountCursors.get(destinationCursorKey(destination)) || 0;
    const account = destination.accounts[cursor % destination.accounts.length];
    void sessions.prepare(account.id, { channelUrl: destination.channelUrl }, account.platform, account.proxy);
  }
}

function isScheduledRun() {
  return bulkSend.mode === "schedule";
}

function scheduledTimeLeftMs() {
  return Date.parse(bulkSend.endsAt) - Date.now();
}

function bulkShouldContinue() {
  if (bulkSend.stopRequested) return false;
  return isScheduledRun()
    ? scheduledTimeLeftMs() > 0
    : bulkSend.completedMessages < bulkSend.totalMessages;
}

// Platforms still owed a message this round. A scheduled run keeps looping the
// queues, so every platform that can currently send takes part.
function bulkRoundPlatforms() {
  if (isScheduledRun()) {
    const state = store.snapshot();
    return PLATFORM_IDS.filter((platform) => destinationsWithMessages(state, [platform]).length);
  }
  return PLATFORM_IDS.filter((platform) => (
    bulkSend.completedByPlatform[platform] < bulkSend.messageTotals[platform]
  ));
}

function startBulkRun(fields) {
  Object.assign(bulkSend, {
    running: true,
    stopRequested: false,
    total: 0,
    sent: 0,
    failed: 0,
    totalMessages: 0,
    completedMessages: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    failures: [],
    currentAccount: "",
    activePlatforms: [],
    completedByPlatform: Object.fromEntries(PLATFORM_IDS.map((platform) => [platform, 0])),
    phase: "starting",
    wakeWaiter: null,
    mode: "all",
    endsAt: null,
    scheduleSlotId: null,
    ...fields,
  });
  return runBulkSend();
}

function requestBulkStop() {
  if (!bulkSend.running) return;
  bulkSend.stopRequested = true;
  bulkSend.phase = "stopping";
  bulkSend.wakeWaiter?.();
}

async function runBulkSend() {
  try {
    while (bulkShouldContinue()) {
      const cooldown = store.cooldown({ minimumSeconds: isScheduledRun() ? MIN_SCHEDULE_DELAY_SECONDS : 0 });
      if (!cooldown.ready) {
        bulkSend.phase = "waiting";
        bulkSend.currentAccount = "";
        prepareNextAccounts(bulkRoundPlatforms());
        const waitMs = cooldown.remainingSeconds * 1000;
        await waitForBulk(isScheduledRun() ? Math.min(waitMs, Math.max(0, scheduledTimeLeftMs())) : waitMs);
        if (!bulkShouldContinue()) break;
      }

      const roundPlatforms = bulkRoundPlatforms();
      if (!roundPlatforms.length) break;
      bulkSend.phase = "sending";
      const batch = await sendNextComment({ advanceOnTotalFailure: true, platforms: roundPlatforms });
      bulkSend.sent += batch.successCount;
      bulkSend.failed += batch.failureCount;
      bulkSend.completedMessages += 1;
      for (const platform of roundPlatforms) bulkSend.completedByPlatform[platform] += 1;
      for (const failure of batch.results.filter((result) => !result.ok)) {
        bulkSend.failures.push({
          accountId: failure.accountId,
          accountName: failure.accountName,
          platform: failure.platform,
          channelUrl: failure.channelUrl,
          linkIndex: failure.linkIndex,
          message: failure.message,
          error: failure.error,
        });
        if (bulkSend.failures.length > 30) bulkSend.failures.shift();
      }
    }
  } catch (error) {
    bulkSend.error = error.message || "Không thể tiếp tục gửi hàng loạt.";
  } finally {
    bulkSend.phase = bulkSend.stopRequested
      ? "stopped"
      : bulkSend.error
        ? "failed"
        : bulkSend.failed
          ? "completed_with_errors"
          : "completed";
    bulkSend.running = false;
    bulkSend.stopRequested = false;
    bulkSend.completedAt = new Date().toISOString();
    bulkSend.currentAccount = "";
    bulkSend.activePlatforms = [];
    bulkSend.wakeWaiter = null;
  }
}

app.get("/api/state", asyncRoute(async (_request, response) => {
  response.json(await dashboardState());
}));

app.post("/api/accounts", asyncRoute(async (request, response) => {
  if (rejectDuringBulk(response)) return;
  await store.addAccount(request.body?.name, request.body?.platform);
  response.status(201).json(await dashboardState());
}));

app.patch("/api/accounts/:id", asyncRoute(async (request, response) => {
  if (rejectDuringBulk(response)) return;
  const account = await store.updateAccount(request.params.id, request.body || {});
  if (!account) return response.status(404).json({ error: "Không tìm thấy tài khoản." });
  response.json(await dashboardState());
}));

app.delete("/api/accounts/:id", asyncRoute(async (request, response) => {
  if (rejectDuringBulk(response)) return;
  const account = accountOrThrow(request.params.id);
  if (store.snapshot().accounts.length === 1) {
    return response.status(400).json({ error: "Không thể xóa tài khoản cuối cùng." });
  }
  await sessions.deleteSession(account.id);
  await store.deleteAccount(account.id);
  response.json(await dashboardState());
}));

app.post("/api/accounts/:id/browser/open", asyncRoute(async (request, response) => {
  if (bulkSend.running) {
    return response.status(409).json({ error: "Hãy dừng lượt gửi trước khi mở trình duyệt." });
  }
  const account = accountOrThrow(request.params.id);
  const state = store.snapshot();
  const targetUrl = request.body?.targetUrl || channelUrlForPlatform(state, account.platform) || undefined;
  const session = await sessions.openForManualLogin(account.id, targetUrl, account.platform, { autoCloseOnLogin: false }, account.proxy);
  response.json({ account: { ...account, session } });
}));

app.post("/api/accounts/:id/browser/login", asyncRoute(async (request, response) => {
  if (bulkSend.running) {
    return response.status(409).json({ error: "Hãy dừng lượt gửi trước khi đăng nhập." });
  }
  const account = accountOrThrow(request.params.id);
  const state = store.snapshot();
  const targetUrl = request.body?.targetUrl || channelUrlForPlatform(state, account.platform) || undefined;
  const session = await sessions.openForManualLogin(account.id, targetUrl, account.platform, { autoCloseOnLogin: true }, account.proxy);
  response.json({ account: { ...account, session } });
}));

app.post("/api/accounts/:id/login", asyncRoute(async (request, response) => {
  if (bulkSend.running) {
    return response.status(409).json({ error: "Hãy dừng lượt gửi trước khi đăng nhập." });
  }
  const account = accountOrThrow(request.params.id);
  const { usernameOrEmail, password } = request.body || {};
  if (!usernameOrEmail || !password) {
    return response.status(400).json({ error: "Vui lòng nhập tài khoản và mật khẩu." });
  }
  const identity = await sessions.login(account.id, { usernameOrEmail, password }, account.platform, account.proxy);
  if (identity?.displayName) {
    await store.updateAccount(account.id, { profileName: identity.displayName });
  }
  response.json(await dashboardState());
}));

app.post("/api/accounts/tokens/load", asyncRoute(async (request, response) => {
  if (bulkSend.running) {
    return response.status(409).json({ error: "Hãy dừng lượt gửi trước khi nạp token." });
  }
  const accounts = store.snapshot().accounts.filter((account) => account.enabled);
  const result = await sessions.loadTokens(accounts, { onlyMissing: request.body?.onlyMissing !== false });
  response.json({ ...(await dashboardState()), tokenLoad: result });
}));

app.post("/api/accounts/:id/browser/profile", asyncRoute(async (request, response) => {
  if (bulkSend.running) {
    return response.status(409).json({ error: "Hãy dừng lượt gửi trước khi mở hồ sơ." });
  }
  const account = accountOrThrow(request.params.id);
  const session = await sessions.openProfile(account.id, account.platform, { autoCloseOnLogin: false }, account.proxy);
  response.json({ account: { ...account, session } });
}));

app.post("/api/accounts/:id/display-name", asyncRoute(async (request, response) => {
  if (bulkSend.running) {
    return response.status(409).json({ error: "Hãy dừng lượt gửi trước khi đổi tên." });
  }
  const result = await updateDisplayName(request.params.id, request.body?.displayName);
  response.json({ result, bulkSend: bulkSendState() });
}));

// Backward-compatible routes for clients cached from the single-account version.
app.get("/api/browser/status", asyncRoute(async (_request, response) => {
  const accounts = await sessions.statuses(store.snapshot().accounts);
  response.json({ accounts, browser: accounts[0]?.session || null });
}));

app.post("/api/browser/open", asyncRoute(async (request, response) => {
  const state = store.snapshot();
  const account = store.getEnabledAccounts(state.settings.platform)[0];
  if (!account) return response.status(400).json({ error: "Cần bật ít nhất một tài khoản." });
  const targetUrl = request.body?.targetUrl || channelUrlForPlatform(state, account.platform) || undefined;
  response.json({ browser: await sessions.open(account.id, targetUrl, account.platform, account.proxy) });
}));

app.post("/api/browser/profile", asyncRoute(async (_request, response) => {
  const account = store.getEnabledAccounts(store.snapshot().settings.platform)[0];
  if (!account) return response.status(400).json({ error: "Cần bật ít nhất một tài khoản." });
  response.json({ browser: await sessions.openProfile(account.id, account.platform, { autoCloseOnLogin: false }, account.proxy) });
}));

app.post("/api/profile/display-name", asyncRoute(async (request, response) => {
  const account = store.getEnabledAccounts()[0];
  if (!account) return response.status(400).json({ error: "Cần bật ít nhất một tài khoản." });
  const result = await updateDisplayName(account.id, request.body?.displayName);
  response.json({ result, bulkSend: bulkSendState() });
}));

  app.post("/api/messages", asyncRoute(async (request, response) => {
    if (rejectDuringBulk(response)) return;
    await store.addMessage(request.body?.content ?? request.body?.messages, request.body?.platform || "gosh");
    response.status(201).json(await dashboardState());
  }));

app.delete("/api/messages/:id", asyncRoute(async (request, response) => {
  if (rejectDuringBulk(response)) return;
  const deleted = await store.deleteMessage(request.params.id, request.query.platform || null);
  if (!deleted) return response.status(404).json({ error: "Không tìm thấy bình luận." });
  response.json(await dashboardState());
}));

app.delete("/api/messages", asyncRoute(async (_request, response) => {
  if (rejectDuringBulk(response)) return;
  const deletedCount = await store.clearMessages(_request.query.platform || null);
  response.json({ ...(await dashboardState()), deletedCount });
}));

app.put("/api/settings", asyncRoute(async (request, response) => {
  if (rejectDuringBulk(response)) return;
  await store.updateSettings(request.body || {});
  response.json(await dashboardState());
}));

app.get("/api/health", (_request, response) => {
  response.json({ checks: apiHealth });
});

app.post("/api/health/check", asyncRoute(async (_request, response) => {
  apiHealth = await checkApiHealth(store.snapshot().settings.channelLinks);
  response.json({ checks: apiHealth });
}));

app.get("/api/endpoints/observed", (_request, response) => {
  response.json({ endpoints: Array.from(discoveredApiEndpoints.values()) });
});

app.post("/api/comments/send-next", asyncRoute(async (_request, response) => {
  if (bulkSend.running) {
    return response.status(409).json({ error: "Một lượt gửi hàng loạt đang chạy." });
  }
  if (manualSendRunning) {
    return response.status(409).json({ error: "Một bình luận khác đang được gửi." });
  }

  const state = store.snapshot();
  try { assertDestinations(state, { requireMessages: true }); }
  catch (error) { return response.status(400).json({ error: error.message }); }

  const cooldown = store.cooldown();
  if (!cooldown.ready) {
    return response.status(429).json({
      error: `Vui lòng chờ thêm ${cooldown.remainingSeconds} giây trước lần gửi tiếp theo.`,
      cooldown,
    });
  }

  manualSendRunning = true;
  try {
    const result = await sendNextComment();
    response.json({ ...(await dashboardState()), result });
  } finally {
    manualSendRunning = false;
  }
}));

app.post("/api/comments/send-all", asyncRoute(async (_request, response) => {
  if (bulkSend.running) {
    return response.status(409).json({ error: "Một lượt gửi hàng loạt đang chạy." });
  }
  if (manualSendRunning) {
    return response.status(409).json({ error: "Hãy chờ bình luận hiện tại gửi xong." });
  }

  const state = store.snapshot();
  let available;
  try { available = assertDestinations(state); }
  catch (error) { return response.status(400).json({ error: error.message }); }
  const messageTotals = Object.fromEntries(PLATFORM_IDS.map((platform) => [
    platform,
    available.some((destination) => destination.platform === platform) ? store.getMessages(platform).length : 0,
  ]));
  const linkTotals = Object.fromEntries(PLATFORM_IDS.map((platform) => [
    platform,
    available.filter((destination) => destination.platform === platform).length,
  ]));
  const totalMessages = PLATFORM_IDS.reduce(
    (sum, platform) => sum + messageTotals[platform] * linkTotals[platform],
    0,
  );
  const roundCount = Math.max(...Object.values(messageTotals), 0);
  if (!totalMessages) {
    const names = Object.values(PLATFORMS).map((platform) => platform.name).join(" và ");
    return response.status(400).json({ error: `Kho bình luận của ${names} đang trống.` });
  }
  const destinations = available.filter(({ platform }) => messageTotals[platform] > 0);

  void startBulkRun({
    total: totalMessages,
    totalMessages: roundCount,
    activePlatforms: [...new Set(destinations.map(({ platform }) => platform))],
    linkTotals,
    messageTotals,
  });
  response.status(202).json(await dashboardState());
}));

app.post("/api/comments/send-all/stop", asyncRoute(async (_request, response) => {
  if (bulkSend.running && isScheduledRun()) {
    // A hand-stopped window stays idle until it ends instead of restarting on the next tick.
    scheduler.skippedUntil.set(bulkSend.scheduleSlotId, Date.parse(bulkSend.endsAt));
  }
  requestBulkStop();
  response.json(await dashboardState());
}));

// --- Comment schedule -------------------------------------------------------

function scheduleRunFields(state) {
  const destinations = assertDestinations(state, { requireMessages: true });
  const platforms = [...new Set(destinations.map(({ platform }) => platform))];
  return {
    activePlatforms: platforms,
    linkTotals: Object.fromEntries(PLATFORM_IDS.map((platform) => [
      platform,
      destinations.filter((destination) => destination.platform === platform).length,
    ])),
    messageTotals: Object.fromEntries(PLATFORM_IDS.map((platform) => [
      platform,
      platforms.includes(platform) ? store.getMessages(platform).length : 0,
    ])),
  };
}

// Starts and stops scheduled runs so they follow the saved slots. Called by the
// timer and right after any schedule change so edits apply without waiting.
function runScheduleTick(now = new Date()) {
  const state = store.snapshot();
  const { enabled, slots } = state.schedule;
  const scheduledRunning = bulkSend.running && isScheduledRun();

  if (scheduledRunning) {
    const slot = slots.find((item) => item.id === bulkSend.scheduleSlotId);
    const occurrence = enabled && slot?.enabled ? activeScheduleOccurrence([slot], now) : null;
    if (!occurrence) {
      requestBulkStop();
    } else {
      // Picks up edits to the running slot's end time.
      bulkSend.endsAt = occurrence.endAt.toISOString();
    }
    return;
  }
  if (!enabled || bulkSend.running || manualSendRunning) return;

  for (const [slotId, until] of scheduler.skippedUntil) {
    if (until <= now.getTime() || !slots.some((slot) => slot.id === slotId)) scheduler.skippedUntil.delete(slotId);
  }
  const active = activeScheduleOccurrence(
    slots.filter((slot) => !scheduler.skippedUntil.has(slot.id)),
    now,
  );
  if (!active) {
    scheduler.error = "";
    return;
  }
  if (now.getTime() < scheduler.retryAt) return;

  try {
    const fields = scheduleRunFields(state);
    scheduler.error = "";
    void startBulkRun({
      ...fields,
      mode: "schedule",
      endsAt: active.endAt.toISOString(),
      scheduleSlotId: active.slotId,
    }).then(() => {
      if (!bulkSend.error) return;
      scheduler.error = bulkSend.error;
      scheduler.retryAt = Date.now() + SCHEDULE_RETRY_MS;
    });
  } catch (error) {
    scheduler.error = error.message;
    scheduler.retryAt = now.getTime() + SCHEDULE_RETRY_MS;
  }
}

function scheduleChanged({ resume = false } = {}) {
  if (resume) {
    scheduler.skippedUntil.clear();
    scheduler.retryAt = 0;
  }
  runScheduleTick();
}

function scheduleSlotOrThrow(id) {
  const slot = store.getScheduleSlot(id);
  if (!slot) {
    const error = new Error("Không tìm thấy khung giờ.");
    error.status = 404;
    throw error;
  }
  return slot;
}

app.put("/api/schedule", asyncRoute(async (request, response) => {
  await store.updateSchedule({ enabled: request.body?.enabled });
  scheduleChanged({ resume: Boolean(request.body?.enabled) });
  response.json(await dashboardState());
}));

app.post("/api/schedule/slots", asyncRoute(async (request, response) => {
  await store.addScheduleSlot(request.body || {});
  scheduleChanged();
  response.status(201).json(await dashboardState());
}));

app.patch("/api/schedule/slots/:id", asyncRoute(async (request, response) => {
  scheduleSlotOrThrow(request.params.id);
  await store.updateScheduleSlot(request.params.id, request.body || {});
  scheduler.skippedUntil.delete(request.params.id);
  scheduler.retryAt = 0;
  scheduleChanged();
  response.json(await dashboardState());
}));

app.delete("/api/schedule/slots/:id", asyncRoute(async (request, response) => {
  scheduleSlotOrThrow(request.params.id);
  await store.deleteScheduleSlot(request.params.id);
  scheduleChanged();
  response.json(await dashboardState());
}));

scheduler.timer = setInterval(() => {
  try { runScheduleTick(); } catch (error) { scheduler.error = error.message; }
}, SCHEDULE_TICK_MS);
scheduler.timer.unref();

  app.use((error, _request, response, _next) => {
    const status = error.status || (error.code === "LOGIN_REQUIRED" ? 401 : 400);
    response.status(status).json({ error: error.message || "Đã có lỗi xảy ra." });
  });

  return {
    app,
    store,
    sessions,
    bulkSend,
    runScheduleTick,
    close: async () => {
      clearInterval(scheduler.timer);
      bulkSend.stopRequested = true;
      bulkSend.wakeWaiter?.();
      await sessions.closeAll();
    },
  };
}

export async function startServer({
  port = Number(process.env.PORT || 4317),
  dataDirectory = process.env.DATA_DIRECTORY
    ? resolve(process.env.DATA_DIRECTORY)
    : join(rootDirectory, "data"),
  host = "127.0.0.1",
} = {}) {
  const { app, store, sessions, bulkSend, runScheduleTick, close: closeSessions } = await createServerApp({ dataDirectory });

  return new Promise((resolvePromise, rejectPromise) => {
    const server = app.listen(port, host, () => {
      console.log(`Live Comment: http://${host}:${port}`);
      resolvePromise({
        app,
        server,
        store,
        sessions,
        bulkSend,
        runScheduleTick,
        close: async () => {
          await new Promise((res) => server.close(res));
          await closeSessions();
        },
      });
    });
    server.once("error", rejectPromise);
  });
}

const isDirectRun = process.argv[1] && (
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
);

if (isDirectRun) {
  const instance = await startServer();
  const shutdown = async () => {
    await instance.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
