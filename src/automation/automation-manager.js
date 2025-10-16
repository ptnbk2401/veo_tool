const ChromeProfileManager = require("./chrome-profile-manager");
const BatchProcessor = require("./batch-processor");
const VideoRenderer = require("./video-renderer");
const ConfigManager = require("./config-manager");
const Logger = require("./logger");
const os = require("os");
const path = require("path");

class AutomationManager {
  constructor() {
    this.profileManager = new ChromeProfileManager();
    this.batchProcessor = new BatchProcessor();
    this.videoRenderer = new VideoRenderer();
    this.configManager = new ConfigManager();
    this.logger = new Logger({ module: "AutomationManager" });

    this.activeJobs = new Map();
    this.jobWorkers = new Map();
    this.isInitialized = false;

    this.init();
  }

  async init() {
    try {
      await this.configManager.init();
      await this.configManager.ensureDirectories();

      // Recover any interrupted jobs
      const recoveredJobs = await this.batchProcessor.recoverInterruptedJobs();
      if (recoveredJobs.length > 0) {
        this.logger.info(`Recovered ${recoveredJobs.length} interrupted jobs`);
      }

      this.isInitialized = true;
      this.logger.info("AutomationManager initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize AutomationManager", error);
      throw error;
    }
  }

  async startBatchProcessing(config) {
    try {
      const { csvPath, profileId, jobName, automationConfig } = config;

      this.logger.info("Starting batch processing", {
        csvPath,
        profileId,
        jobName,
      });

      // Validate inputs
      if (!csvPath || !profileId) {
        throw new Error("CSV path and profile ID are required");
      }

      // Check if profile exists and is valid
      const profile = this.profileManager.getProfile(profileId);
      if (!profile) {
        throw new Error("Profile not found");
      }

      // Test profile session
      const sessionTest = await this.profileManager.testProfileSession(
        profileId
      );
      if (!sessionTest.success || !sessionTest.isLoggedIn) {
        throw new Error("Profile session is not valid. Please login first.");
      }

      // Create job
      const job = await this.batchProcessor.createJob({
        csvPath,
        profileId,
        name: jobName,
        config: {
          ...this.configManager.getAutomationConfig(),
          ...automationConfig,
        },
      });

      // Start job
      await this.batchProcessor.startJob(job.id);

      // Create worker for this job
      const worker = this.createJobWorker(job.id, profileId);
      this.jobWorkers.set(job.id, worker);

      // Start processing
      worker.start();

      this.logger.logJobStart(job.id, job);

      return job;
    } catch (error) {
      this.logger.error("Failed to start batch processing", error);
      throw error;
    }
  }

