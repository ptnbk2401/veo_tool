const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const isDev = process.argv.includes("--dev");

// Fix cache issues on Windows
app.commandLine.appendSwitch("--disable-gpu");
app.commandLine.appendSwitch("--disable-gpu-cache");
app.commandLine.appendSwitch("--disable-gpu-sandbox");
app.commandLine.appendSwitch("--no-sandbox");

// Import automation modules
const { automateWithAPIQueue, automateWithTwoPhase } = require("./automation");
const ProfileManager = require("./profile-manager");

let mainWindow;
let profileManager;

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

  // Add error handling
  mainWindow.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription) => {
      console.error("Failed to load:", errorCode, errorDescription);
    },
  );

  mainWindow.webContents.on("crashed", () => {
    console.error("Renderer process crashed");
  });

  // Load the app
  if (isDev) {
    // In development, load built files (we'll build first)
    mainWindow.loadFile(path.join(__dirname, "../../dist-renderer/index.html"));
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load built files
    mainWindow.loadFile(path.join(__dirname, "../../dist-renderer/index.html"));
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
app.whenReady().then(async () => {
  // Initialize profile manager
  profileManager = new ProfileManager();
  await profileManager.init();

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

// IPC handlers for automation
ipcMain.handle(
  "automation:start",
  async (event, { prompts, settings, profileId }) => {
    try {
      console.log(`Starting automation with ${prompts.length} prompts`);

      // Get profile
      const profile = profileManager.getProfile(profileId);
      if (!profile) {
        throw new Error("Profile not found");
      }

      console.log(`Using profile: ${profile.name} (${profile.path})`);

      // Run automation with new API-driven approach
      console.log("Starting API-driven automation...");
      const twoPhaseResults = await automateWithAPIQueue(
        profile.path,
        prompts,
        settings,
      );
      console.log("API-driven automation completed, processing results...");

      // Convert to expected format with error handling
      const results = [];
      if (
        twoPhaseResults &&
        twoPhaseResults.prompts &&
        Array.isArray(twoPhaseResults.prompts)
      ) {
        twoPhaseResults.prompts.forEach((prompt, index) => {
          const promptVideos = twoPhaseResults.manifest
            ? twoPhaseResults.manifest.filter((m) => m.idx === prompt.index)
            : [];

          results.push({
            prompt:
              prompt.promptText || prompts[index] || `Prompt ${index + 1}`,
            filePath: promptVideos.length > 0 ? promptVideos[0].file_path : "",
            timestamp: prompt.submitTime || new Date().toISOString(),
            status: promptVideos.length > 0 ? "success" : "no videos found",
          });
        });
      } else {
        // Fallback: create results from original prompts
        prompts.forEach((prompt, index) => {
          results.push({
            prompt: prompt,
            filePath: "",
            timestamp: new Date().toISOString(),
            status: "error: automation failed",
          });
        });
      }

      // Update last used
      await profileManager.updateLastUsed(profileId);

      const success = results.filter((r) => r.status === "success").length;
      const failed = results.filter((r) => r.status !== "success").length;

      return {
        success,
        failed,
        results,
        // Add Two-Phase specific info (with fallbacks)
        totalVideos: twoPhaseResults?.totalVideos || 0,
        promptsWithVideos: twoPhaseResults?.promptsWithVideos || 0,
        manifest: twoPhaseResults?.manifest || [],
      };
    } catch (error) {
      console.error("Automation failed:", error);
      throw new Error(`Automation failed: ${error.message}`);
    }
  },
);

// Profile management handlers
ipcMain.handle("profiles:list", async () => {
  try {
    return profileManager.listProfiles();
  } catch (error) {
    console.error("Failed to list profiles:", error);
    throw new Error(`Failed to list profiles: ${error.message}`);
  }
});

ipcMain.handle("profiles:create", async (event, data) => {
  try {
    return await profileManager.createProfile(data);
  } catch (error) {
    console.error("Failed to create profile:", error);
    throw new Error(`Failed to create profile: ${error.message}`);
  }
});

ipcMain.handle("profiles:delete", async (event, profileId) => {
  try {
    return await profileManager.deleteProfile(profileId);
  } catch (error) {
    console.error("Failed to delete profile:", error);
    throw new Error(`Failed to delete profile: ${error.message}`);
  }
});

ipcMain.handle("profiles:test", async (event, profileId) => {
  try {
    return await profileManager.testProfile(profileId);
  } catch (error) {
    console.error("Failed to test profile:", error);
    throw new Error(`Failed to test profile: ${error.message}`);
  }
});

ipcMain.handle("profiles:openForLogin", async (event, profileId) => {
  try {
    return await profileManager.openProfileForLogin(profileId);
  } catch (error) {
    console.error("Failed to open profile for login:", error);
    throw new Error(`Failed to open profile for login: ${error.message}`);
  }
});
