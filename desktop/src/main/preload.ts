import { contextBridge, ipcRenderer } from "electron";
import type { Bridge } from "../shared/contracts";

const bridge: Bridge = {
  snapshot: () => ipcRenderer.invoke("restorewin:snapshot"),
  saveProfile: (profile, revision) =>
    ipcRenderer.invoke("restorewin:save", { profile, revision }),
  chooseFolder: () => ipcRenderer.invoke("restorewin:folder"),
  requestProtection: (action) =>
    ipcRenderer.invoke("restorewin:protection", action),
};
contextBridge.exposeInMainWorld("restorewin", Object.freeze(bridge));
