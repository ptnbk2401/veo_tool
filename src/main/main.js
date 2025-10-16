const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const isDev = process.argv.includes("--dev");

// Import automation modules
const AutomationManager = require("../automation/automation-manager");

let mainWindow;
let automationManager;

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    icon: path.join(__dirname, "../../assets/icon.png"),
    show: false,
  });

  // Load the app
  if (isDev) {
    // In development, load built files (we'll build first)
    mainWindow.loadFile(
      path.join(__dirname, "../../dist-renderer/src/renderer/index.html")
    );
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load built files
    mainWindow.loadFile(
      path.join(__dirname, "../../dist-renderer/src/renderer/index.html")
    );
  }

  // Show window when ready to prevent visual flash
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // Handle window closed
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Initialize automation manager when app is ready
let automationManagerReady = false;

app.whenReady().then(async () => {
  try {
    automationManager = new AutomationManager();
    await automationManager.init();
    automationManagerReady = true;
    console.log("AutomationManager initialized");
  } catch (error) {
    console.error("Failed to initialize AutomationManager:", error);
  }
});

// Basic IPC handlers
ipcMain.handle("app:getVersion", () => {
  return app.getVersion();
});

ipcMain.handle("app:getPlatform", () => {
  return process.platform;
});

// Profile management handlers
ipcMain.handle("profiles:list", async () => {
  if (!automationManagerReady) throw new Error("AutomationManager not ready");
  try {
    return automationManager.listProfiles();
  } catch (error) {
    throw new Error(`Failed to list profiles: ${error.message}`);
  }
});

ipcMain.handle("profiles:add", async (event, profileData) => {
  if (!automationManagerReady) throw new Error("AutomationManager not ready");
  try {
    // Use the new addOrUpdateProfile method that handles duplicates gracefully
    return await automationManager.chromeProfileManager.addOrUpdateProfile(
      profileData
    );
  } catch (error) {
    throw new Error(`Failed to add profile: ${error.message}`);
  }
});

ipcMain.handle("profiles:remove", async (event, profileId) => {
  if (!automationManagerReady) throw new Error("AutomationManager not ready");
  try {
    return await automationManager.removeProfile(profileId);
  } catch (error) {
    throw new Error(`Failed to remove profile: ${error.message}`);
  }
});

ipcMain.handle("profiles:test", async (event, profileId) => {
  if (!automationManagerReady) throw new Error("AutomationManager not ready");
  try {
    return await automationManager.testProfile(profileId);
  } catch (error) {
    throw new Error(`Failed to test profile: ${error.message}`);
  }
});

ipcMain.handle("profiles:createWithLogin", async (event, profileData) => {
  if (!automationManagerReady) throw new Error("AutomationManager not ready");
  try {
    return await automationManager.createProfileWithLogin(profileData);
  } catch (error) {
    throw new Error(`Failed to create profile with login: ${error.message}`);
  }
});

ipcMain.handle("profiles:detectSystem", async () => {
  if (!automationManagerReady) throw new Error("AutomationManager not ready");
  try {
    return await automationManager.detectSystemProfiles();
  } catch (error) {
    throw new Error(`Failed to detect system profiles: ${error.message}`);
  }
});

// CSV operations handlers
ipcMain.handle("csv:load", async (event, filePath) => {
  if (!automationManagerReady) throw new Error("AutomationManager not ready");
  try {
    return await automationManager.batchProcessor.csvProcessor.loadCSV(
      filePath
    );
  } catch (error) {
    throw new Error(`Failed to load CSV: ${error.message}`);
  }
});

ipcMain.handle("csv:save", async (event, filePath, data) => {
  if (!automationManagerReady) throw new Error("AutomationManager not ready");
  try {
    return await automationManager.batchProcessor.csvProcessor.saveCSV(
      filePath,
      data
    );
  } catch (error) {
    throw new Error(`Failed to save CSV: ${error.message}`);
  }
});

ipcMain.handle("csv:validate", async (event, data) => {
  if (!automationManagerReady) throw new Error("AutomationManager not ready");
  try {
    return automationManager.batchProcessor.csvProcessor.validateCSVData(data);
  } catch (error) {
    throw new Error(`CSV validation failed: ${error.message}`);
  }
});

