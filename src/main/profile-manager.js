const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const { v4: uuidv4 } = require("uuid");
const { Builder } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const { getChromePath } = require("./chrome-helper");

class ProfileManager {
  constructor() {
    this.profilesDir = path.join(os.homedir(), ".veo3-automation", "profiles");
    this.configFile = path.join(
      os.homedir(),
      ".veo3-automation",
      "profiles.json"
    );
    this.profiles = [];
    this.init();
  }

  async init() {
    // Ensure directories exist
    await fs.ensureDir(this.profilesDir);

    // Load profiles from config
    await this.loadProfiles();
  }

  async loadProfiles() {
    try {
      if (await fs.pathExists(this.configFile)) {
        const data = await fs.readJson(this.configFile);
        this.profiles = data.profiles || [];
      } else {
        this.profiles = [];
        await this.saveProfiles();
      }
    } catch (error) {
      console.error("Failed to load profiles:", error);
      this.profiles = [];
    }
  }

  async saveProfiles() {
    try {
      await fs.writeJson(
        this.configFile,
        { profiles: this.profiles },
        { spaces: 2 }
      );
    } catch (error) {
      console.error("Failed to save profiles:", error);
      throw error;
    }
  }

  async createProfile(data) {
    const profileId = uuidv4();
    const profilePath = path.join(this.profilesDir, profileId);

    // Create profile directory
    await fs.ensureDir(profilePath);

    const profile = {
      id: profileId,
      name: data.name,
      path: profilePath,
      createdAt: new Date().toISOString(),
      lastUsed: null,
    };

    this.profiles.push(profile);
    await this.saveProfiles();

    return profile;
  }

  async deleteProfile(profileId) {
    const profile = this.profiles.find((p) => p.id === profileId);
    if (!profile) {
      throw new Error("Profile not found");
    }

    // Delete profile directory
    await fs.remove(profile.path);

    // Remove from list
    this.profiles = this.profiles.filter((p) => p.id !== profileId);
    await this.saveProfiles();

    return true;
  }

  getProfile(profileId) {
    return this.profiles.find((p) => p.id === profileId);
  }

  listProfiles() {
    return this.profiles;
  }

  async testProfile(profileId) {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error("Profile not found");
    }

    try {
      // Check if profile directory exists
      const exists = await fs.pathExists(profile.path);
      if (!exists) {
        return {
          isValid: false,
          error: "Profile directory not found",
        };
      }

      // Check if profile has Chrome data (indicates it's been used)
      const hasData = await fs.pathExists(path.join(profile.path, "Default"));

      return {
        isValid: true,
        status: hasData ? "Used" : "New",
        hasSession: hasData,
      };
    } catch (error) {
      return {
        isValid: false,
        error: error.message,
      };
    }
  }

  async openProfileForLogin(profileId) {
    const profile = this.getProfile(profileId);
    if (!profile) {
      throw new Error("Profile not found");
    }

    // Get Chrome binary path
    const chromePath = getChromePath();
    console.log(`Using Chrome at: ${chromePath}`);

    // Open Chrome with this profile for manual login
    const options = new chrome.Options()
      .setChromeBinaryPath(chromePath)
      .addArguments(`--user-data-dir=${profile.path}`)
      .addArguments("--no-first-run")
      .addArguments("--no-default-browser-check")
      .excludeSwitches(["enable-automation"]) // Hide "Chrome is being controlled" message
      .addArguments("--disable-infobars"); // Hide info bars

    const driver = await new Builder()
      .forBrowser("chrome")
      .setChromeOptions(options)
      .build();

    // Navigate to Google Flow
    await driver.get("https://labs.google/fx/tools/flow");

    // Update last used
    profile.lastUsed = new Date().toISOString();
    await this.saveProfiles();

    // Note: We don't quit the driver here - let user close manually
    // The session will be saved in the profile directory

    return {
      success: true,
      message: "Chrome opened. Please login and close the browser when done.",
    };
  }

  async updateLastUsed(profileId) {
    const profile = this.getProfile(profileId);
    if (profile) {
      profile.lastUsed = new Date().toISOString();
      await this.saveProfiles();
    }
  }
}

module.exports = ProfileManager;
