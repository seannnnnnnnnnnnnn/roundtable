const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("roundtableDesktop", {
  getInfo: () => ipcRenderer.invoke("desktop:get-info"),
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-update"),
  installUpdate: () => ipcRenderer.invoke("desktop:install-update"),
  openUpdatePage: () => ipcRenderer.invoke("desktop:open-update-page"),
  onUpdateStatus: (listener) => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on("desktop:update-status", handler);
    return () => ipcRenderer.removeListener("desktop:update-status", handler);
  }
});