// Automation operations handlers
ipcMain.handle("automation:start", async (event, config) => {
  if (!automationManagerReady) throw new Error("AutomationManager not ready");
  try {
    const job = await automationManager.startBatchProcessing(config);

    // Set up real-time updates for this job
    const worker = automationManager.jobWorkers.get(job.id);
    if (worker) {
      // Override emit methods to send IPC messages
      worker.emitProgressUpdate = (jobId, itemId, progress) => {
        if (mainWindow) {
          mainWindow.webContents.send("progress:update", {
            jobId,
            itemId,
            progress,
          });
        }
      };

      worker.emitItemComplete = (jobId, itemId, result) => {
        if (mainWindow) {
          mainWindow.webContents.send("item:complete", {
            jobId,
            itemId,
            result,
          });
        }
      };

      worker.emitItemError = (jobId, itemId, error) => {
        if (mainWindow) {
          mainWindow.webContents.send("item:error", {
            jobId,
            itemId,
            error: error.message,
          });
        }
      };

      worker.emitJobComplete = (jobId, job) => {
        if (mainWindow) {
          mainWindow.webContents.send("job:complete", { jobId, job });
        }
      };
    }

    return job;
  } catch (error) {
    throw new Error(`Failed to start automation: ${error.message}`);
  }
});

ipcMain.handle("automation:pause", async (event, jobId) => {
  if (!automationManagerReady) throw new Error("AutomationManager not ready");
  try {
    return await automationManager.pauseJob(jobId);
  } catch (error) {
    throw new Error(`Failed to pause automation: ${error.message}`);
  }
});

ipcMain.handle("automation:resume", async (event, jobId) => {
  if (!automationManagerReady) throw new Error("AutomationManager not ready");
  try {
    return await automationManager.resumeJob(jobId);
  } catch (error) {
    throw new Error(`Failed to resume automation: ${error.message}`);
  }
});

ipcMain.handle("automation:stop", async (event, jobId) => {
  if (!automationManagerReady) throw new Error("AutomationManager not ready");
  try {
    return await automationManager.stopJob(jobId);
  } catch (error) {
    throw new Error(`Failed to stop automation: ${error.message}`);
  }
});

ipcMain.handle("automation:getStatus", async (event, jobId) => {
  if (!automationManagerReady) throw new Error("AutomationManager not ready");
  try {
    if (jobId) {
      return automationManager.getJobStatus(jobId);
    } else {
      return automationManager.getSystemStatus();
    }
  } catch (error) {
    throw new Error(`Failed to get automation status: ${error.message}`);
  }
});

ipcMain.handle("automation:listJobs", async () => {
  if (!automationManagerReady) throw new Error("AutomationManager not ready");
  try {
    return automationManager.listActiveJobs();
  } catch (error) {
    throw new Error(`Failed to list jobs: ${error.message}`);
  }
});

// Configuration handlers
ipcMain.handle("config:load", async () => {
  if (!automationManagerReady) throw new Error("AutomationManager not ready");
  try {
    return automationManager.getConfig();
  } catch (error) {
    throw new Error(`Failed to load configuration: ${error.message}`);
  }
});

ipcMain.handle("config:save", async (event, config) => {
  if (!automationManagerReady) throw new Error("AutomationManager not ready");
  try {
    return await automationManager.updateConfig(config);
  } catch (error) {
    throw new Error(`Failed to save configuration: ${error.message}`);
  }
});

// Logging handlers
ipcMain.handle("logs:getRecent", async (event, limit = 100) => {
  if (!automationManagerReady) throw new Error("AutomationManager not ready");
  try {
    return await automationManager.logger.getRecentLogs(limit);
  } catch (error) {
    throw new Error(`Failed to get recent logs: ${error.message}`);
  }
});

ipcMain.handle("logs:clear", async () => {
  if (!automationManagerReady) throw new Error("AutomationManager not ready");
  try {
    return await automationManager.logger.clearOldLogs();
  } catch (error) {
    throw new Error(`Failed to clear logs: ${error.message}`);
  }
});

// File system operations handlers
ipcMain.handle("fs:selectFolder", async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Select Folder",
    });

    return result.canceled ? null : result.filePaths[0];
  } catch (error) {
    throw new Error(`Failed to select folder: ${error.message}`);
  }
});

ipcMain.handle("fs:selectFile", async (event, filters = []) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile"],
      title: "Select File",
      filters:
        filters.length > 0
          ? filters
          : [
              { name: "CSV Files", extensions: ["csv"] },
              { name: "All Files", extensions: ["*"] },
            ],
    });

    return result.canceled ? null : result.filePaths[0];
  } catch (error) {
    throw new Error(`Failed to select file: ${error.message}`);
  }
});

// Cleanup on app quit
app.on("before-quit", async () => {
  if (automationManager) {
    await automationManager.cleanup();
  }
});
