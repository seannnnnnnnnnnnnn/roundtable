import { pathToFileURL } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  shell
} from "electron";
import updaterPackage from "electron-updater";

const { autoUpdater } = updaterPackage;
const API_PORT = 18787;
const API_URL = `http://127.0.0.1:${API_PORT}`;
const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RELEASES_URL =
  "https://github.com/seannnnnnnnnnnnnn/roundtable/releases/latest";
let mainWindow = null;
let updateTimer = null;
let automaticInstallAvailable = false;
let updateState = {
  status: "idle",
  message: "启动后自动检查更新",
  version: app.getVersion(),
  progress: 0,
  availableVersion: "",
  automaticInstallAvailable: false,
  manualUrl: RELEASES_URL
};

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function resourcePath(...segments) {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...segments)
    : path.join(app.getAppPath(), ...segments);
}

function configureRuntime() {
  const userData = app.getPath("userData");
  process.env.API_PORT = String(API_PORT);
  process.env.ROUND_TABLE_APP_VERSION = app.getVersion();
  process.env.ROUND_TABLE_DATA_DIR = path.join(userData, "data");
  process.env.ROUND_TABLE_ENV_PATH = path.join(userData, ".env");
  process.env.ROUND_TABLE_STATIC_DIR = resourcePath(app.isPackaged ? "web" : "dist");
  process.env.ROUND_TABLE_ROLE_DIR = resourcePath(
    app.isPackaged ? "roles" : "server/prompts/roles"
  );
}

async function startLocalService() {
  configureRuntime();
  const serverEntry = path.join(app.getAppPath(), "dist-server/index.js");
  await import(pathToFileURL(serverEntry).href);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${API_URL}/api/health`);
      if (response.ok) return;
    } catch {
      // The local API is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("本地服务启动超时。");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 930,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#080A0D",
    title: "Roundtable",
    icon: app.isPackaged
      ? resourcePath("icon/roundtable-icon.png")
      : path.join(app.getAppPath(), "build/assets/roundtable-icon.png"),
    show: false,
    webPreferences: {
      preload: path.join(app.getAppPath(), "desktop/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadURL(API_URL);
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function broadcastUpdate(next) {
  updateState = { ...updateState, ...next };
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("desktop:update-status", updateState);
  }
}

function hasDeveloperIdSignature() {
  if (process.platform !== "darwin" || !app.isPackaged) return false;
  const appBundle = path.resolve(process.execPath, "../../..");
  const result = spawnSync(
    "/usr/bin/codesign",
    ["-dv", "--verbose=4", appBundle],
    { encoding: "utf8" }
  );
  const details = `${result.stdout || ""}\n${result.stderr || ""}`;
  return /Authority=Developer ID Application:/.test(details);
}

function setupUpdater() {
  if (!app.isPackaged) {
    broadcastUpdate({
      status: "development",
      message: "开发环境不会连接正式更新通道"
    });
    return;
  }

  automaticInstallAvailable = hasDeveloperIdSignature();
  broadcastUpdate({ automaticInstallAvailable });
  autoUpdater.autoDownload = automaticInstallAvailable;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {}
  };

  autoUpdater.on("checking-for-update", () => {
    broadcastUpdate({ status: "checking", message: "正在检查 GitHub Releases…" });
  });
  autoUpdater.on("update-not-available", () => {
    broadcastUpdate({
      status: "current",
      message: "当前已是最新版本",
      progress: 0,
      availableVersion: ""
    });
  });
  autoUpdater.on("update-available", (info) => {
    if (!automaticInstallAvailable) {
      broadcastUpdate({
        status: "manual",
        message: `发现 ${info.version}。当前版本未完成 Apple 公证，请下载安装包更新。`,
        availableVersion: info.version,
        progress: 0
      });
      return;
    }
    broadcastUpdate({
      status: "downloading",
      message: `发现 ${info.version}，正在后台下载`,
      availableVersion: info.version,
      progress: 0
    });
    if (Notification.isSupported()) {
      new Notification({
        title: "Roundtable 有新版本",
        body: `版本 ${info.version} 正在后台下载`
      }).show();
    }
  });
  autoUpdater.on("download-progress", (progress) => {
    broadcastUpdate({
      status: "downloading",
      message: `正在下载 ${Math.round(progress.percent)}%`,
      progress: Math.round(progress.percent)
    });
  });
  autoUpdater.on("update-downloaded", async (info) => {
    broadcastUpdate({
      status: "ready",
      message: `版本 ${info.version} 已下载，重启后安装`,
      availableVersion: info.version,
      progress: 100
    });
    const result = await dialog.showMessageBox({
      type: "info",
      buttons: ["立即重启并更新", "稍后"],
      defaultId: 0,
      cancelId: 1,
      title: "更新已准备好",
      message: `Roundtable ${info.version} 已下载完成`,
      detail: "立即重启后会自动完成安装。"
    });
    if (result.response === 0) autoUpdater.quitAndInstall(false, true);
  });
  autoUpdater.on("error", (error) => {
    broadcastUpdate({
      status: "error",
      message: friendlyUpdateError(error),
      progress: 0
    });
  });

  setTimeout(() => void checkForUpdates(), 5000);
  updateTimer = setInterval(() => void checkForUpdates(), UPDATE_INTERVAL_MS);
}

async function checkForUpdates() {
  if (!app.isPackaged) return updateState;
  try {
    await autoUpdater.checkForUpdatesAndNotify();
  } catch (error) {
    broadcastUpdate({
      status: "error",
      message: friendlyUpdateError(error)
    });
  }
  return updateState;
}

function friendlyUpdateError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/\b404\b/.test(message)) {
    return "暂未找到公开版本；发布首个 Release 后自动启用。";
  }
  if (/network|ENOTFOUND|ECONN|timed? ?out/i.test(message)) {
    return "暂时无法连接更新服务，请检查网络后重试。";
  }
  return "更新服务暂时不可用，请稍后重试。";
}

async function openUpdatePage() {
  await shell.openExternal(RELEASES_URL);
  return true;
}

function installUpdate() {
  if (updateState.status !== "ready") return false;
  autoUpdater.quitAndInstall(false, true);
  return true;
}

function buildApplicationMenu() {
  const template = [
    {
      label: "Roundtable",
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "检查更新…",
          click: () => void checkForUpdates()
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { role: "front" }
      ]
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "查看开源项目",
          click: () =>
            void shell.openExternal(
              "https://github.com/seannnnnnnnnnnnnn/roundtable"
            )
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("desktop:get-info", () => ({
  isDesktop: true,
  isPackaged: app.isPackaged,
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  update: updateState
}));
ipcMain.handle("desktop:check-update", checkForUpdates);
ipcMain.handle("desktop:install-update", installUpdate);
ipcMain.handle("desktop:open-update-page", openUpdatePage);

app.whenReady().then(async () => {
  try {
    buildApplicationMenu();
    await startLocalService();
    createWindow();
    setupUpdater();
  } catch (error) {
    await dialog.showErrorBox(
      "Roundtable 启动失败",
      error instanceof Error ? error.message : "未知错误"
    );
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("before-quit", () => {
  if (updateTimer) clearInterval(updateTimer);
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
