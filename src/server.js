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
    nextMessage: store.getNextMessage(),
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
  if (bulkSend.running) bulkSend.phase = "renaming";

  const results = [];
  const chosenNames = [];

  for (const account of accounts) {
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

let accountCursor = 0;

async function sendNextComment() {
  const state = store.snapshot();
  const accounts = store.getEnabledAccounts(state.settings.platform);
  const message = store.getNextMessage();
  if (!message) throw new Error("Kho bình luận đang trống.");
  if (!state.settings.channelUrl) throw new Error("Hãy lưu URL phòng live trước.");
  if (!accounts.length) throw new Error("Cần bật ít nhất một tài khoản để gửi.");

  const account = accounts[accountCursor % accounts.length];
  accountCursor++;

  const accountName = account.profileName || account.name;
  let result;
  try {
    result = await sessions.sendComment(account.id, {
      channelUrl: state.settings.channelUrl,
      content: message.content,
    }, account.platform);
  } catch (error) {
    throw new Error(`${accountName}: ${error.message || "Không thể gửi bình luận."}`);
  }

  await store.markSent();

  let rename = null;
  if (store.shouldRename()) {
    rename = await updateAutomaticDisplayNames([account]);
  }

  return {
    message,
    account: { id: account.id, name: accountName },
    result,
    rename,
    successCount: 1,
    failureCount: 0,
    totalAccounts: accounts.length,
  };
}

async function runBulkSend() {
  try {
    let bulkAccountCursor = 0;
    while (!bulkSend.stopRequested && bulkSend.completedMessages < bulkSend.totalMessages) {
      const cooldown = store.cooldown();
      if (!cooldown.ready) {
        bulkSend.phase = "waiting";
        bulkSend.currentAccount = "";
        await waitForBulk(cooldown.remainingSeconds * 1000);
        if (bulkSend.stopRequested) break;
      }

      const state = store.snapshot();
      const accounts = store.getEnabledAccounts(state.settings.platform);
      if (!accounts.length) throw new Error("Cần bật ít nhất một tài khoản.");
      const message = store.getNextMessage();
      if (!message) break;

      const account = accounts[bulkAccountCursor % accounts.length];
      bulkAccountCursor++;
      const accountName = account.profileName || account.name;

      bulkSend.phase = "sending";
      bulkSend.currentAccount = accountName;

      try {
        await sessions.sendComment(account.id, {
          channelUrl: state.settings.channelUrl,
          content: message.content,
        }, account.platform);

        await store.markSent();
        bulkSend.sent += 1;
        bulkSend.completedMessages += 1;

        if (store.shouldRename()) {
          bulkSend.phase = "renaming";
          await updateAutomaticDisplayNames([account]);
        }
      } catch (error) {
        bulkSend.failed += 1;
        bulkSend.failures.push({
          accountId: account.id,
          accountName,
          message: message.content,
          error: error.message || "Không thể gửi bình luận.",
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
  const targetUrl = state.settings.platform === account.platform
    ? request.body?.targetUrl || state.settings.channelUrl || undefined
    : undefined;
  const session = await sessions.openForManualLogin(account.id, targetUrl, account.platform, { autoCloseOnLogin: false });
  response.json({ account: { ...account, session } });
}));

app.post("/api/accounts/:id/browser/login", asyncRoute(async (request, response) => {
  if (bulkSend.running) {
    return response.status(409).json({ error: "Hãy dừng lượt gửi trước khi đăng nhập." });
  }
  const account = accountOrThrow(request.params.id);
  const state = store.snapshot();
  const targetUrl = state.settings.platform === account.platform
    ? request.body?.targetUrl || state.settings.channelUrl || undefined
    : undefined;
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
  const targetUrl = request.body?.targetUrl || store.snapshot().settings.channelUrl || undefined;
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
    await store.addMessage(request.body?.content ?? request.body?.messages);
    response.status(201).json(await dashboardState());
  }));

app.delete("/api/messages/:id", asyncRoute(async (request, response) => {
  if (rejectDuringBulk(response)) return;
  const deleted = await store.deleteMessage(request.params.id);
  if (!deleted) return response.status(404).json({ error: "Không tìm thấy bình luận." });
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
  apiHealth = await checkApiHealth(store.snapshot().settings.channelUrl);
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
  if (!store.getNextMessage()) return response.status(400).json({ error: "Kho bình luận đang trống." });
  if (!state.settings.channelUrl) {
    return response.status(400).json({ error: "Hãy lưu URL phòng live trước." });
  }

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
  const accounts = store.getEnabledAccounts(state.settings.platform);
  if (!state.messages.length) return response.status(400).json({ error: "Kho bình luận đang trống." });
  if (!state.settings.channelUrl) {
    return response.status(400).json({ error: "Hãy lưu URL phòng live trước." });
  }
  if (!accounts.length) return response.status(400).json({ error: "Cần bật ít nhất một tài khoản." });

  Object.assign(bulkSend, {
    running: true,
    stopRequested: false,
    total: state.messages.length,
    sent: 0,
    failed: 0,
    totalMessages: state.messages.length,
    completedMessages: 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    failures: [],
    currentAccount: "",
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
