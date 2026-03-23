const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("modManagerApi", {
  getState: () => ipcRenderer.invoke("app:get-state"),
  chooseInstallPath: () => ipcRenderer.invoke("config:choose-install-path"),
  setInstallPath: (installPath) =>
    ipcRenderer.invoke("config:set-install-path", installPath),
  installMods: (folderNames) => ipcRenderer.invoke("mods:install", folderNames),
  uninstallMods: (folderNames) => ipcRenderer.invoke("mods:uninstall", folderNames),
  /** Mods currently under the saved install path (name/version from each mod.info). */
  getInstalledMods: () => ipcRenderer.invoke("mods:getInstalled"),
  checkUpdates: () => ipcRenderer.invoke("mods:check-updates"),
});
