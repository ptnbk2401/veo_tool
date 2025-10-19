const { contextBridge, ipcRenderer } = require("electron");

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  // Automation
  startAutomation: (config) => ipcRenderer.invoke("automation:start", config),

  // Profile management
  listProfiles: () => ipcRenderer.invoke("profiles:list"),
  createProfile: (data) => ipcRenderer.invoke("profiles:create", data),
  deleteProfile: (profileId) =>
    ipcRenderer.invoke("profiles:delete", profileId),
  testProfile: (profileId) => ipcRenderer.invoke("profiles:test", profileId),
  openProfileForLogin: (profileId) =>
    ipcRenderer.invoke("profiles:openForLogin", profileId),

  // File system
  selectFolder: () => ipcRenderer.invoke("fs:selectFolder"),
  openFolder: (folderPath) => ipcRenderer.invoke("fs:openFolder", folderPath),

  // Progress updates
  onProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on("automation:progress", listener);
    // Return unsubscribe function
    return () => ipcRenderer.removeListener("automation:progress", listener);
  },
});
