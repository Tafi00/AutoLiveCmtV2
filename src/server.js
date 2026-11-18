import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { AccountSessionManager } from "./session-manager.js";
import { SESSION_COOKIE_NAME, WebAuthManager } from "./auth.js";
import { JsonStore } from "./store.js";
import { accountsRevision, compactJsonResponses } from "./state-transfer.js";
import { Realtime } from "./realtime.js";
import { DraftStore } from "./drafts.js";
import { startMemoryGuard } from "./memory-guard.js";
import { checkApiHealth, healthTargets } from "./api-health.js";
import { PLATFORMS } from "./platforms.js";
import { discoveredApiEndpoints } from "./browser-session.js";
import { ViewbotManager } from "./viewbot/manager.js";
import { platformList, resolvePlatform, extractHub } from "./viewbot/platforms.js";
import { HubManager, hubInstallScripts } from "./viewbot/hubs.js";
import { Deployments } from "./viewbot/deployments.js";
import { TelegramBoostManager } from "./telegram/manager.js";
import { goshChannelProfile, goshFollowChannel, goshLogin, goshRefresh, goshTargetUid, jwtExpiresWithin, liveTencentChatCopies, resolveGoshTargetUid } from "./token-transport.js";
import {
  activeScheduleOccurrence,
  MIN_SCHEDULE_DELAY_SECONDS,
  nextScheduleOccurrence,
  slotChannelLinks,
} from "./schedule.js";

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";

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
  requireAuth = false,
} = {}) {
  const store = new JsonStore(dataDirectory);
  await store.init();

  const webAuth = new WebAuthManager(dataDirectory);
  await webAuth.init();

  const sessions = new AccountSessionManager({ dataDirectory });
  await sessions.init();

  const regStatePath = join(dataDirectory, "otp-reg-state.json");
  let regCredentialsById = new Map();
  let regStateMtimeMs = 0;
  async function loadRegCredentialsIfChanged() {
    try {
      const info = await stat(regStatePath);
      if (info.mtimeMs > regStateMtimeMs) {
        const raw = await readFile(regStatePath, "utf8");
        const parsed = JSON.parse(raw);
        const nextMap = new Map();
        for (const item of parsed?.registeredAccounts || []) {
          if (item?.accountId && item?.email && item?.password) {
            nextMap.set(item.accountId, {
              username: String(item.email),
              password: String(item.password),
              uid: String(item.uid || ""),
            });
          }
        }
        regCredentialsById = nextMap;
        regStateMtimeMs = info.mtimeMs;
      }
    } catch {}
  }
  await loadRegCredentialsIfChanged();

  async function persistRegCredential(entry) {
    regCredentialsById.set(entry.accountId, {
      username: String(entry.email),
      password: String(entry.password),
      uid: String(entry.uid || ""),
    });
    try {
      let parsed = { lastIndex: 0, usedEmails: [], registeredAccounts: [] };
      try {
        parsed = JSON.parse(await readFile(regStatePath, "utf8"));
      } catch {}
      const list = Array.isArray(parsed.registeredAccounts) ? parsed.registeredAccounts : [];
      const idx = list.findIndex((item) => item.accountId === entry.accountId || item.email === entry.email);
      if (idx >= 0) list[idx] = { ...list[idx], ...entry };
      else list.push(entry);
      parsed.registeredAccounts = list;
      await writeFile(regStatePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      const info = await stat(regStatePath);
      regStateMtimeMs = info.mtimeMs;
    } catch {}
  }
  const followHistoryPath = join(dataDirectory, "follow-history.json");
  let followHistory = [];
  let followHistoryMtimeMs = 0;
  async function loadFollowHistoryIfChanged() {
    try {
      const info = await stat(followHistoryPath);
      if (info.mtimeMs > followHistoryMtimeMs) {
        const parsed = JSON.parse(await readFile(followHistoryPath, "utf8"));
        if (Array.isArray(parsed)) followHistory = parsed.slice(0, 100);
        followHistoryMtimeMs = info.mtimeMs;
      }
    } catch {}
  }
  await loadFollowHistoryIfChanged();

  async function appendFollowHistory(entry) {
    await loadFollowHistoryIfChanged();
    const now = new Date();
    const record = {
      time: now.toLocaleTimeString("vi-VN", { hour12: false }),
      createdAt: now.toISOString(),
      ...entry,
    };
    followHistory = [record, ...followHistory].slice(0, 100);
    try {
      await writeFile(followHistoryPath, `${JSON.stringify(followHistory, null, 2)}\n`, "utf8");
      const info = await stat(followHistoryPath);
      followHistoryMtimeMs = info.mtimeMs;
    } catch {}
    return record;
  }

  async function clearFollowHistory() {
    followHistory = [];
    try {
      await writeFile(followHistoryPath, "[]\n", "utf8");
      const info = await stat(followHistoryPath);
      followHistoryMtimeMs = info.mtimeMs;
    } catch {}
  }

  const followRun = {
    running: false,
    unfollow: false,
    targetUid: "",
    nickname: "",
    total: 0,
    completed: 0,
    successCount: 0,
    failureCount: 0,
    beforeFollowers: null,
    afterFollowers: null,
    startedAt: null,
    completedAt: null,
  };

const autoReg = {
  running: false,
  count: 0,
  completed: 0,
  currentStep: "",
  lastAccount: "",
  proxy: "geonode_qQ1uSovUZR:d708e8ff-7815-4838-926e-5c793216642f",
  startedAt: null,
  completedAt: null,
  error: "",
  proc: null,
};

function autoRegState() {
  return {
    running: autoReg.running,
    count: autoReg.count,
    completed: autoReg.completed,
    currentStep: autoReg.currentStep,
    lastAccount: autoReg.lastAccount,
    proxy: autoReg.proxy,
    startedAt: autoReg.startedAt,
    completedAt: autoReg.completedAt,
    error: autoReg.error,
  };
}

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
  // Room links of the running schedule slot; null sends to the Live screen's links.
  channelLinks: null,
};
// One account's send that takes longer than this counts as failed, so a stuck
// connection cannot hold a round (and with it the whole run) forever.
const SEND_TIMEOUT_MS = 45_000;
// After Dừng, the round in flight gets this long to finish before the run ends
// anyway; whatever it still has pending settles in the background.
const STOP_GRACE_MS = 1_500;
let bulkRunId = 0;
// Called once when Dừng is pressed (or the server closes) during a round.
const bulkStopListeners = new Set();
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
const viewbot = new ViewbotManager();
const hubs = new HubManager({ dataDirectory });
await hubs.init();
const telegram = new TelegramBoostManager({ dataDirectory });
const deployments = new Deployments({ viewbot, hubs, telegram });
const drafts = await new DraftStore({ dataDirectory }).init();
const realtime = new Realtime();

// 0 là giá trị hợp lệ (minAgeDays = 0), nên không dùng `|| fallback`
function numOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
const agentFilesDirectory = join(rootDirectory, "src", "viewbot");
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(compactJsonResponses());
// mọi thao tác ghi xong thì báo cho các thiết bị khác lấy dữ liệu mới
app.use("/api", (request, response, next) => {
  if (request.method !== "GET" && request.path !== "/drafts") {
    response.on("finish", () => {
      if (response.statusCode >= 400) return;
      const path = request.path;
      if (path.startsWith("/telegram")) realtime.invalidate("telegram", "telegramAccounts");
      else if (path.startsWith("/viewbot") || path.startsWith("/hubs")) realtime.invalidate("viewbot");
      else realtime.invalidate("state");
    });
  }
  next();
});
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
  await store.reloadIfChanged?.();
  await sessions.vault?.reloadIfChanged?.();
  await loadRegCredentialsIfChanged();
  await loadFollowHistoryIfChanged();
  let state = store.snapshot();
  const accountStatuses = await sessions.statuses(state.accounts);
  let renamed = false;
  for (const account of accountStatuses) {
    const detectedName = account.session?.identity?.displayName;
    const identitySource = account.session?.identity?.source;
    if (detectedName && identitySource !== "explicit_update" && detectedName !== account.profileName) {
      await store.updateAccountProfileName(account.id, detectedName);
      renamed = true;
    }
  }
  if (renamed) state = store.snapshot();
  const sessionsById = new Map(accountStatuses.map((account) => [account.id, account.session]));
  return {
    ...state,
    accounts: state.accounts.map((account) => ({
      ...account,
      session: sessionsById.get(account.id),
      loginInfo: regCredentialsById.get(account.id) || null,
    })),
    nextMessages: Object.fromEntries(PLATFORM_IDS.map((platform) => [platform, store.getNextMessage(platform)])),
    nextMessage: store.getNextMessage(state.settings.platform),
    cooldown: store.cooldown(),
    bulkSend: bulkSendState(),
    autoReg: autoRegState(),
    followRun: { ...followRun },
    followHistory: followHistory.slice(0, 50),
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

function withChannelLinks(state, channelLinks) {
  return channelLinks
    ? { ...state, settings: { ...state.settings, channelLinks } }
    : state;
}

// State as the current run sees it: a scheduled run may send to its own links.
function runSnapshot() {
  return withChannelLinks(store.snapshot(), bulkSend.running ? bulkSend.channelLinks : null);
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

function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

function notifyBulkStop() {
  for (const listener of [...bulkStopListeners]) listener();
}

// Resolves with the round's result, or null when Dừng is pressed and the round
// is still running after STOP_GRACE_MS.
function untilBulkStopped(round) {
  return new Promise((resolve, reject) => {
    let graceTimer = null;
    const onStop = () => {
      bulkStopListeners.delete(onStop);
      graceTimer = setTimeout(() => resolve(null), STOP_GRACE_MS);
    };
    bulkStopListeners.add(onStop);
    if (bulkSend.stopRequested) onStop();
    round.then(resolve, reject).finally(() => {
      bulkStopListeners.delete(onStop);
      clearTimeout(graceTimer);
    });
  });
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

async function updateAutomaticDisplayNames(accounts, isCurrent = () => true) {
  if (!store.shouldRename()) return null;
  const renameAccounts = [...new Map(
    accounts
      .filter((account) => RENAME_PLATFORMS.has(account.platform))
      .map((account) => [account.id, account]),
  ).values()];
  if (!renameAccounts.length) return null;
  if (bulkSend.running && !bulkSend.stopRequested) bulkSend.phase = "renaming";

  const results = [];
  const chosenNames = [];

  for (const account of renameAccounts) {
    if (!isCurrent()) break;
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

// isCurrent: false once the bulk run that started this round was stopped, so a
// round left to finish in the background does not start renaming accounts.
async function sendNextComment({ advanceOnTotalFailure = false, platforms = null, isCurrent = () => true } = {}) {
  const state = runSnapshot();
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

  const settled = await Promise.allSettled(selected.map(({ account, channelUrl, message }) => withTimeout(
    sessions.sendComment(account.id, {
      channelUrl,
      content: message.content,
    }, account.platform, account.proxy),
    SEND_TIMEOUT_MS,
    `Gửi quá ${SEND_TIMEOUT_MS / 1000} giây, đã bỏ qua lượt này.`,
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
  if (successfulRenameAccounts.length && store.shouldRename() && isCurrent()) {
    rename = await updateAutomaticDisplayNames(successfulRenameAccounts, isCurrent);
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
  for (const destination of destinationsWithMessages(runSnapshot(), platforms)) {
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
    const state = runSnapshot();
    return PLATFORM_IDS.filter((platform) => destinationsWithMessages(state, [platform]).length);
  }
  return PLATFORM_IDS.filter((platform) => (
    bulkSend.completedByPlatform[platform] < bulkSend.messageTotals[platform]
  ));
}

function startBulkRun(fields) {
  bulkRunId += 1;
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
    channelLinks: null,
    ...fields,
  });
  return runBulkSend();
}

function requestBulkStop() {
  if (!bulkSend.running) return;
  bulkSend.stopRequested = true;
  bulkSend.phase = "stopping";
  bulkSend.wakeWaiter?.();
  notifyBulkStop();
}

async function runBulkSend() {
  const runId = bulkRunId;
  const isCurrent = () => bulkSend.running && !bulkSend.stopRequested && runId === bulkRunId;
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
      const batch = await untilBulkStopped(
        sendNextComment({ advanceOnTotalFailure: true, platforms: roundPlatforms, isCurrent }),
      );
      if (!batch) break;
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
function isExternalOrAuthRequired(request) {
  if (requireAuth) return true;
  const host = String(request.headers?.host || "").toLowerCase();
  if (host && !host.startsWith("127.0.0.1") && !host.startsWith("localhost")) return true;
  if (request.headers?.["x-forwarded-for"] || request.headers?.["x-forwarded-host"]) return true;
  return false;
}

function setSessionCookie(response, token, request) {
  const isSecure = request.secure || String(request.headers?.["x-forwarded-proto"] || "").includes("https");
  const maxAge = 30 * 24 * 60 * 60;
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${isSecure ? "; Secure" : ""}`,
  );
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}

app.get("/api/auth/status", (request, response) => {
  const session = webAuth.extractRequestSession(request);
  const enforce = isExternalOrAuthRequired(request);
  response.json({
    authenticated: Boolean(session) || !enforce,
    requireAuth: enforce,
    username: session?.username || webAuth.username,
  });
});

app.post("/api/auth/login", (request, response) => {
  const clientIp = String(request.headers?.["x-forwarded-for"] || request.socket?.remoteAddress || "unknown").split(",")[0].trim();
  const { username, token } = webAuth.verifyCredentials(request.body?.username, request.body?.password, clientIp);
  setSessionCookie(response, token, request);
  response.json({ ok: true, authenticated: true, username, token });
});

app.post("/api/auth/logout", (_request, response) => {
  clearSessionCookie(response);
  response.json({ ok: true, authenticated: false });
});

// Hub agent tải code + lệnh cài từ master mà không có phiên web; bảo vệ bằng token hub.
const HUB_PUBLIC_PATHS = new Set([
  "/hubs/agent/files",
  "/hubs/agent/extract.js",
  "/hubs/install.sh",
  "/hubs/install.ps1",
  "/hubs/telegram/bundle",
]);

app.use("/api", (request, response, next) => {
  if (request.path === "/auth/login" || request.path === "/auth/status" || request.path === "/auth/logout") {
    return next();
  }
  if (HUB_PUBLIC_PATHS.has(request.path)) return next();
  if (!isExternalOrAuthRequired(request)) return next();
  const session = webAuth.extractRequestSession(request);
  if (!session) {
    return response.status(401).json({
      error: "Vui lòng đăng nhập để sử dụng công cụ.",
      code: "WEB_AUTH_REQUIRED",
    });
  }
  request.webSession = session;
  return next();
});

app.post("/api/auth/password", asyncRoute(async (request, response) => {
  const { username, token } = await webAuth.updateCredentials({
    currentPassword: request.body?.currentPassword,
    newUsername: request.body?.newUsername,
    newPassword: request.body?.newPassword,
  });
  setSessionCookie(response, token, request);
  response.json({ ok: true, username, token });
}));

app.get("/api/state", asyncRoute(async (_request, response) => {
  response.json(await dashboardState());
}));

/* ---------- Đồng bộ realtime giữa các thiết bị ---------- */

let lastAccountsRev = "";
let stateBuiltAt = 0;
realtime.register(
  "state",
  async () => {
    const full = await dashboardState();
    stateBuiltAt = Date.now();
    const rev = accountsRevision(full.accounts);
    if (rev !== lastAccountsRev) {
      lastAccountsRev = rev;
      realtime.publish("accounts", { rev, accounts: full.accounts });
    }
    return { ...full, accounts: undefined, accountsRev: rev };
  },
  {
    throttleMs: 200,
    liveEveryMs: 1500,
    // đang gửi/reg/follow thì cập nhật đều; bình thường vẫn làm mới mỗi 15s phòng dữ liệu đổi từ nơi khác
    liveWhile: () => bulkSend.running || autoReg.running || followRun.running || Date.now() - stateBuiltAt > 15000,
  },
);
realtime.register("viewbot", async () => ({ jobs: deployments.status(), hubs: hubs.list() }), {
  throttleMs: 300,
  liveEveryMs: 2000,
  liveWhile: () => deployments.hasRunning(),
});
realtime.register(
  "telegram",
  async () => ({ ...telegram.status(), messages: telegram.commentList(), hubTelegram: hubs.telegramStates() }),
  { throttleMs: 300, liveEveryMs: 3000, liveWhile: () => telegram.status().comments.running },
);
realtime.register(
  "telegramAccounts",
  async () => ({ accounts: telegram.listAccounts().map(publicTelegramAccount), dailyLimit: telegram.safety.dailyLimit }),
  { throttleMs: 1500 },
);
realtime.register("drafts", async () => drafts.snapshot());
hubs.onChange(() => realtime.invalidate("viewbot"));
telegram.onChange((kind) => {
  if (kind === "accounts") realtime.invalidate("telegramAccounts");
  else if (kind === "comments") realtime.invalidate("telegram");
  else realtime.invalidate("telegram", "viewbot");
});

function publicTelegramAccount(account) {
  return {
    phone: account.phone,
    name: account.name,
    username: account.username,
    ageDays: account.ageDays,
    joinsToday: account.joinsToday,
    commentsToday: account.commentsToday,
    cooldownUntil: account.cooldownUntil,
    dead: account.dead,
    hasSession: account.hasSession,
    hasJson: account.hasJson,
  };
}

app.get("/api/events", realtime.handler());

app.get("/api/drafts", (_request, response) => {
  response.json(drafts.snapshot());
});

app.put("/api/drafts", (request, response) => {
  const snapshot = drafts.patch(request.body?.values, request.body?.clientId);
  realtime.publish("drafts", snapshot);
  response.json({ rev: snapshot.rev });
});
app.post("/api/accounts", asyncRoute(async (request, response) => {
  if (rejectDuringBulk(response)) return;
  await store.addAccount(request.body?.name, request.body?.platform);
  response.status(201).json(await dashboardState());
}));
app.post("/api/accounts/bulk-toggle", asyncRoute(async (request, response) => {
  if (rejectDuringBulk(response)) return;
  await store.setAccountsEnabled({
    platform: request.body?.platform || null,
    enabled: request.body?.enabled !== false,
    accountIds: Array.isArray(request.body?.accountIds) ? request.body.accountIds : null,
  });
  response.json(await dashboardState());
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

function rejectRemoteBrowserAction(request, response) {
  const host = String(request.headers?.host || "").toLowerCase();
  const isLocalHost = !host || host.startsWith("127.0.0.1") || host.startsWith("localhost");
  const isProxied = Boolean(request.headers?.["x-forwarded-for"] || request.headers?.["x-forwarded-host"]);
  if (isLocalHost && !isProxied) return false;
  response.status(403).json({ error: "Chức năng mở Chrome chỉ khả dụng khi mở trực tiếp trên máy chủ (localhost)." });
  return true;
}

app.post("/api/accounts/:id/browser/open", asyncRoute(async (request, response) => {
  if (rejectRemoteBrowserAction(request, response)) return;
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
  if (rejectRemoteBrowserAction(request, response)) return;
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
  regCredentialsById.set(account.id, {
    username: String(usernameOrEmail).trim(),
    password: String(password),
    uid: String(sessions.vault.get(account.id)?.credentials?.uid || ""),
  });
  response.json(await dashboardState());
}));

app.post("/api/accounts/tokens/load", asyncRoute(async (request, response) => {
  if (rejectRemoteBrowserAction(request, response)) return;
  if (bulkSend.running) {
    return response.status(409).json({ error: "Hãy dừng lượt gửi trước khi nạp token." });
  }
  const accounts = store.snapshot().accounts.filter((account) => account.enabled);
  const result = await sessions.loadTokens(accounts, { onlyMissing: request.body?.onlyMissing !== false });
  response.json({ ...(await dashboardState()), tokenLoad: result });
}));

app.post("/api/accounts/:id/browser/profile", asyncRoute(async (request, response) => {
  if (rejectRemoteBrowserAction(request, response)) return;
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

app.post("/api/messages/shuffle", asyncRoute(async (request, response) => {
  if (rejectDuringBulk(response)) return;
  await store.shuffleMessages(request.body?.platform || request.query?.platform || null);
  response.json(await dashboardState());
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
async function validGoshCredentials(accountId) {
  const record = sessions.vault.get(accountId);
  const cred = record?.credentials;
  if (!cred?.token) return undefined;
  if (jwtExpiresWithin(cred.token, 60_000)) {
    const refreshed = await goshRefresh({ credentials: cred });
    await saveRefreshedGoshCredentials(accountId, refreshed);
    return refreshed;
  }
  return cred;
}

// The vault stores records ({ platform, source, credentials }), not bare
// credentials: a record without `credentials` reads as "no token".
function saveRefreshedGoshCredentials(accountId, credentials) {
  return sessions.vault.set(accountId, {
    ...sessions.vault.get(accountId),
    platform: "gosh",
    source: "token_refresh",
    credentials,
  });
}

async function firstGoshCredentials() {
  for (const acc of store.snapshot().accounts) {
    if (acc.platform !== "gosh") continue;
    try {
      const cred = await validGoshCredentials(acc.id);
      if (cred?.token) return cred;
    } catch {}
  }
  return undefined;
}

/* ---------- Tăng mắt xem livestream (qq88 / hi88) ---------- */

/* ---------- Tăng mắt livestream Telegram ---------- */

app.get("/api/telegram/accounts", (_request, response) => {
  response.json({ accounts: telegram.listAccounts(), status: telegram.status() });
});

app.post("/api/telegram/accounts/import", asyncRoute(async (request, response) => {
  const target = String(request.body?.path || "").trim();
  if (!target) return response.status(400).json({ error: "Thiếu đường dẫn file .zip hoặc thư mục tài khoản." });
  const accounts = target.toLowerCase().endsWith(".zip") ? await telegram.importZip(target) : telegram.importDirectory(target);
  response.json({ imported: accounts.length, accounts });
}));

app.post(
  "/api/telegram/accounts/upload",
  express.raw({ type: "application/zip", limit: "300mb" }),
  asyncRoute(async (request, response) => {
    if (!request.body?.length) return response.status(400).json({ error: "Không nhận được file zip." });
    const target = join(dataDirectory, "telegram-upload.zip");
    await writeFile(target, request.body);
    const accounts = await telegram.importZip(target);
    response.json({ imported: accounts.length, accounts });
  }),
);

app.get("/api/telegram/comments", (_request, response) => {
  response.json({ messages: telegram.commentList() });
});

app.post("/api/telegram/comments", (request, response) => {
  const messages = telegram.addComments(request.body?.text);
  response.json({ messages, count: messages.length });
});

app.delete("/api/telegram/comments/:index", (request, response) => {
  const messages = telegram.removeComment(request.params.index);
  response.json({ messages, count: messages.length });
});

app.post("/api/telegram/comments/clear", (_request, response) => {
  response.json({ messages: telegram.clearComments(), count: 0 });
});

app.post("/api/telegram/comments/shuffle", (_request, response) => {
  const messages = telegram.shuffleComments();
  response.json({ messages, count: messages.length });
});

app.post("/api/telegram/comments/start", asyncRoute(async (request, response) => {
  const body = request.body || {};
  if (!body.link) return response.status(400).json({ error: "Thiếu link kênh/nhóm Telegram." });
  const status = await telegram.startComments({
    link: String(body.link),
    perAccount: Number(body.perAccount) || 1,
    accountLimit: Number(body.accountLimit) || 10,
    dailyLimit: numOr(body.dailyLimit, 0),
    minAgeDays: numOr(body.minAgeDays, 0),
    sendDelayMin: Number(body.sendDelayMin) || 25,
    sendDelayMax: Number(body.sendDelayMax) || 90,
    concurrency: Number(body.concurrency) || 5,
    continuous: Boolean(body.continuous),
    roundDelay: Number(body.roundDelay) || 60,
  });
  response.json(status);
}));

app.get("/api/telegram/status", (_request, response) => {
  response.json({ ...telegram.status(), hubTelegram: hubs.telegramStates() });
});

app.post("/api/telegram/boost/start", asyncRoute(async (request, response) => {
  const body = request.body || {};
  if (!body.link) return response.status(400).json({ error: "Thiếu link livestream Telegram." });
  try {
    const result = await deployments.start({
      platform: "telegram",
      url: String(body.link),
      bots: Number(body.targetCount) || Number(body.limit) || 20,
      proxies: body.proxies,
      target: String(body.target || "main"),
      dailyLimit: body.dailyLimit,
      minAgeDays: body.minAgeDays,
      delayMin: body.delayMin,
      delayMax: body.delayMax,
      concurrency: body.concurrency,
    });
    response.json({ ...telegram.status(), jobs: result.jobs, note: result.note });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
}));

app.post("/api/telegram/boost/stop", (request, response) => {
  const hubId = String(request.body?.hubId || "");
  const mode = String(request.body?.mode || "view");
  const stoppedHub = hubId && mode === "view" ? hubs.stopTelegramJob(hubId) : false;
  response.json({ stopped: telegram.stop(mode) || stoppedHub, status: telegram.status() });
});

app.post("/api/telegram/check", asyncRoute(async (request, response) => {
  try {
    const info = await telegram.check(request.body?.link);
    response.json(info);
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
}));

app.post("/api/telegram/boost/adjust", (request, response) => {
  const target = Number(request.body?.target);
  if (!Number.isFinite(target)) return response.status(400).json({ error: "Thiếu số mắt cần đặt." });
  const hubId = String(request.body?.hubId || "");
  try {
    if (hubId) return response.json({ hubId, target: hubs.adjustTelegram(hubId, target) });
    return response.json({ target: telegram.adjust(target) });
  } catch (error) {
    return response.status(400).json({ error: error.message });
  }
});

/* ---------- Quản lý máy phụ (hub) ---------- */

function requestBaseUrl(request) {
  const forwarded = request.get("x-forwarded-proto");
  const proto = forwarded || request.protocol || "http";
  return `${proto}://${request.get("host")}`;
}

app.get("/api/hubs", (_request, response) => {
  response.json({ hubs: hubs.list() });
});

app.post("/api/hubs", asyncRoute(async (request, response) => {
  const created = await hubs.create({ name: request.body?.name });
  const baseUrl = requestBaseUrl(request);
  response.json({
    hub: created,
    install: hubInstallScripts({ baseUrl, token: created.token, name: created.name }),
  });
}));

app.delete("/api/hubs/:id", asyncRoute(async (request, response) => {
  response.json({ removed: await hubs.remove(request.params.id) });
}));

app.post("/api/hubs/:id/rotate", asyncRoute(async (request, response) => {
  const rotated = await hubs.rotate(request.params.id);
  response.json({
    hub: rotated,
    install: hubInstallScripts({ baseUrl: requestBaseUrl(request), token: rotated.token, name: request.params.id }),
  });
}));

app.get("/api/hubs/:id/install", (request, response) => {
  const hub = hubs.get(request.params.id);
  if (!hub) return response.status(404).json({ error: "Hub không tồn tại" });
  response.json({
    install: hubInstallScripts({ baseUrl: requestBaseUrl(request), token: hub.token, name: hub.name }),
  });
});

app.get("/api/hubs/agent/files", asyncRoute(async (_request, response) => {
  const read = (name) => readFile(join(agentFilesDirectory, name), "utf8");
  const [agent, manager, client, clientSignalr, clientHttp, platforms] = await Promise.all([
    read("agent.js"),
    read("manager.js"),
    read("client.js"),
    read("client-signalr.js"),
    read("client-http.js"),
    read("platforms.js"),
  ]);
  const packageJson = JSON.stringify(
    {
      name: "autolivecmt-hub-agent",
      version: "1.0.0",
      private: true,
      type: "module",
      dependencies: {
        "@microsoft/signalr": "^11.0.0",
        "@microsoft/signalr-protocol-msgpack": "^11.0.0",
        "@msgpack/msgpack": "^3.1.3",
        "https-proxy-agent": "^9.1.0",
        "socks-proxy-agent": "^10.1.0",
        ws: "^8.23.0",
      },
    },
    null,
    2,
  );
  response.json({
    files: {
      "package.json": packageJson,
      "agent.js": agent,
      "src/viewbot/manager.js": manager,
      "src/viewbot/client.js": client,
      "src/viewbot/client-signalr.js": clientSignalr,
      "src/viewbot/client-http.js": clientHttp,
      "src/viewbot/platforms.js": platforms,
    },
  });
}));

app.get("/api/hubs/telegram/bundle", asyncRoute(async (request, response) => {
  const token = String(request.query?.token || "");
  if (!hubs.hasToken(token)) return response.status(403).json({ error: "Token hub không hợp lệ" });
  const phones = String(request.query?.phones || "")
    .split(",")
    .map((phone) => phone.trim())
    .filter(Boolean);
  const base = join(dataDirectory, "telegram-accounts");
  const files = {};
  for (const folderName of phones) {
    if (folderName.includes("/") || folderName.includes("\\") || folderName.startsWith(".")) continue;
    const folder = join(base, folderName);
    let names = [];
    try {
      names = await readdir(folder);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!/\.(json|session|txt)$/i.test(name)) continue;
      try {
        const raw = await readFile(join(folder, name));
        files[`${folderName}/${name}`] = name.endsWith(".session")
          ? { encoding: "base64", data: raw.toString("base64") }
          : { encoding: "text", data: raw.toString("utf8") };
      } catch {
        // acc thiếu file thì bỏ qua
      }
    }
  }
  const script = await readFile(join(rootDirectory, "python", "telegram_boost.py"), "utf8");
  response.json({ script, files });
}));

app.get("/api/hubs/agent/extract.js", asyncRoute(async (_request, response) => {
  const source = await readFile(join(agentFilesDirectory, "extract.js"), "utf8");
  response.type("text/plain").send(source);
}));

app.get("/api/hubs/install.sh", (request, response) => {
  const token = String(request.query?.token || "");
  const name = String(request.query?.name || "hub");
  if (!hubs.hasToken(token)) {
    return response.status(403).type("text/plain").send("Token hub không hợp lệ.");
  }
  const baseUrl = requestBaseUrl(request);
  const script = `#!/bin/sh
set -e
TOKEN="${token}"
NAME="${name}"
MASTER="${baseUrl}"
command -v node >/dev/null 2>&1 || { echo "[hub] chưa có Node.js — cài Node 18+ rồi chạy lại."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "[hub] chưa có npm — cài kèm Node.js."; exit 1; }
DIR="$HOME/.autolivecmt-hub"
mkdir -p "$DIR"
cd "$DIR"
echo "[hub] tải agent từ $MASTER"
curl -fsSL "$MASTER/api/hubs/agent/files" -o files.json
curl -fsSL "$MASTER/api/hubs/agent/extract.js" -o extract.js
node extract.js
echo "[hub] cài thư viện (lần đầu ~30s)"
npm install --silent --no-audit --no-fund
if [ -f agent.pid ]; then
  OLD=$(cat agent.pid 2>/dev/null || true)
  if [ -n "$OLD" ] && kill -0 "$OLD" 2>/dev/null; then
    echo "[hub] dừng agent cũ (PID $OLD)"
    kill "$OLD" 2>/dev/null || true
    sleep 1
  fi
fi
echo "[hub] chạy nền, log: $DIR/agent.log"
nohup node agent.js --master "$MASTER" --token "$TOKEN" --name "$NAME" >> "$DIR/agent.log" 2>&1 &
echo $! > agent.pid
sleep 1
if kill -0 "$(cat agent.pid)" 2>/dev/null; then
  echo "[hub] agent đang chạy PID $(cat agent.pid) — đóng terminal vẫn chạy."
else
  echo "[hub] agent thoát ngay — xem $DIR/agent.log"
  exit 1
fi
`;
  response.type("text/plain").send(script);
});

app.get("/api/hubs/install.ps1", (request, response) => {
  const token = String(request.query?.token || "");
  const name = String(request.query?.name || "hub");
  if (!hubs.hasToken(token)) {
    return response.status(403).type("text/plain").send("Token hub không hợp lệ.");
  }
  const baseUrl = requestBaseUrl(request);
  const script = `$ErrorActionPreference = "Stop"
$master = "${baseUrl}"
$token = "${token}"
$name = "${name}"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Chưa có Node.js — cài Node 18+ rồi chạy lại." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "Chưa có npm — cài kèm Node.js." }
$dir = Join-Path $env:USERPROFILE ".autolivecmt-hub"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Set-Location $dir
Write-Host "[hub] tải agent từ $master"
Invoke-WebRequest -UseBasicParsing "$master/api/hubs/agent/files" -OutFile files.json
Invoke-WebRequest -UseBasicParsing "$master/api/hubs/agent/extract.js" -OutFile extract.js
node extract.js
if ($LASTEXITCODE -ne 0) { throw "Giải nén agent thất bại (mã $LASTEXITCODE)" }
Write-Host "[hub] cài thư viện (lần đầu ~30s)"
npm install --silent --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm install thất bại (mã $LASTEXITCODE)" }
$pidFile = Join-Path $dir "agent.pid"
if (Test-Path $pidFile) {
  $oldPid = Get-Content $pidFile -ErrorAction SilentlyContinue
  if ($oldPid) { Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue; Write-Host "[hub] dừng agent cũ (PID $oldPid)" }
}
$logFile = Join-Path $dir "agent.log"
$errFile = Join-Path $dir "agent.err.log"
$proc = Start-Process -FilePath "node" -ArgumentList @("agent.js","--master",$master,"--token",$token,"--name",$name) -WorkingDirectory $dir -WindowStyle Hidden -RedirectStandardOutput $logFile -RedirectStandardError $errFile -PassThru
$proc.Id | Out-File -Encoding ascii $pidFile
Start-Sleep -Seconds 2
if (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) {
  Write-Host "[hub] agent chạy nền PID $($proc.Id) — đóng cửa sổ này vẫn chạy. Log: $logFile"
} else {
  Write-Host "[hub] agent thoát ngay — xem $errFile"
}
`;
  response.type("text/plain").send(script);
});

app.get("/api/viewbot/platforms", (_request, response) => {
  response.json({ platforms: platformList() });
});

app.get("/api/viewbot/status", (_request, response) => {
  response.json({ jobs: deployments.status(), hubs: hubs.list() });
});

app.post("/api/viewbot/start", asyncRoute(async (request, response) => {
  const body = request.body || {};
  try {
    const targets = Array.isArray(body.targets) ? body.targets : undefined;
    if (String(body.platform || "") === "telegram") {
      const result = await deployments.start({
        platform: "telegram",
        url: String(body.url || "").trim(),
        bots: body.bots,
        proxies: body.proxies,
        target: body.target,
        targets,
        dailyLimit: body.dailyLimit,
        minAgeDays: body.minAgeDays,
        delayMin: body.delayMin,
        delayMax: body.delayMax,
        concurrency: body.concurrency,
      });
      realtime.invalidate("viewbot", "telegram", "telegramAccounts");
      return response.json({ jobs: result.jobs, mode: result.mode, note: result.note || "" });
    }
    const platform = resolvePlatform(body.platform, body.url);
    if (!platform) throw new Error("Nền tảng không hợp lệ (qq88 | hi88 | mb66 | coichua | telegram)");
    const room = String(body.hub || "").trim() || extractHub(body.url, platform);
    if (!room) throw new Error("Thiếu link live hoặc mã phòng (hub)");
    const result = await deployments.start({
      platform: platform.id,
      hub: room,
      bots: body.bots,
      ramp: body.ramp,
      proxies: body.proxies,
      target: body.target,
      targets,
    });
    response.json({ jobs: result.jobs, mode: result.mode, note: result.note || "" });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
}));

app.post("/api/viewbot/adjust", (request, response) => {
  const target = Number(request.body?.target);
  if (!Number.isFinite(target)) return response.status(400).json({ error: "Thiếu số mắt cần đặt." });
  try {
    response.json({ target: deployments.adjust(request.body?.id, target) });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});

app.post("/api/viewbot/stop", (request, response) => {
  const id = String(request.body?.id || "");
  response.json({ stopped: deployments.stop(id) });
});

app.post("/api/viewbot/stop-all", (_request, response) => {
  deployments.stopAll();
  response.json({ stopped: true });
});

app.post("/api/viewbot/proxies/check", asyncRoute(async (request, response) => {
  const proxies = request.body?.proxies;
  if (!proxies) return response.status(400).json({ error: "Thiếu danh sách proxy." });
  const result = await viewbot.checkProxies(proxies, {
    limit: Math.min(500, Number(request.body?.limit) || 200),
    repeat: Number(request.body?.repeat) || 0,
  });
  response.json(result);
}));

app.get("/api/viewbot/viewer", asyncRoute(async (request, response) => {
  const info = await viewbot.viewerCount(request.query?.platform, request.query?.hub);
  response.json(info);
}));

app.get("/api/viewbot/streams", asyncRoute(async (request, response) => {
  const streams = await viewbot.listStreams(request.query?.platform);
  response.json({ streams });
}));

app.get("/api/gosh/channel", asyncRoute(async (request, response) => {
  const targetUid = goshTargetUid(request.query?.target);
  if (!targetUid) {
    return response.status(400).json({ error: "URL hoặc ID kênh Gosh không hợp lệ." });
  }
  const profile = await goshChannelProfile(targetUid, { credentials: await firstGoshCredentials() });
  response.json({ channel: profile });
}));
app.post("/api/gosh/follow", asyncRoute(async (request, response) => {
  const state = store.snapshot();
  const rawTargets = request.body?.targets
    || (request.body?.target ? String(request.body.target).split(/\r?\n/) : state.settings.channelLinks?.gosh || []);
  const targetUids = [...new Set(
    (Array.isArray(rawTargets) ? rawTargets : [rawTargets])
      .map((item) => goshTargetUid(item))
      .filter(Boolean),
  )];
  if (!targetUids.length) {
    return response.status(400).json({ error: "Vui lòng nhập URL kênh Gosh hoặc ID/UID cần tăng follow." });
  }

  const scope = request.body?.scope === "enabled" ? "enabled" : "all";
  const allGoshAccounts = scope === "enabled"
    ? store.getEnabledAccounts("gosh")
    : state.accounts.filter((acc) => acc.platform === "gosh" && sessions.vault.get(acc.id)?.credentials);
  if (!allGoshAccounts.length) {
    return response.status(400).json({ error: "Không có tài khoản Gosh nào sẵn sàng để chạy." });
  }

  const requestedLimit = Number(request.body?.count);
  const selectedAccounts = Number.isInteger(requestedLimit) && requestedLimit > 0
    ? allGoshAccounts.slice(0, requestedLimit)
    : allGoshAccounts;
  const unfollow = Boolean(request.body?.unfollow);
  const rawConcurrency = Number(request.body?.concurrency);
  const concurrency = Number.isInteger(rawConcurrency) && rawConcurrency >= 1 && rawConcurrency <= 30
    ? rawConcurrency
    : 20;

  const targetReports = [];
  let totalSuccess = 0;
  let totalFailure = 0;

  followRun.running = true;
  followRun.unfollow = unfollow;
  followRun.total = selectedAccounts.length * targetUids.length;
  followRun.completed = 0;
  followRun.successCount = 0;
  followRun.failureCount = 0;
  followRun.startedAt = new Date().toISOString();
  followRun.completedAt = null;

  const probeCreds = await firstGoshCredentials();
  try {
    for (const rawTarget of targetUids) {
      const targetUid = (await resolveGoshTargetUid(rawTarget, { credentials: probeCreds })) || rawTarget;
      followRun.targetUid = targetUid;
      const beforeProfile = await goshChannelProfile(targetUid, { credentials: probeCreds }).catch(() => null);
      followRun.nickname = beforeProfile?.nickname || rawTarget;
      followRun.beforeFollowers = beforeProfile?.followerCount ?? null;
      followRun.afterFollowers = null;
      const results = [];
      for (let offset = 0; offset < selectedAccounts.length; offset += concurrency) {
        const batch = selectedAccounts.slice(offset, offset + concurrency);
        const batchResults = await Promise.all(batch.map(async (account) => {
          try {
            if (sessions.vault.get(account.id)?.credentials?.token && !sessions.sessions?.has(account.id)) {
              let cred = await validGoshCredentials(account.id);
              try {
                await goshFollowChannel(targetUid, { unfollow, credentials: cred });
              } catch (err) {
                if (err.code === "AUTH_EXPIRED" && cred) {
                  cred = await goshRefresh({ credentials: cred });
                  await saveRefreshedGoshCredentials(account.id, cred);
                  await goshFollowChannel(targetUid, { unfollow, credentials: cred });
                } else {
                  throw err;
                }
              }
            } else {
              await sessions.followChannel(account.id, targetUid, "gosh", account.proxy, { unfollow });
            }
            return { accountId: account.id, accountName: account.profileName || account.name, ok: true };
          } catch (error) {
            return { accountId: account.id, accountName: account.profileName || account.name, ok: false, error: error.message };
          }
        }));
        results.push(...batchResults);
        const batchSuccess = batchResults.filter((r) => r.ok).length;
        followRun.completed += batchResults.length;
        followRun.successCount += batchSuccess;
        followRun.failureCount += batchResults.length - batchSuccess;
      }
      const afterProfile = await goshChannelProfile(targetUid, { credentials: probeCreds }).catch(() => null);
      const successCount = results.filter((r) => r.ok).length;
      const failureCount = results.length - successCount;
      totalSuccess += successCount;
      totalFailure += failureCount;
      const nickname = afterProfile?.nickname || beforeProfile?.nickname || rawTarget;
      const beforeFollowers = beforeProfile?.followerCount ?? null;
      const afterFollowers = afterProfile?.followerCount ?? null;
      followRun.nickname = nickname;
      followRun.afterFollowers = afterFollowers;
      await appendFollowHistory({
        unfollow,
        targetUid,
        nickname,
        beforeFollowers,
        afterFollowers,
        successCount,
        total: selectedAccounts.length,
      });
      targetReports.push({
        targetUid,
        nickname,
        beforeFollowers,
        afterFollowers,
        successCount,
        failureCount,
        results,
      });
    }
  } finally {
    followRun.running = false;
    followRun.completedAt = new Date().toISOString();
  }

  response.json({
    followReport: {
      unfollow,
      accountCount: selectedAccounts.length,
      totalSuccess,
      totalFailure,
      targets: targetReports,
    },
    followHistory: followHistory.slice(0, 50),
  });
}));

app.delete("/api/gosh/follow/history", asyncRoute(async (_request, response) => {
  await clearFollowHistory();
  response.json({ followHistory: [] });
}));

function parseCredentialLines(rawText = "") {
  const entries = [];
  for (const rawLine of String(rawText || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let sepIdx = line.indexOf("|");
    if (sepIdx <= 0) sepIdx = line.indexOf("\t");
    if (sepIdx <= 0) sepIdx = line.indexOf(":");
    if (sepIdx <= 0) continue;
    const username = line.slice(0, sepIdx).trim();
    const password = line.slice(sepIdx + 1).trim();
    if (username && password) entries.push({ username, password });
  }
  return entries;
}

app.post("/api/gosh/import-login", asyncRoute(async (request, response) => {
  if (rejectDuringBulk(response)) return;
  const pairs = parseCredentialLines(request.body?.raw || "");
  if (!pairs.length) {
    return response.status(400).json({ error: "Vui lòng nhập ít nhất 1 dòng theo định dạng username|password." });
  }
  let added = 0;
  let updated = 0;
  const failed = [];
  const concurrency = 6;

  for (let offset = 0; offset < pairs.length; offset += concurrency) {
    const batch = pairs.slice(offset, offset + concurrency);
    const settled = await Promise.all(batch.map(async ({ username, password }) => {
      try {
        const loginRes = await goshLogin({ usernameOrEmail: username, password });
        return { ok: true, username, password, loginRes };
      } catch (error) {
        return { ok: false, username, error: error.message };
      }
    }));

    for (const item of settled) {
      if (!item.ok) {
        failed.push({ username: item.username, error: item.error });
        continue;
      }
      const { username, password, loginRes } = item;
      const { nickname, ...credentials } = loginRes;
      await store.reloadIfChanged?.();
      const currentAccounts = store.snapshot().accounts;
      let targetAcc = currentAccounts.find((acc) => (
        acc.platform === "gosh" && (
          regCredentialsById.get(acc.id)?.username?.toLowerCase() === username.toLowerCase()
          || sessions.vault.get(acc.id)?.credentials?.uid === credentials.uid
        )
      ));
      if (targetAcc) {
        if (nickname) await store.updateAccountProfileName(targetAcc.id, nickname);
        updated += 1;
      } else {
        let label = nickname || username.split("@")[0] || `gosh_${credentials.uid}`;
        try {
          targetAcc = await store.addAccount(label, "gosh");
        } catch {
          label = `${label.slice(0, 15)}_${Math.floor(100 + Math.random() * 899)}`;
          targetAcc = await store.addAccount(label, "gosh");
        }
        if (nickname) await store.updateAccountProfileName(targetAcc.id, nickname);
        added += 1;
      }
      await sessions.vault.set(targetAcc.id, {
        platform: "gosh",
        credentials,
        source: "api_login",
      });
      await persistRegCredential({
        accountId: targetAcc.id,
        email: username,
        nickname: nickname || targetAcc.name,
        password,
        uid: credentials.uid,
        createdAt: new Date().toISOString(),
      });
    }
  }

  response.json({
    ...(await dashboardState()),
    importReport: {
      total: pairs.length,
      added,
      updated,
      failed,
    },
  });
}));

function buildAutoRegProxyArgs(rawProxy = "") {
  const clean = String(rawProxy || "").trim();
  if (!clean) return [];
  try {
    if (/^https?:\/\//i.test(clean)) {
      const parsed = new URL(clean);
      const user = decodeURIComponent(parsed.username || "");
      const pass = decodeURIComponent(parsed.password || "");
      if (user.startsWith("geonode_")) {
        const baseUser = user.replace(/-session-[a-z0-9_-]+$/i, "");
        return [
          `--geonode=${baseUser}:${pass}`,
          `--geonode-host=${parsed.hostname}`,
          `--geonode-port=${parsed.port || "10000"}`,
        ];
      }
      return [`--proxy=${clean}`];
    }
  } catch {}
  if (clean.startsWith("geonode_") && clean.includes(":")) {
    const parts = clean.split(":");
    const baseUser = parts[0].replace(/-session-[a-z0-9_-]+$/i, "");
    const pass = parts[1];
    return [`--geonode=${baseUser}:${pass}`];
  }
  return [`--proxy=${clean}`];
}

app.post("/api/gosh/auto-reg/start", asyncRoute(async (request, response) => {
  if (autoReg.running) {
    return response.status(409).json({ error: "Tiến trình tự reg Gosh đang chạy." });
  }
  const count = Math.max(1, Math.min(2000, Number(request.body?.count) || 10));
  const rawProxy = String(request.body?.proxy ?? autoReg.proxy ?? "").trim();
  if (rawProxy) autoReg.proxy = rawProxy;

  const proxyArgs = buildAutoRegProxyArgs(autoReg.proxy);
  const scriptPath = join(rootDirectory, "src", "gosh-otp-reg.js");

  autoReg.running = true;
  autoReg.count = count;
  autoReg.completed = 0;
  autoReg.currentStep = `Đang khởi tạo tự reg ${count} tài khoản Gosh…`;
  autoReg.lastAccount = "";
  autoReg.startedAt = new Date().toISOString();
  autoReg.completedAt = null;
  autoReg.error = "";

  const proc = spawn(process.execPath, [scriptPath, "reg", `--count=${count}`, ...proxyArgs], {
    cwd: rootDirectory,
    stdio: ["ignore", "pipe", "pipe"],
  });
  autoReg.proc = proc;

  let buffer = "";
  const handleChunk = (chunk) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith(">>> [")) {
        autoReg.currentStep = line.replace(/^>>>\s*/, "");
      } else if (line.startsWith("⚡")) {
        autoReg.currentStep = line.replace(/^⚡\s*/, "");
      } else if (line.startsWith("✅ HOÀN TẤT")) {
        autoReg.completed += 1;
        const parts = line.split("|").map((s) => s.trim());
        if (parts[2]) autoReg.lastAccount = parts[2];
        autoReg.currentStep = `Đã tạo xong ${autoReg.completed}/${autoReg.count}: ${autoReg.lastAccount}`;
      } else if (line.startsWith("[WARN]")) {
        autoReg.currentStep = line.replace(/^\[WARN\]\s*/, "");
      } else if (line.startsWith("[FAIL]")) {
        autoReg.error = line.replace(/^\[FAIL\]\s*/, "");
      }
    }
  };

  proc.stdout.on("data", handleChunk);
  proc.stderr.on("data", handleChunk);
  proc.on("close", (code) => {
    autoReg.running = false;
    autoReg.proc = null;
    autoReg.completedAt = new Date().toISOString();
    if (code === 0) {
      autoReg.currentStep = `Đã hoàn tất đăng ký ${autoReg.completed}/${autoReg.count} tài khoản Gosh!`;
    } else if (!autoReg.error && code !== null) {
      autoReg.currentStep = `Đã dừng ở mốc ${autoReg.completed}/${autoReg.count} tài khoản.`;
    }
  });

  response.status(202).json(await dashboardState());
}));

app.post("/api/gosh/auto-reg/stop", asyncRoute(async (_request, response) => {
  if (autoReg.proc) {
    try {
      autoReg.proc.kill("SIGTERM");
    } catch {}
  }
  autoReg.running = false;
  autoReg.proc = null;
  autoReg.completedAt = new Date().toISOString();
  autoReg.currentStep = `Đã tạm dừng ở ${autoReg.completed}/${autoReg.count} tài khoản.`;
  response.json(await dashboardState());
}));

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
      // Picks up edits to the running slot's end time and room links.
      bulkSend.endsAt = occurrence.endAt.toISOString();
      bulkSend.channelLinks = slotChannelLinks(slot);
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
    const channelLinks = slotChannelLinks(slots.find((slot) => slot.id === active.slotId));
    const fields = scheduleRunFields(withChannelLinks(state, channelLinks));
    scheduler.error = "";
    void startBulkRun({
      ...fields,
      mode: "schedule",
      endsAt: active.endAt.toISOString(),
      scheduleSlotId: active.slotId,
      channelLinks,
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
    hubs,
    bulkSend,
    runScheduleTick,
    isBusy: () => Boolean(bulkSend.running || followRun.running || autoReg.running || manualSendRunning),
    realtime,
    close: async () => {
      clearInterval(scheduler.timer);
      realtime.close();
      await drafts.flush().catch(() => {});
      telegram.flushCooldown();
      viewbot.stopAll();
      hubs.stopAllJobs();
      telegram.stopAll();
      bulkSend.stopRequested = true;
      bulkSend.wakeWaiter?.();
      notifyBulkStop();
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
  requireAuth = false,
} = {}) {
  const { app, store, sessions, hubs, bulkSend, runScheduleTick, isBusy, realtime, close: closeSessions } = await createServerApp({
    dataDirectory,
    requireAuth,
  });

  return new Promise((resolvePromise, rejectPromise) => {
    const server = app.listen(port, host, () => {
      console.log(`Live Comment: http://${host}:${port}`);
      hubs.attach(server);
      resolvePromise({
        app,
        server,
        store,
        sessions,
        bulkSend,
        runScheduleTick,
        isBusy,
        hubs,
        close: async () => {
          hubs.close();
          realtime.close();
          server.closeIdleConnections?.();
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
  const instance = await startServer({
    requireAuth: process.env.ALC_REQUIRE_AUTH !== "0",
  });
  const shutdown = async () => {
    await instance.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Exiting on the memory limit only makes sense when launchd (KeepAlive) will
  // start the server again; anywhere else the guard just logs.
  const underLaunchd = /autolivecmtv2/i.test(process.env.XPC_SERVICE_NAME || "");
  const limitMb = Number(process.env.ALC_MEMORY_LIMIT_MB ?? 1024);
  startMemoryGuard({
    limitMb,
    isBusy: instance.isBusy,
    onLimit: underLaunchd ? shutdown : null,
    details: () => ({ sdkCopies: liveTencentChatCopies() }),
  });
}
