import { app, BrowserWindow, Menu, shell, ipcMain } from "electron";
import electronUpdaterPkg from "electron-updater";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./server.js";

const autoUpdater = electronUpdaterPkg.autoUpdater ?? electronUpdaterPkg.default?.autoUpdater ?? electronUpdaterPkg;

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const rootDirectory = dirname(currentDirectory);
const port = 4317;
const appUrl = `http://127.0.0.1:${port}`;

let serverInstance = null;
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

async function stopServer() {
  if (!serverInstance) return;
  const instance = serverInstance;
  serverInstance = null;
  try {
    await instance.close();
  } catch (error) {
    console.error("Lỗi khi dừng server:", error);
  }
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
  void stopServer();
});

process.once("SIGINT", () => {
  void stopServer().finally(() => app.quit());
});

process.once("SIGTERM", () => {
  void stopServer().finally(() => app.quit());
});

process.once("exit", () => {
  void stopServer();
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const dataDirectory = app.isPackaged
    ? join(app.getPath("userData"), "data")
    : join(rootDirectory, "data");

  serverInstance = await startServer({ port, dataDirectory });
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
