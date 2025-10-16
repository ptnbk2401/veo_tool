const fs = require("fs-extra");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { Builder } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const SessionDetector = require("./session-detector");

class ChromeProfileManager {
  constructor() {
    this.profilesFile = path.join(process.cwd(), "config", "profiles.json");
    this.profiles = new Map();
    this.activeSessions = new Map();
    this.sessionDetector = new SessionDetector();
    this.init();
  }

  async init() {
    // Ensure config directory exists
    await fs.ensureDir(path.dirname(this.profilesFile));

    // Load existing profiles
    await this.loadProfiles();
  }

  async loadProfiles() {
    try {
      if (await fs.pathExists(this.profilesFile)) {
        const data = await fs.readJson(this.profilesFile);
        this.profiles = new Map(Object.entries(data));
      }
    } catch (error) {
      console.error("Failed to load profiles:", error);
      this.profiles = new Map();
    }
  }

  async saveProfiles() {
    try {
      const data = Object.fromEntries(this.profiles);
      await fs.writeJson(this.profilesFile, data, { spaces: 2 });
    } catch (error) {
      console.error("Failed to save profiles:", error);
      throw error;
    }
  }

  generateId() {
    return uuidv4();
  }

  async addProfile(profileData) {
    const { name, path: profilePath } = profileData;

    // Validate input
    if (!name || !profilePath) {
      throw new Error("Profile name and path are required");
    }

    // Validate profile path exists
    if (!(await fs.pathExists(profilePath))) {
      throw new Error(`Profile path does not exist: ${profilePath}`);
    }

    // Check if profile already exists
    for (const [id, profile] of this.profiles) {
      if (profile.path === profilePath) {
        throw new Error("Profile with this path already exists");
      }
      if (profile.name === name) {
        throw new Error("Profile with this name already exists");
      }
    }

    const profileId = this.generateId();
    const profile = {
      id: profileId,
      name,
      path: profilePath,
      isActive: false,
      lastSessionCheck: null,
      sessionStatus: "unknown",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.profiles.set(profileId, profile);
    await this.saveProfiles();

    return profile;
  }

  async removeProfile(profileId) {
    if (!this.profiles.has(profileId)) {
      throw new Error("Profile not found");
    }

    // Close any active session for this profile
    if (this.activeSessions.has(profileId)) {
      await this.closeSession(profileId);
    }

    this.profiles.delete(profileId);
    await this.saveProfiles();

    return true;
  }

  getProfile(profileId) {
    return this.profiles.get(profileId) || null;
  }

  listProfiles() {
    return Array.from(this.profiles.values());
  }

  async updateProfile(profileId, updateData) {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      throw new Error("Profile not found");
    }

    // Validate path if being updated
    if (updateData.path && updateData.path !== profile.path) {
      if (!(await fs.pathExists(updateData.path))) {
        throw new Error(`Profile path does not exist: ${updateData.path}`);
      }
    }

    // Update profile
    const updatedProfile = {
      ...profile,
      ...updateData,
      updatedAt: new Date().toISOString(),
    };

    this.profiles.set(profileId, updatedProfile);
    await this.saveProfiles();

    return updatedProfile;
  }

  async updateProfileStatus(profileId, sessionStatus) {
    const profile = this.profiles.get(profileId);
    if (!profile) {
      throw new Error("Profile not found");
    }

    profile.sessionStatus = sessionStatus;
    profile.lastSessionCheck = new Date().toISOString();
    profile.updatedAt = new Date().toISOString();

    this.profiles.set(profileId, profile);
    await this.saveProfiles();

    return profile;
  }

  validateProfilePath(profilePath) {
    // Basic validation for Chrome profile directory structure
    const requiredFiles = ["Preferences", "Local State"];

    for (const file of requiredFiles) {
      const filePath = path.join(profilePath, file);
      if (!fs.existsSync(filePath)) {
        return false;
      }
    }

    return true;
  }

  async closeSession(profileId) {
    const session = this.activeSessions.get(profileId);
    if (session) {
      try {
        await session.quit();
      } catch (error) {
        console.error(`Error closing session for profile ${profileId}:`, error);
      }
      this.activeSessions.delete(profileId);
    }
  }

