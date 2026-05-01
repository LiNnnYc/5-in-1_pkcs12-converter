import { app, BrowserWindow, Menu } from "electron";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { registerIpcHandlers } from "./ipc-handlers";
import { resolveWorkDir, resolveExeDir } from "./utils/path-resolver";
import { initLogger, createLogger, shutdownLogger } from "./utils/logger";
import { loadSettings } from "./services/settings-service";

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";

function createMainWindow(): BrowserWindow {
  // In dev mode the default Electron icon shows; packaged builds inherit the
  // .exe's embedded icon (set via electron-builder win.icon) automatically, so
  // we only set the runtime icon when not packaged.
  const devIcon = app.isPackaged
    ? undefined
    : join(__dirname, "..", "..", "build", "icon.ico");

  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    ...(devIcon ? { icon: devIcon } : {}),
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  if (app.isPackaged) {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  } else {
    void window.loadURL(VITE_DEV_SERVER_URL);
    window.webContents.openDevTools({ mode: "detach" });
  }

  return window;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const settings = loadSettings();
  initLogger({
    exeDir: resolveExeDir(),
    settingsEnabled: settings.logging.enabled,
    minLevel: settings.logging.level
  });
  const log = createLogger("app");
  log.info("ready", { packaged: app.isPackaged, platform: process.platform });
  registerIpcHandlers();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  const log = createLogger("app");
  try {
    rmSync(resolveWorkDir(), { recursive: true, force: true });
    log.info("will-quit: work dir removed");
  } catch {
    // Best-effort cleanup — nothing to do on failure.
  }
  shutdownLogger();
});

