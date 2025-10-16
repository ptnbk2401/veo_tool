const { contextBridge, ipcRenderer } = require("electron");

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electronAPI", {
  // App info
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
  getPlatform: () => ipcRenderer.invoke("app:getPlatform"),

  // Profile management (will be implemented in later tasks)
  profiles: {
    list: () => ipcRenderer.invoke("profiles:list"),
    add: (profileData) => ipcRenderer.invoke("profiles:add", profileData),
    remove: (profileId) => ipcRenderer.invoke("profiles:remove", profileId),
    test: (profileId) => ipcRenderer.invoke("profiles:test", profileId),
    update: (profileId, updateData) =>
      ipcRenderer.invoke("profiles:update", profileId, updateData),
    createWithLogin: (profileData) =>
      ipcRenderer.invoke("profiles:createWithLogin", profileData),
    detectSystem: () => ipcRenderer.invoke("profiles:detectSystem"),
  },

  // CSV operations (will be implemented in later tasks)
  csv: {
    load: (filePath) => ipcRenderer.invoke("csv:load", filePath),
    save: (filePath, data) => ipcRenderer.invoke("csv:save", filePath, data),
    validate: (data) => ipcRenderer.invoke("csv:validate", data),
  },

  // Automation operations (will be implemented in later tasks)
  automation: {
    start: (config) => ipcRenderer.invoke("automation:start", config),
    pause: () => ipcRenderer.invoke("automation:pause"),
    resume: () => ipcRenderer.invoke("automation:resume"),
    stop: () => ipcRenderer.invoke("automation:stop"),
    getStatus: () => ipcRenderer.invoke("automation:getStatus"),
    listJobs: () => ipcRenderer.invoke("automation:listJobs"),
  },

  // Configuration (will be implemented in later tasks)
  config: {
    load: () => ipcRenderer.invoke("config:load"),
    save: (config) => ipcRenderer.invoke("config:save", config),
  },

  // Logging (will be implemented in later tasks)
  logs: {
    getRecent: (limit) => ipcRenderer.invoke("logs:getRecent", limit),
    clear: () => ipcRenderer.invoke("logs:clear"),
  },

  // File system operations
  fs: {
    selectFolder: () => ipcRenderer.invoke("fs:selectFolder"),
    selectFile: (filters) => ipcRenderer.invoke("fs:selectFile", filters),
  },

  // Event listeners for real-time updates
  onProgressUpdate: (callback) => {
    ipcRenderer.on("progress:update", callback);
    return () => ipcRenderer.removeListener("progress:update", callback);
  },

  onLogUpdate: (callback) => {
    ipcRenderer.on("log:update", callback);
    return () => ipcRenderer.removeListener("log:update", callback);
  },

  onStatusUpdate: (callback) => {
    ipcRenderer.on("status:update", callback);
    return () => ipcRenderer.removeListener("status:update", callback);
  },
});
