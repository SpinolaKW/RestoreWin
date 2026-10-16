import { contextBridge, ipcRenderer } from "electron";
import type { Bridge } from "../shared/contracts";

const bridge: Bridge = {
  authState: () => ipcRenderer.invoke("restorewin:auth:state"),
  setup: (username, password) =>
    ipcRenderer.invoke("restorewin:auth:setup", { username, password }),
  login: (username, password) =>
    ipcRenderer.invoke("restorewin:auth:login", { username, password }),
  lock: () => ipcRenderer.invoke("restorewin:auth:lock"),
  onLocked: (listener) => {
    const handler = () => listener();
    ipcRenderer.on("restorewin:locked", handler);
    return () => ipcRenderer.removeListener("restorewin:locked", handler);
  },
  users: () => ipcRenderer.invoke("restorewin:users"),
  createUser: (username, password) =>
    ipcRenderer.invoke("restorewin:users:create", { username, password }),
  changePassword: (id, password, currentPassword) =>
    ipcRenderer.invoke("restorewin:users:password", {
      id,
      password,
      currentPassword,
    }),
  deleteUser: (id) => ipcRenderer.invoke("restorewin:users:delete", id),
  runtime: () => ipcRenderer.invoke("restorewin:runtime"),
  setAutoStart: (enabled) =>
    ipcRenderer.invoke("restorewin:autostart", enabled),
  quit: () => ipcRenderer.invoke("restorewin:quit"),
  snapshot: () => ipcRenderer.invoke("restorewin:snapshot"),
  saveProfile: (profile, revision) =>
    ipcRenderer.invoke("restorewin:save", { profile, revision }),
  chooseFolder: () => ipcRenderer.invoke("restorewin:folder"),
  requestProtection: (action) =>
    ipcRenderer.invoke("restorewin:protection", action),
};
contextBridge.exposeInMainWorld("restorewin", Object.freeze(bridge));
