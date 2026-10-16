import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
} from "electron";
import path from "node:path";
import { AppError } from "./domain";
import { SettingsStore } from "./store";
import { inspectComputer } from "./platform";
import { RestoreService } from "./service";

if (process.env.RESTOREWIN_STATE_DIR) {
  if (!path.isAbsolute(process.env.RESTOREWIN_STATE_DIR))
    throw new Error("RESTOREWIN_STATE_DIR must be absolute");
  app.setPath("userData", process.env.RESTOREWIN_STATE_DIR);
}
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let window: BrowserWindow | null = null;
let service: RestoreService;

function trusted(event: IpcMainInvokeEvent) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new AppError("UNTRUSTED_REQUEST", "Origem da solicitação inválida.");
}
function register(
  channel: string,
  handler: (payload: unknown) => Promise<unknown>,
) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      trusted(event);
      return { ok: true, value: await handler(payload) };
    } catch (error) {
      return {
        ok: false,
        code: error instanceof AppError ? error.code : "OPERATION_FAILED",
        message:
          error instanceof AppError
            ? error.message
            : "Não foi possível concluir esta operação. Nenhuma proteção foi ativada.",
      };
    }
  });
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
  await window.loadFile(path.join(__dirname, "../dist/index.html"));
  window.on("closed", () => {
    window = null;
  });
}

app.on("second-instance", () => {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});
if (locked)
  void app.whenReady().then(async () => {
    service = new RestoreService(
      new SettingsStore(app.getPath("userData")),
      () =>
        inspectComputer(
          app.isPackaged ? path.dirname(process.execPath) : app.getAppPath(),
        ),
      app.getVersion(),
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
    await createWindow();
    app.on("activate", () => {
      if (!window) void createWindow();
    });
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
