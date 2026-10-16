import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  powerMonitor,
  type IpcMainInvokeEvent,
} from "electron";
import path from "node:path";
import { AppError } from "./domain";
import { SettingsStore } from "./store";
import { inspectComputer } from "./platform";
import { RestoreService } from "./service";
import { AuthService } from "./auth";
import type { RuntimeState } from "../shared/contracts";

if (process.env.RESTOREWIN_STATE_DIR) {
  if (!path.isAbsolute(process.env.RESTOREWIN_STATE_DIR))
    throw Error("RESTOREWIN_STATE_DIR must be absolute");
  app.setPath("userData", process.env.RESTOREWIN_STATE_DIR);
}
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let service: RestoreService;
let auth: AuthService;
let quitting = false;
let adminSession = false;
let idleTimer: ReturnType<typeof setInterval> | undefined;

function trusted(event: IpcMainInvokeEvent) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new AppError("UNTRUSTED_REQUEST", "Origem da solicitação inválida.");
}
function showWindow() {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
function updateTray() {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir RestoreWin", click: showWindow },
      { label: "Bloquear acesso", click: lockAccess },
      { type: "separator" },
      {
        label: adminSession
          ? "Encerrar RestoreWin"
          : "Encerrar (entre como administrador)",
        click: () => {
          if (adminSession)
            void auth
              .require(true)
              .then(() => app.quit())
              .catch(() => {
                lockAccess();
                showWindow();
              });
          else showWindow();
        },
      },
    ]),
  );
}
function lockAccess() {
  auth?.lock();
  adminSession = false;
  window?.webContents.send("restorewin:locked");
  updateTray();
}
function runtime(): RuntimeState {
  const autoStartSupported = process.platform === "win32" && app.isPackaged;
  return {
    trayAvailable: tray !== null,
    autoStartSupported,
    autoStart: autoStartSupported
      ? app.getLoginItemSettings({
          path: process.execPath,
          args: ["--background"],
        }).openAtLogin
      : false,
  };
}
function register(
  channel: string,
  handler: (payload: unknown) => Promise<unknown>,
  permission: "public" | "user" | "admin" = "user",
) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      trusted(event);
      if (permission !== "public") await auth.require(permission === "admin");
      const value = await handler(payload);
      if (channel.startsWith("restorewin:auth:")) {
        adminSession = (await auth.state()).user?.role === "admin";
        updateTray();
      }
      return { ok: true, value };
    } catch (error) {
      if (error instanceof AppError && error.code === "AUTH_REQUIRED")
        lockAccess();
      return {
        ok: false,
        code: error instanceof AppError ? error.code : "OPERATION_FAILED",
        message:
          error instanceof AppError
            ? error.message
            : "Não foi possível concluir esta operação.",
      };
    }
  });
}
function fields(payload: unknown): {
  username?: unknown;
  password?: unknown;
  id?: unknown;
  currentPassword?: unknown;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new AppError("INVALID_REQUEST", "Solicitação inválida.");
  return payload;
}
async function createWindow() {
  window = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 980,
    minHeight: 720,
    title: "RestoreWin",
    backgroundColor: "#f4f6fa",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.on("render-process-gone", lockAccess);
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    lockAccess();
    if (tray) window?.hide();
    else window?.minimize();
  });
  window.on("closed", () => {
    window = null;
  });
  await window.loadFile(path.join(__dirname, "../dist/index.html"));
  const state = await auth.state().catch(() => null);
  if (!(process.argv.includes("--background") && tray && state?.initialized))
    showWindow();
}
app.on("second-instance", showWindow);
app.on("before-quit", () => {
  quitting = true;
  auth?.lock();
});
app.on("will-quit", () => {
  if (idleTimer) clearInterval(idleTimer);
  tray?.destroy();
});
if (locked)
  void app.whenReady().then(async () => {
    auth = new AuthService(app.getPath("userData"));
    service = new RestoreService(
      new SettingsStore(app.getPath("userData")),
      () =>
        inspectComputer(
          app.isPackaged ? path.dirname(process.execPath) : app.getAppPath(),
        ),
      app.getVersion(),
    );
    register("restorewin:auth:state", () => auth.state(), "public");
    register(
      "restorewin:auth:setup",
      (payload) => {
        const p = fields(payload);
        return auth.setup(p.username, p.password);
      },
      "public",
    );
    register(
      "restorewin:auth:login",
      (payload) => {
        const p = fields(payload);
        return auth.login(p.username, p.password);
      },
      "public",
    );
    register(
      "restorewin:auth:lock",
      async () => {
        lockAccess();
        return auth.state();
      },
      "public",
    );
    register("restorewin:users", () => auth.users(), "admin");
    register(
      "restorewin:users:create",
      (payload) => {
        const p = fields(payload);
        return auth.createUser(p.username, p.password);
      },
      "admin",
    );
    register(
      "restorewin:users:password",
      async (payload) => {
        const p = fields(payload);
        const state = await auth.changePassword(
          p.id,
          p.password,
          p.currentPassword,
        );
        if (!state.user) lockAccess();
        return state;
      },
      "admin",
    );
    register("restorewin:users:delete", (id) => auth.deleteUser(id), "admin");
    register("restorewin:runtime", async () => runtime());
    register(
      "restorewin:autostart",
      async (enabled) => {
        if (typeof enabled !== "boolean" || !runtime().autoStartSupported)
          throw new AppError(
            "AUTOSTART_UNAVAILABLE",
            "A inicialização automática está disponível no aplicativo instalado no Windows.",
          );
        app.setLoginItemSettings({
          openAtLogin: enabled,
          path: process.execPath,
          args: ["--background"],
        });
        return runtime();
      },
      "admin",
    );
    register(
      "restorewin:quit",
      async () => {
        setImmediate(() => app.quit());
        return null;
      },
      "admin",
    );
    register("restorewin:snapshot", () => service.snapshot());
    register("restorewin:save", async (payload) => {
      if (
        !payload ||
        typeof payload !== "object" ||
        !("profile" in payload) ||
        !("revision" in payload)
      )
        throw new AppError("INVALID_PROFILE", "Configuração inválida.");
      return service.saveProfile(payload.profile, payload.revision);
    });
    register("restorewin:protection", (action) =>
      service.requestProtection(action),
    );
    register("restorewin:folder", async () => {
      if (!window) return null;
      const selected = await dialog.showOpenDialog(window, {
        title: "Escolher pasta permanente",
        properties: ["openDirectory"],
      });
      return selected.canceled ? null : (selected.filePaths[0] ?? null);
    });
    try {
      const icon = nativeImage.createFromPath(
        path.join(__dirname, "../assets/tray.png"),
      );
      if (icon.isEmpty()) throw Error("Missing tray icon");
      tray = new Tray(icon);
      tray.setToolTip(
        "RestoreWin — interface em segundo plano; congelamento indisponível",
      );
      tray.on("click", showWindow);
      tray.on("double-click", showWindow);
      updateTray();
    } catch {
      tray = null;
    }
    powerMonitor.on("lock-screen", lockAccess);
    powerMonitor.on("suspend", lockAccess);
    idleTimer = setInterval(() => {
      if (powerMonitor.getSystemIdleTime() >= 300) lockAccess();
    }, 15_000);
    idleTimer.unref();
    await createWindow();
    app.on("activate", showWindow);
  });
app.on("window-all-closed", () => {
  if (quitting || !tray) app.quit();
});
