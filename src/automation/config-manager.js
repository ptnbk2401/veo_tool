const fs = require("fs-extra");
const path = require("path");

class ConfigManager {
  constructor() {
    this.configFile = path.join(process.cwd(), "config", "app-config.json");
    this.defaultConfig = {
      automation: {
        pollInterval: 5000,
        timeout: 600000,
        parallel: 1,
        retryAttempts: 3,
        headless: false,
      },
      paths: {
        outputFolder: "./output",
        logsFolder: "./logs",
        backupsFolder: "./backups",
        profilesFolder: "./profiles",
      },
      ui: {
        theme: "light",
        autoSave: true,
        notifications: true,
        logLevel: "info",
      },
      browser: {
        windowSize: {
          width: 1280,
          height: 720,
        },
        userAgent: null,
        downloadTimeout: 60000,
        pageLoadTimeout: 30000,
      },
      video: {
        model: "veo-3.1-fast", // VEO model version (veo-3.1-fast, veo-3.1-standard, veo-2)
        aspectRatio: "16:9", // Video aspect ratio (16:9, 9:16, 1:1, 4:3)
        count: 1, // Number of videos to generate per prompt (1-4)
        duration: "5s", // Video duration (5s, 10s, 15s, 30s)
        quality: "high", // Video quality (high, medium, low)
      },
      security: {
        allowInsecureConnections: false,
        validateCertificates: true,
      },
      performance: {
        maxConcurrentJobs: 3,
        memoryLimit: 1024, // MB
        cleanupInterval: 3600000, // 1 hour
      },
    };

    this.config = { ...this.defaultConfig };
    this.init();
  }

  async init() {
    await fs.ensureDir(path.dirname(this.configFile));
    await this.loadConfig();
  }

  async loadConfig() {
    try {
      if (await fs.pathExists(this.configFile)) {
        const fileConfig = await fs.readJson(this.configFile);
        this.config = this.mergeConfig(this.defaultConfig, fileConfig);
        console.log("Configuration loaded successfully");
      } else {
        // Create default config file
        await this.saveConfig();
        console.log("Default configuration created");
      }

      // Validate configuration
      this.validateConfig();
    } catch (error) {
      console.error("Failed to load configuration:", error);
      console.log("Using default configuration");
      this.config = { ...this.defaultConfig };
    }
  }

  async saveConfig() {
    try {
      await fs.writeJson(this.configFile, this.config, { spaces: 2 });
      console.log("Configuration saved successfully");
    } catch (error) {
      console.error("Failed to save configuration:", error);
      throw error;
    }
  }

  mergeConfig(defaultConfig, userConfig) {
    const merged = { ...defaultConfig };

    for (const [key, value] of Object.entries(userConfig)) {
      if (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        merged[key] = this.mergeConfig(defaultConfig[key] || {}, value);
      } else {
        merged[key] = value;
      }
    }

    return merged;
  }

  validateConfig() {
    const errors = [];

    // Validate automation settings
    if (this.config.automation.pollInterval < 1000) {
      errors.push("Poll interval must be at least 1000ms");
    }

    if (this.config.automation.timeout < 30000) {
      errors.push("Timeout must be at least 30 seconds");
    }

    if (
      this.config.automation.parallel < 1 ||
      this.config.automation.parallel > 10
    ) {
      errors.push("Parallel jobs must be between 1 and 10");
    }

    // Validate paths
    const requiredPaths = ["outputFolder", "logsFolder", "backupsFolder"];
    for (const pathKey of requiredPaths) {
      if (!this.config.paths[pathKey]) {
        errors.push(`${pathKey} path is required`);
      }
    }

    // Validate browser settings
    if (
      this.config.browser.windowSize.width < 800 ||
      this.config.browser.windowSize.height < 600
    ) {
      errors.push("Browser window size must be at least 800x600");
    }

    // Validate performance settings
    if (
      this.config.performance.maxConcurrentJobs < 1 ||
      this.config.performance.maxConcurrentJobs > 20
    ) {
      errors.push("Max concurrent jobs must be between 1 and 20");
    }

    if (errors.length > 0) {
      console.warn("Configuration validation warnings:", errors);
      // Apply corrections for critical errors
      this.applyConfigCorrections();
    }
  }

