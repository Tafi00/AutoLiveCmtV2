import { app, BrowserWindow, Menu, shell, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import { spawn } from "node:child_process";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = dirname(currentDirectory);
const port = 4317;
const appUrl = `http://127.0.0.1:${port}`;

let serverProcess = null;
let mainWindow = null;

function sendUpdaterStatus(status, details = {}) {
  mainWindow?.webContents.send("updater:status", { status, ...details });
}

async function checkForUpdates() {
  if (!app.isPackaged) return { status: "dev", message: "Bản chạy thử không kiểm tra cập nhật." };
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result?.updateInfo || result.updateInfo.version === app.getVersion()) {
      sendUpdaterStatus("up-to-date", { version: app.getVersion() });
      return { status: "up-to-date", version: app.getVersion() };
    }
    sendUpdaterStatus("available", { version: result.updateInfo.version });
    return { status: "available", version: result.updateInfo.version };
  } catch (error) {
    sendUpdaterStatus("error", { message: error.message });
    return { status: "error", message: error.message };
  }
}

ipcMain.handle("updater:check", checkForUpdates);
ipcMain.handle("updater:download", async () => {
  try { await autoUpdater.downloadUpdate(); return { status: "downloaded" }; }
  catch (error) { sendUpdaterStatus("error", { message: error.message }); return { status: "error", message: error.message }; }
});
ipcMain.handle("updater:install", () => { autoUpdater.quitAndInstall(); return { status: "installing" }; });

autoUpdater.autoDownload = false;
autoUpdater.on("update-available", (info) => sendUpdaterStatus("available", { version: info.version }));
autoUpdater.on("update-not-available", () => sendUpdaterStatus("up-to-date", { version: app.getVersion() }));
autoUpdater.on("download-progress", (progress) => sendUpdaterStatus("downloading", { percent: Math.round(progress.percent) }));
autoUpdater.on("update-downloaded", (info) => sendUpdaterStatus("downloaded", { version: info.version }));
autoUpdater.on("error", (error) => sendUpdaterStatus("error", { message: error.message }));

function stopServer() {
  if (!serverProcess) return;
  serverProcess.kill("SIGTERM");
  serverProcess = null;
}

function waitForServer(attempts = 80) {
  return new Promise((resolve, reject) => {
    const check = (remaining) => {
      const request = http.get(`${appUrl}/api/state`, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) return resolve();
        retry(remaining);
      });
      request.on("error", () => retry(remaining));
      request.setTimeout(500, () => request.destroy());
    };

    const retry = (remaining) => {
      if (remaining <= 0) return reject(new Error("Không thể khởi động dịch vụ cục bộ."));
      setTimeout(() => check(remaining - 1), 125);
    };

    check(attempts);
  });
}

function startServer() {
  serverProcess = spawn(process.execPath, [join(currentDirectory, "server.js")], {
    cwd: rootDirectory,
    env: {
      ...process.env,
      PORT: String(port),
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: "inherit",
  });

  serverProcess.once("exit", (code) => {
    serverProcess = null;
    if (code && !app.isQuitting) app.quit();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 760,
    minHeight: 620,
    show: false,
    title: "Live Comment",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0f1012",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(currentDirectory, "preload.cjs"),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });
  await mainWindow.loadURL(appUrl);
}

app.isQuitting = false;
app.on("before-quit", () => {
  app.isQuitting = true;
  stopServer();
});

process.once("SIGINT", () => {
  stopServer();
  app.quit();
});

process.once("SIGTERM", () => {
  stopServer();
  app.quit();
});

process.once("exit", stopServer);

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  startServer();
  await waitForServer();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