  createJobWorker(jobId, profileId) {
    return {
      jobId,
      profileId,
      isRunning: false,
      isPaused: false,
      driver: null,

      async start() {
        this.isRunning = true;
        this.isPaused = false;

        try {
          // Create browser session
          this.driver = await this.profileManager.createBrowserSession(
            profileId,
            {
              headless: this.configManager.get("automation.headless"),
              windowSize: this.configManager.get("browser.windowSize"),
            }
          );

          // Start processing loop
          await this.processLoop();
        } catch (error) {
          this.logger.error(`Job worker ${jobId} failed to start`, error);
          await this.stop();
        }
      },

      async processLoop() {
        while (this.isRunning) {
          try {
            // Check if job is paused
            if (this.isPaused) {
              await this.sleep(1000);
              continue;
            }

            // Get next pending item
            const nextItem = this.batchProcessor.getNextPendingItem(jobId);
            if (!nextItem) {
              // No more items to process
              await this.completeJob();
              break;
            }

            // Process the item
            await this.processItem(nextItem);
          } catch (error) {
            this.logger.error(
              `Error in job worker ${jobId} process loop`,
              error
            );

            // Continue with next item unless it's a critical error
            if (this.isCriticalError(error)) {
              await this.stop();
              break;
            }
          }
        }
      },

      async processItem(item) {
        const startTime = Date.now();

        try {
          this.logger.logItemStart(jobId, item.ID, item);

          // Update item status to rendering
          await this.batchProcessor.updateJobItemStatus(
            jobId,
            item.ID,
            "rendering"
          );

          // Render video
          const result = await this.videoRenderer.renderVideo(
            this.driver,
            item.Flow_URL,
            item.Prompt,
            {
              timeout: this.configManager.get("automation.timeout"),
              outputFolder: this.configManager.get("paths.outputFolder"),
              onProgressUpdate: (progress) => {
                // Emit progress update event
                this.emitProgressUpdate(jobId, item.ID, progress);
              },
            }
          );

          // Update item status to done
          await this.batchProcessor.updateJobItemStatus(
            jobId,
            item.ID,
            "done",
            {
              videoPath: result.videoPath,
              renderTime: Date.now() - startTime,
            }
          );

          this.logger.logItemComplete(jobId, item.ID, result);

          // Emit completion event
          this.emitItemComplete(jobId, item.ID, result);
        } catch (error) {
          // Update item status to error
          await this.batchProcessor.updateJobItemStatus(
            jobId,
            item.ID,
            "error",
            {
              error: error.message,
            }
          );

          this.logger.logItemError(jobId, item.ID, error);

          // Emit error event
          this.emitItemError(jobId, item.ID, error);
        }
      },

      async pause() {
        this.isPaused = true;
        await this.batchProcessor.pauseJob(jobId);
        this.logger.info(`Job ${jobId} paused`);
      },

      async resume() {
        this.isPaused = false;
        await this.batchProcessor.resumeJob(jobId);
        this.logger.info(`Job ${jobId} resumed`);
      },

      async stop() {
        this.isRunning = false;
        this.isPaused = false;

        // Close browser session
        if (this.driver) {
          try {
            await this.driver.quit();
          } catch (e) {
            // Ignore cleanup errors
          }
          this.driver = null;
        }

        // Update job status
        await this.batchProcessor.stopJob(jobId);

        this.logger.info(`Job ${jobId} stopped`);
      },

      async completeJob() {
        this.isRunning = false;

        // Close browser session
        if (this.driver) {
          try {
            await this.driver.quit();
          } catch (e) {
            // Ignore cleanup errors
          }
          this.driver = null;
        }

        // Complete job
        const completedJob = await this.batchProcessor.completeJob(jobId);

        this.logger.logJobComplete(jobId, {
          success: true,
          completed: completedJob.progress.completed,
          failed: completedJob.progress.failed,
          duration: Date.now() - new Date(completedJob.startedAt).getTime(),
        });

        // Emit job completion event
        this.emitJobComplete(jobId, completedJob);
      },

      isCriticalError(error) {
        const criticalErrors = [
          "browser crashed",
          "profile not found",
          "session expired",
          "out of memory",
        ];

        return criticalErrors.some((criticalError) =>
          error.message.toLowerCase().includes(criticalError)
        );
      },

      emitProgressUpdate(jobId, itemId, progress) {
        // This will be connected to IPC in the next task
        console.log(`Progress update for ${jobId}/${itemId}:`, progress);
      },

      emitItemComplete(jobId, itemId, result) {
        // This will be connected to IPC in the next task
        console.log(`Item complete for ${jobId}/${itemId}:`, result);
      },

      emitItemError(jobId, itemId, error) {
        // This will be connected to IPC in the next task
        console.log(`Item error for ${jobId}/${itemId}:`, error.message);
      },

      emitJobComplete(jobId, job) {
        // This will be connected to IPC in the next task
        console.log(`Job complete for ${jobId}:`, job);
      },

      sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      },
    };
  }

  async pauseJob(jobId) {
    try {
      const worker = this.jobWorkers.get(jobId);
      if (!worker) {
        throw new Error("Job worker not found");
      }

      await worker.pause();
      return true;
    } catch (error) {
      this.logger.error(`Failed to pause job ${jobId}`, error);
      throw error;
    }
  }

  async resumeJob(jobId) {
    try {
      const worker = this.jobWorkers.get(jobId);
      if (!worker) {
        throw new Error("Job worker not found");
      }

      await worker.resume();
      return true;
    } catch (error) {
      this.logger.error(`Failed to resume job ${jobId}`, error);
      throw error;
    }
  }

  async stopJob(jobId) {
    try {
      const worker = this.jobWorkers.get(jobId);
      if (worker) {
        await worker.stop();
        this.jobWorkers.delete(jobId);
      }

      return true;
    } catch (error) {
      this.logger.error(`Failed to stop job ${jobId}`, error);
      throw error;
    }
  }

  async stopAllJobs() {
    try {
      const stopPromises = Array.from(this.jobWorkers.keys()).map((jobId) =>
        this.stopJob(jobId)
      );

      await Promise.all(stopPromises);

      this.logger.info("All jobs stopped");
      return true;
    } catch (error) {
      this.logger.error("Failed to stop all jobs", error);
      throw error;
    }
  }

  getJobStatus(jobId) {
    const job = this.batchProcessor.getJob(jobId);
    const worker = this.jobWorkers.get(jobId);

    if (!job) {
      return null;
    }

    return {
      ...job,
      worker: worker
        ? {
            isRunning: worker.isRunning,
            isPaused: worker.isPaused,
          }
        : null,
    };
  }

  listActiveJobs() {
    return this.batchProcessor.listActiveJobs().map((job) => ({
      ...job,
      worker: this.jobWorkers.has(job.id)
        ? {
            isRunning: this.jobWorkers.get(job.id).isRunning,
            isPaused: this.jobWorkers.get(job.id).isPaused,
          }
        : null,
    }));
  }

  getSystemStatus() {
    const activeJobs = this.listActiveJobs();
    const stats = this.batchProcessor.getJobStatistics();

    return {
      isInitialized: this.isInitialized,
      activeJobs: activeJobs.length,
      runningJobs: activeJobs.filter((job) => job.worker?.isRunning).length,
      pausedJobs: activeJobs.filter((job) => job.worker?.isPaused).length,
      totalProfiles: this.profileManager.listProfiles().length,
      activeSessions: this.profileManager.getActiveSessionCount(),
      statistics: stats,
      config: this.configManager.getConfigSummary(),
    };
  }

  // Profile management methods
  async addProfile(profileData) {
    try {
      const profile = await this.profileManager.addProfile(profileData);
      this.logger.logProfileAction("add", profile.id, { name: profile.name });
      return profile;
    } catch (error) {
      this.logger.logProfileError("add", null, error, profileData);
      throw error;
    }
  }

  async removeProfile(profileId) {
    try {
      // Stop any jobs using this profile
      const activeJobs = this.listActiveJobs();
      const jobsUsingProfile = activeJobs.filter(
        (job) => job.profileId === profileId
      );

      for (const job of jobsUsingProfile) {
        await this.stopJob(job.id);
      }

      await this.profileManager.removeProfile(profileId);
      this.logger.logProfileAction("remove", profileId);
      return true;
    } catch (error) {
      this.logger.logProfileError("remove", profileId, error);
      throw error;
    }
  }

  async testProfile(profileId) {
    try {
      const result = await this.profileManager.testProfileSession(profileId);
      this.logger.logProfileAction("test", profileId, {
        result: result.sessionStatus,
      });
      return result;
    } catch (error) {
      this.logger.logProfileError("test", profileId, error);
      throw error;
    }
  }

  listProfiles() {
    return this.profileManager.listProfiles();
  }

  async createProfileWithLogin(profileData) {
    try {
      this.logger.info("Creating profile with login", {
        name: profileData.name,
      });

      // Generate unique profile path based on OS
      const timestamp = Date.now();
      const profileName = profileData.name.replace(/[^a-zA-Z0-9]/g, "_");

      let chromeBasePath;
      if (process.platform === "win32") {
        chromeBasePath = path.join(
          os.homedir(),
          "AppData/Local/Google/Chrome/User Data"
        );
      } else if (process.platform === "darwin") {
        chromeBasePath = path.join(
          os.homedir(),
          "Library/Application Support/Google/Chrome"
        );
      } else {
        chromeBasePath = path.join(os.homedir(), ".config/google-chrome");
      }

      const profilePath = path.join(
        chromeBasePath,
        `VEO3_Profile_${profileName}_${timestamp}`
      );

      // Ensure the profile directory exists
      const fs = require("fs-extra");
      await fs.ensureDir(profilePath);
      this.logger.info("Created profile directory", { profilePath });

      // Create the profile
      const profile = await this.profileManager.addProfile({
        name: profileData.name,
        path: profilePath,
      });

      // Open browser for login
      this.logger.info("Opening browser for login", { profileId: profile.id });
      const loginResult = await this.profileManager.loginToVEO3(profile.id);

      if (loginResult.success) {
        this.logger.logProfileAction("create_with_login", profile.id, {
          name: profile.name,
          success: true,
        });

        return {
          success: true,
          profile: profile,
          message: "Profile created and login completed successfully",
        };
      } else {
        // If login failed, remove the profile
        await this.profileManager.removeProfile(profile.id);
        throw new Error("Login failed");
      }
    } catch (error) {
      this.logger.logProfileError(
        "create_with_login",
        null,
        error,
        profileData
      );
      throw error;
    }
  }

  async detectSystemProfiles() {
    try {
      this.logger.info("Detecting system Chrome profiles");

      const fs = require("fs-extra");
      const homeDir = os.homedir();

      let chromePath;
      if (process.platform === "win32") {
        chromePath = path.join(
          homeDir,
          "AppData/Local/Google/Chrome/User Data"
        );
      } else if (process.platform === "darwin") {
        chromePath = path.join(
          homeDir,
          "Library/Application Support/Google/Chrome"
        );
      } else {
        chromePath = path.join(homeDir, ".config/google-chrome");
      }

      if (!(await fs.pathExists(chromePath))) {
        this.logger.info(`Chrome directory not found: ${chromePath}`);
        return [];
      }

      const items = await fs.readdir(chromePath);
      const profiles = [];

      for (const item of items) {
        if (item === "Default" || item.startsWith("Profile ")) {
          const profilePath = path.join(chromePath, item);
          const prefsPath = path.join(profilePath, "Preferences");

          let profileInfo = {
            name: item,
            path: profilePath,
            displayName: item === "Default" ? "Default Profile" : item,
          };

          if (await fs.pathExists(prefsPath)) {
            try {
              const prefs = await fs.readJson(prefsPath);
              if (prefs.profile && prefs.profile.name) {
                profileInfo.displayName = prefs.profile.name;
              }
              if (prefs.account_info && prefs.account_info.length > 0) {
                profileInfo.hasAccounts = true;
                profileInfo.accountCount = prefs.account_info.length;
              }
            } catch (e) {
              // Ignore JSON parsing errors
            }
          }

          profiles.push(profileInfo);
        }
      }

      this.logger.info(`Detected ${profiles.length} Chrome profiles`);
      return profiles;
    } catch (error) {
      this.logger.error("Failed to detect system profiles", error);
      throw error;
    }
  }

  // Configuration methods
  getConfig() {
    return this.configManager.config;
  }

  async updateConfig(updates) {
    try {
      await this.configManager.updateConfig(updates);
      this.logger.info("Configuration updated", { updates });
      return true;
    } catch (error) {
      this.logger.error("Failed to update configuration", error);
      throw error;
    }
  }

  // Cleanup and shutdown
  async cleanup() {
    try {
      this.logger.info("Starting cleanup...");

      // Stop all jobs
      await this.stopAllJobs();

      // Close all browser sessions
      await this.profileManager.closeAllSessions();

      // Clean up old logs and backups
      await this.logger.clearOldLogs();
      await this.batchProcessor.cleanupOldJobs();

      this.logger.info("Cleanup completed");
    } catch (error) {
      this.logger.error("Error during cleanup", error);
    }
  }
}

module.exports = AutomationManager;