  applyConfigCorrections() {
    // Apply minimum values for critical settings
    if (this.config.automation.pollInterval < 1000) {
      this.config.automation.pollInterval = 1000;
    }

    if (this.config.automation.timeout < 30000) {
      this.config.automation.timeout = 30000;
    }

    if (this.config.automation.parallel < 1) {
      this.config.automation.parallel = 1;
    } else if (this.config.automation.parallel > 10) {
      this.config.automation.parallel = 10;
    }

    // Ensure required paths exist
    if (!this.config.paths.outputFolder) {
      this.config.paths.outputFolder = "./output";
    }

    if (!this.config.paths.logsFolder) {
      this.config.paths.logsFolder = "./logs";
    }
  }

  get(path) {
    const keys = path.split(".");
    let value = this.config;

    for (const key of keys) {
      if (value && typeof value === "object" && key in value) {
        value = value[key];
      } else {
        return undefined;
      }
    }

    return value;
  }

  set(path, value) {
    const keys = path.split(".");
    const lastKey = keys.pop();
    let target = this.config;

    // Navigate to the parent object
    for (const key of keys) {
      if (!target[key] || typeof target[key] !== "object") {
        target[key] = {};
      }
      target = target[key];
    }

    // Set the value
    target[lastKey] = value;
  }

  async updateConfig(updates) {
    try {
      // Apply updates
      for (const [path, value] of Object.entries(updates)) {
        this.set(path, value);
      }

      // Validate updated configuration
      this.validateConfig();

      // Save to file
      await this.saveConfig();

      return true;
    } catch (error) {
      console.error("Failed to update configuration:", error);
      throw error;
    }
  }

  getAutomationConfig() {
    return { ...this.config.automation };
  }

  getBrowserConfig() {
    return { ...this.config.browser };
  }

  getPathsConfig() {
    return { ...this.config.paths };
  }

  getUIConfig() {
    return { ...this.config.ui };
  }

  async resetToDefaults() {
    try {
      this.config = { ...this.defaultConfig };
      await this.saveConfig();
      console.log("Configuration reset to defaults");
      return true;
    } catch (error) {
      console.error("Failed to reset configuration:", error);
      throw error;
    }
  }

  async createBackup() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = path.join(
        path.dirname(this.configFile),
        `app-config-backup-${timestamp}.json`,
      );

      await fs.copy(this.configFile, backupPath);
      console.log(`Configuration backup created: ${backupPath}`);
      return backupPath;
    } catch (error) {
      console.error("Failed to create configuration backup:", error);
      throw error;
    }
  }

  async restoreFromBackup(backupPath) {
    try {
      if (!(await fs.pathExists(backupPath))) {
        throw new Error(`Backup file does not exist: ${backupPath}`);
      }

      // Validate backup file
      const backupConfig = await fs.readJson(backupPath);

      // Create current backup before restore
      await this.createBackup();

      // Restore configuration
      this.config = this.mergeConfig(this.defaultConfig, backupConfig);
      this.validateConfig();
      await this.saveConfig();

      console.log("Configuration restored from backup");
      return true;
    } catch (error) {
      console.error("Failed to restore configuration from backup:", error);
      throw error;
    }
  }

  getConfigSummary() {
    return {
      automation: {
        pollInterval: this.config.automation.pollInterval,
        timeout: this.config.automation.timeout,
        parallel: this.config.automation.parallel,
        retryAttempts: this.config.automation.retryAttempts,
      },
      paths: {
        outputFolder: this.config.paths.outputFolder,
        logsFolder: this.config.paths.logsFolder,
      },
      performance: {
        maxConcurrentJobs: this.config.performance.maxConcurrentJobs,
      },
    };
  }

  async ensureDirectories() {
    try {
      const directories = [
        this.config.paths.outputFolder,
        this.config.paths.logsFolder,
        this.config.paths.backupsFolder,
        this.config.paths.profilesFolder,
      ];

      for (const dir of directories) {
        await fs.ensureDir(dir);
      }

      console.log("All required directories ensured");
    } catch (error) {
      console.error("Failed to ensure directories:", error);
      throw error;
    }
  }
}

module.exports = ConfigManager;
