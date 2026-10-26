// maestro-cn 桌面壳：启动本地 FastAPI 后端，并在 Electron 窗口中打开前端。
const { app, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const PORT = Number(process.env.MAESTRO_PORT || 8095);
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`;
const APP_URL = `http://127.0.0.1:${PORT}/`;

let server = null;

function waitForServer(timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      http.get(HEALTH_URL, (res) => {
        res.resume();
        resolve(true);
      }).on("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error("后端启动超时"));
        else setTimeout(tick, 500);
      });
    };
    tick();
  });
}

function stopServer() {
  if (server) {
    try { server.kill(); } catch (_) {}
    server = null;
  }
}

app.whenReady().then(async () => {
  // 在项目根目录启动后端（需已安装 python 与 requirements.txt 依赖）
  server = spawn("python", ["run.py", "--no-browser", "--port", String(PORT)], {
    cwd: path.join(__dirname, ".."),
    windowsHide: true,
    stdio: "ignore",
  });

  let backendReady = false;
  try {
    await waitForServer(30000);
    backendReady = true;
  } catch (_) {
    // 后端未就绪也打开窗口，页面会提示连接失败
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "maestro-cn · 智能体工作台",
    backgroundColor: "#0f1115",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.loadURL(APP_URL);
  if (!backendReady) {
    win.webContents.once("did-finish-load", () => {
      win.webContents.executeJavaScript(
        `setTimeout(() => { document.body.insertAdjacentHTML('beforeend',
          '<div style="position:fixed;top:12px;right:12px;z-index:9999;background:#7f1d1d;color:#fff;padding:10px 14px;border-radius:8px;font-size:13px">后端未在 ${PORT} 端口就绪：请确认已安装 python 依赖后重启应用</div>'); }, 1000);`
      );
    });
  }
  win.on("closed", () => app.quit());
});

app.on("window-all-closed", () => {
  stopServer();
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => stopServer());
