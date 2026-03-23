const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zomboidServerApi", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  chooseServerRoot: () => ipcRenderer.invoke("config:choose-server-root"),
  setConfig: (partial) => ipcRenderer.invoke("config:set", partial),
  loadAll: () => ipcRenderer.invoke("state:load-all"),
  readIni: () => ipcRenderer.invoke("ini:read"),
  scanMods: () => ipcRenderer.invoke("mods:scan"),
  saveMods: (modIds) => ipcRenderer.invoke("ini:save-mods", modIds),
  uninstallMods: (payload) => ipcRenderer.invoke("mods:uninstall", payload),
});