  async closeAllSessions() {
    const promises = Array.from(this.activeSessions.keys()).map((profileId) =>
      this.closeSession(profileId)
    );
    await Promise.all(promises);
  }

  getActiveSessionCount() {
    return this.activeSessions.size;
  }

  isSessionActive(profileId) {
    return this.activeSessions.has(profileId);
  }

  async createBrowserSession(profileId, options = {}) {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error("Profile not found");
    }

    // Close existing session if any
    if (this.activeSessions.has(profileId)) {
      await this.closeSession(profileId);
    }

    try {
      const chromeOptions = new chrome.Options();

      // Set user data directory to the profile path
      chromeOptions.addArguments(`--user-data-dir=${profile.path}`);

      // Additional Chrome options
      if (options.headless) {
        chromeOptions.addArguments("--headless");
      }

      // Disable web security for automation (be careful with this)
      chromeOptions.addArguments("--disable-web-security");
      chromeOptions.addArguments("--disable-features=VizDisplayCompositor");
      chromeOptions.addArguments("--no-sandbox");
      chromeOptions.addArguments("--disable-dev-shm-usage");

      // Set window size
      if (options.windowSize) {
        chromeOptions.addArguments(
          `--window-size=${options.windowSize.width},${options.windowSize.height}`
        );
      }

      const driver = await new Builder()
        .forBrowser("chrome")
        .setChromeOptions(chromeOptions)
        .build();

      // Store the session
      this.activeSessions.set(profileId, driver);

      // Update profile status
      await this.updateProfileStatus(profileId, "active");

      return driver;
    } catch (error) {
      console.error(
        `Failed to create browser session for profile ${profileId}:`,
        error
      );
      await this.updateProfileStatus(profileId, "error");
      throw error;
    }
  }

  async testProfileSession(profileId, options = {}) {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error("Profile not found");
    }

    let driver = null;
    try {
      // Create a temporary browser session
      driver = await this.createBrowserSession(profileId, {
        ...options,
        headless: options.headless !== false, // Default to headless for testing
      });

      // Check VEO3 login status
      const loginStatus = await this.sessionDetector.checkVEO3LoginStatus(
        driver
      );

      // Update profile with session status
      const sessionStatus = loginStatus.isLoggedIn ? "valid" : "expired";
      await this.updateProfileStatus(profileId, sessionStatus);

      return {
        success: true,
        isLoggedIn: loginStatus.isLoggedIn,
        sessionStatus,
        userInfo: loginStatus.userInfo,
        method: loginStatus.method,
        currentUrl: loginStatus.currentUrl,
      };
    } catch (error) {
      console.error(`Session test failed for profile ${profileId}:`, error);
      await this.updateProfileStatus(profileId, "error");

      return {
        success: false,
        isLoggedIn: false,
        sessionStatus: "error",
        error: error.message,
      };
    } finally {
      // Always close the test session
      if (driver) {
        try {
          await driver.quit();
          this.activeSessions.delete(profileId);
        } catch (e) {
          console.error("Error closing test session:", e);
        }
      }
    }
  }

  async loginToVEO3(profileId, options = {}) {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error("Profile not found");
    }

    let driver = null;
    try {
      // Create browser session (visible for manual login)
      driver = await this.createBrowserSession(profileId, {
        ...options,
        headless: false, // Always visible for login
      });

      // Check current login status
      const currentStatus = await this.sessionDetector.checkVEO3LoginStatus(
        driver
      );

      if (currentStatus.isLoggedIn) {
        await this.updateProfileStatus(profileId, "valid");
        return {
          success: true,
          message: "Already logged in",
          userInfo: currentStatus.userInfo,
        };
      }

      // Prompt for manual login
      const loginResult = await this.sessionDetector.promptManualLogin(driver);

      await this.updateProfileStatus(profileId, "valid");

      return {
        success: true,
        message: "Login completed successfully",
        userInfo: loginResult.userInfo,
      };
    } catch (error) {
      console.error(`Login failed for profile ${profileId}:`, error);
      await this.updateProfileStatus(profileId, "error");

      throw error;
    } finally {
      // Keep the session open after successful login
      // User can close it manually or it will be managed by the automation
    }
  }
}

module.exports = ChromeProfileManager;
