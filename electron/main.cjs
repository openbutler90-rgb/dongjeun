const { app, BrowserWindow, Menu, shell, globalShortcut } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const PORT = Number(process.env.DONGJEON_PORT || process.env.PORT || 3000);
const HOST = process.env.DONGJEON_HOST || "localhost";
const APP_URL = `http://${HOST}:${PORT}`;
const ICON_PATH = path.join(ROOT_DIR, "electron", "assets", "dongjeoncoffee-app.ico");

let mainWindow = null;
let serverProcess = null;
let shouldQuit = false;

function canReachServer(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(url, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await canReachServer(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function ensureLocalServer() {
  if (await canReachServer(APP_URL)) return;

  const serverEntry = path.join(ROOT_DIR, "dist", "server.cjs");
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Local server bundle is missing: ${serverEntry}. Run npm run build first.`);
  }

  const logDir = path.join(ROOT_DIR, ".codex-logs");
  fs.mkdirSync(logDir, { recursive: true });
  const out = fs.openSync(path.join(logDir, "electron-server.out.log"), "a");
  const err = fs.openSync(path.join(logDir, "electron-server.err.log"), "a");

  serverProcess = spawn(process.execPath, [path.join(ROOT_DIR, "dist", "server.cjs")], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(PORT),
      DONGJEON_ELECTRON: "1",
    },
    windowsHide: true,
    stdio: ["ignore", out, err],
  });

  serverProcess.on("exit", (code, signal) => {
    const line = `[${new Date().toISOString()}] local server exited code=${code} signal=${signal}\n`;
    try {
      fs.appendFileSync(path.join(logDir, "electron-server.err.log"), line);
    } catch {
      // ignore logging failure during shutdown
    }
    serverProcess = null;
  });

  const ready = await waitForServer(APP_URL);
  if (!ready) {
    throw new Error(`Local server did not start: ${APP_URL}`);
  }
}

function createWindow() {
  Menu.setApplicationMenu(null);
  app.setAppUserModelId("com.dongjeoncoffee.operator");

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: "동전커피 운영자",
    icon: ICON_PATH,
    backgroundColor: "#f7f8fb",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  const isAllowedInAppUrl = (url) => {
    if (url.startsWith(APP_URL)) return true;
    if (url.startsWith(`http://127.0.0.1:${PORT}`)) return true;
    try {
      const parsed = new URL(url);
      return (
        parsed.hostname === "accounts.google.com" ||
        parsed.hostname === "dongjeun-c840a.firebaseapp.com"
      );
    } catch {
      return false;
    }
  };

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedInAppUrl(url)) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedInAppUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // ✅ F5 새로고침 단축키 등록
  globalShortcut.register('F5', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload();
    }
  });

  // ✅ 우클릭 컨텍스트 메뉴 (새로고침 / 개발자도구)
  const contextMenu = Menu.buildFromTemplate([
    { label: '새로고침 (F5)', click: () => mainWindow.webContents.reload() },
    { type: 'separator' },
    { label: '뒤로 가기', click: () => mainWindow.webContents.goBack(), enabled: mainWindow.webContents.canGoBack() },
    { label: '앞으로 가기', click: () => mainWindow.webContents.goForward(), enabled: mainWindow.webContents.canGoForward() },
    { type: 'separator' },
    { label: '개발자 도구', click: () => mainWindow.webContents.openDevTools() },
  ]);
  mainWindow.webContents.on('context-menu', (e, params) => {
    contextMenu.popup();
  });

  mainWindow.loadURL(APP_URL);
}

function stopLocalServer() {
  if (!serverProcess || serverProcess.killed) return;
  serverProcess.kill();
  serverProcess = null;
}

app.whenReady().then(async () => {
  try {
    await ensureLocalServer();
    createWindow();
  } catch (error) {
    console.error(error);
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("before-quit", () => {
  shouldQuit = true;
  stopLocalServer();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || shouldQuit) {
    app.quit();
  }
});
