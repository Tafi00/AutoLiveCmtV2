import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { AccountSessionManager } from "./session-manager.js";
import { JsonStore } from "./store.js";
import { checkApiHealth, healthTargets } from "./api-health.js";
import { PLATFORMS } from "./platforms.js";
import { discoveredApiEndpoints } from "./browser-session.js";

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
  linkTotals: { gosh: 0, loco: 0 },
  messageTotals: { gosh: 0, loco: 0 },
  completedByPlatform: { gosh: 0, loco: 0 },
  phase: "idle",
  wakeWaiter: null,
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
    nextMessages: {
      gosh: store.getNextMessage("gosh"),
      loco: store.getNextMessage("loco"),
    },
    nextMessage: store.getNextMessage(state.settings.platform),
    cooldown: store.cooldown(),
    bulkSend: bulkSendState(),
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
  const requestedPlatforms = platforms || Object.keys(PLATFORMS);
  const destinations = availableDestinations(state)
    .filter(({ platform }) => requestedPlatforms.includes(platform));
  if (destinations.length && !requireMessages) return destinations;
  if (destinations.length) {
    const withMessages = destinationsWithMessages(state, requestedPlatforms);
    if (withMessages.length) return withMessages;
    throw new Error("Kho bình luận của website đang hoạt động đang trống.");
  }
  const hasRoom = requestedPlatforms.some((platform) => channelLinksForPlatform(state, platform).length);
  if (!hasRoom) throw new Error("Hãy lưu URL phòng live cho Gosh hoặc Loco trước.");
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
  if (account.platform !== "gosh") {
    const error = new Error("Chức năng đổi tên chỉ áp dụng cho tài khoản Gosh.");
    error.status = 400;
    throw error;
  }
  if (displayNameUpdates.has(accountId)) {
    throw new Error("Tài khoản này đang được đổi tên.");
  }
  displayNameUpdates.add(accountId);
  try {
    const result = await sessions.updateDisplayName(accountId, displayName, account.platform);
    await store.updateAccountProfileName(accountId, result.displayName);
    return result;
  } finally {
    displayNameUpdates.delete(accountId);
  }
}

async function updateAutomaticDisplayNames(accounts) {
  if (!store.shouldRename()) return null;
  const goshAccounts = [...new Map(
    accounts
      .filter((account) => account.platform === "gosh")
      .map((account) => [account.id, account]),
  ).values()];
  if (!goshAccounts.length) return null;
  if (bulkSend.running) bulkSend.phase = "renaming";

  const results = [];
  const chosenNames = [];

  for (const account of goshAccounts) {
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
    }, account.platform)
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
    countForRename: successes.some((result) => result.platform === "gosh"),
  });

  let rename = null;
  const successfulGoshAccounts = selected
    .filter(({ account, platform }) => successes.some((result) => result.accountId === account.id && result.platform === platform && platform === "gosh"))
    .map(({ account }) => account);
  if (successfulGoshAccounts.length && store.shouldRename()) {
    rename = await updateAutomaticDisplayNames(successfulGoshAccounts);
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

async function runBulkSend() {
  try {
    while (!bulkSend.stopRequested && bulkSend.completedMessages < bulkSend.totalMessages) {
      const cooldown = store.cooldown();
      if (!cooldown.ready) {
        bulkSend.phase = "waiting";
        bulkSend.currentAccount = "";
        await waitForBulk(cooldown.remainingSeconds * 1000);
        if (bulkSend.stopRequested) break;
      }

      const roundPlatforms = Object.keys(PLATFORMS).filter((platform) => (
        bulkSend.completedByPlatform[platform] < bulkSend.messageTotals[platform]
      ));
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
  const session = await sessions.openForManualLogin(account.id, targetUrl, account.platform, { autoCloseOnLogin: false });
  response.json({ account: { ...account, session } });
}));

app.post("/api/accounts/:id/browser/login", asyncRoute(async (request, response) => {
  if (bulkSend.running) {
    return response.status(409).json({ error: "Hãy dừng lượt gửi trước khi đăng nhập." });
  }
  const account = accountOrThrow(request.params.id);
  const state = store.snapshot();
  const targetUrl = request.body?.targetUrl || channelUrlForPlatform(state, account.platform) || undefined;
  const session = await sessions.openForManualLogin(account.id, targetUrl, account.platform, { autoCloseOnLogin: true });
  response.json({ account: { ...account, session } });
}));

app.post("/api/accounts/:id/browser/profile", asyncRoute(async (request, response) => {
  if (bulkSend.running) {
    return response.status(409).json({ error: "Hãy dừng lượt gửi trước khi mở hồ sơ." });
  }
  const account = accountOrThrow(request.params.id);
  const session = await sessions.openProfile(account.id, account.platform, { autoCloseOnLogin: false });
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
  response.json({ browser: await sessions.open(account.id, targetUrl, account.platform) });
}));

app.post("/api/browser/profile", asyncRoute(async (_request, response) => {
  const account = store.getEnabledAccounts(store.snapshot().settings.platform)[0];
  if (!account) return response.status(400).json({ error: "Cần bật ít nhất một tài khoản." });
  response.json({ browser: await sessions.openProfile(account.id, account.platform) });
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
  const messageTotals = Object.fromEntries(Object.keys(PLATFORMS).map((platform) => [
    platform,
    available.some((destination) => destination.platform === platform) ? store.getMessages(platform).length : 0,
  ]));
  const linkTotals = Object.fromEntries(Object.keys(PLATFORMS).map((platform) => [
    platform,
    available.filter((destination) => destination.platform === platform).length,
  ]));
  const totalMessages = Object.keys(PLATFORMS).reduce(
    (sum, platform) => sum + messageTotals[platform] * linkTotals[platform],
    0,
  );
  const roundCount = Math.max(...Object.values(messageTotals), 0);
  if (!totalMessages) return response.status(400).json({ error: "Kho bình luận của Gosh và Loco đang trống." });
  const destinations = available.filter(({ platform }) => messageTotals[platform] > 0);

  Object.assign(bulkSend, {
    running: true,
    stopRequested: false,
    total: totalMessages,
    sent: 0,
    failed: 0,
    totalMessages: roundCount,
    completedMessages: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    failures: [],
    currentAccount: "",
    activePlatforms: [...new Set(destinations.map(({ platform }) => platform))],
    linkTotals,
    messageTotals,
    completedByPlatform: { gosh: 0, loco: 0 },
    phase: "starting",
    wakeWaiter: null,
  });
  void runBulkSend();
  response.status(202).json(await dashboardState());
}));

app.post("/api/comments/send-all/stop", asyncRoute(async (_request, response) => {
  if (bulkSend.running) {
    bulkSend.stopRequested = true;
    bulkSend.phase = "stopping";
    bulkSend.wakeWaiter?.();
  }
  response.json(await dashboardState());
}));

  app.use((error, _request, response, _next) => {
    const status = error.status || (error.code === "LOGIN_REQUIRED" ? 401 : 400);
    response.status(status).json({ error: error.message || "Đã có lỗi xảy ra." });
  });

  return {
    app,
    store,
    sessions,
    bulkSend,
    close: async () => {
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
  const { app, store, sessions, bulkSend, close: closeSessions } = await createServerApp({ dataDirectory });

  return new Promise((resolvePromise, rejectPromise) => {
    const server = app.listen(port, host, () => {
      console.log(`Live Comment: http://${host}:${port}`);
      resolvePromise({
        app,
        server,
        store,
        sessions,
        bulkSend,
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
