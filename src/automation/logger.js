const winston = require("winston");
const fs = require("fs-extra");
const path = require("path");

class Logger {
  constructor(options = {}) {
    this.logsDir = options.logsDir || path.join(process.cwd(), "logs");
    this.maxFiles = options.maxFiles || 10;
    this.maxSize = options.maxSize || "10m";
    this.logLevel = options.logLevel || "info";
    this.module = options.module || "App";

    this.init();
  }

  async init() {
    // Ensure logs directory exists
    await fs.ensureDir(this.logsDir);

    // Create Winston logger
    this.logger = winston.createLogger({
      level: this.logLevel,
      format: winston.format.combine(
        winston.format.timestamp({
          format: "YYYY-MM-DD HH:mm:ss",
        }),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: {
        service: "veo3-automation",
        module: this.module,
      },
      transports: [
        // Error log file
        new winston.transports.File({
          filename: path.join(this.logsDir, "error.log"),
          level: "error",
          maxsize: this.maxSize,
          maxFiles: this.maxFiles,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          ),
        }),

        // Combined log file
        new winston.transports.File({
          filename: path.join(this.logsDir, "combined.log"),
          maxsize: this.maxSize,
          maxFiles: this.maxFiles,
          format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
          ),
        }),

        // Console output
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({
              format: "HH:mm:ss",
            }),
            winston.format.printf(
              ({ timestamp, level, message, module, ...meta }) => {
                const metaStr = Object.keys(meta).length
                  ? JSON.stringify(meta, null, 2)
                  : "";
                return `${timestamp} [${
                  module || "App"
                }] ${level}: ${message} ${metaStr}`;
              }
            )
          ),
        }),
      ],
    });

    // Create separate loggers for different components
    this.createComponentLoggers();
  }

  createComponentLoggers() {
    const components = ["automation", "browser", "csv", "profiles", "ui"];

    this.componentLoggers = {};

    components.forEach((component) => {
      this.componentLoggers[component] = winston.createLogger({
        level: this.logLevel,
        format: winston.format.combine(
          winston.format.timestamp(),
          winston.format.json()
        ),
        defaultMeta: {
          service: "veo3-automation",
          component,
        },
        transports: [
          new winston.transports.File({
            filename: path.join(this.logsDir, `${component}.log`),
            maxsize: this.maxSize,
            maxFiles: 5,
          }),
        ],
      });
    });
  }

  info(message, meta = {}) {
    this.logger.info(message, { ...meta, module: this.module });
  }

  error(message, error = null, meta = {}) {
    const errorMeta = {
      ...meta,
      module: this.module,
    };

    if (error) {
      errorMeta.error = {
        message: error.message,
        stack: error.stack,
        name: error.name,
      };
    }

    this.logger.error(message, errorMeta);
  }

  warn(message, meta = {}) {
    this.logger.warn(message, { ...meta, module: this.module });
  }

  debug(message, meta = {}) {
    this.logger.debug(message, { ...meta, module: this.module });
  }

  verbose(message, meta = {}) {
    this.logger.verbose(message, { ...meta, module: this.module });
  }

  // Component-specific logging methods
  logAutomation(level, message, meta = {}) {
    if (this.componentLoggers.automation) {
      this.componentLoggers.automation[level](message, meta);
    }
    this[level](message, { ...meta, component: "automation" });
  }

  logBrowser(level, message, meta = {}) {
    if (this.componentLoggers.browser) {
      this.componentLoggers.browser[level](message, meta);
    }
    this[level](message, { ...meta, component: "browser" });
  }

  logCSV(level, message, meta = {}) {
    if (this.componentLoggers.csv) {
      this.componentLoggers.csv[level](message, meta);
    }
    this[level](message, { ...meta, component: "csv" });
  }

  logProfiles(level, message, meta = {}) {
    if (this.componentLoggers.profiles) {
      this.componentLoggers.profiles[level](message, meta);
    }
    this[level](message, { ...meta, component: "profiles" });
  }

  logUI(level, message, meta = {}) {
    if (this.componentLoggers.ui) {
      this.componentLoggers.ui[level](message, meta);
    }
    this[level](message, { ...meta, component: "ui" });
  }

  // Job-specific logging
  logJobStart(jobId, jobData) {
    this.info("Job started", {
      jobId,
      csvPath: jobData.csvPath,
      profileId: jobData.profileId,
      totalItems: jobData.progress?.total || 0,
    });
  }

  logJobProgress(jobId, progress) {
    this.info("Job progress update", {
      jobId,
      completed: progress.completed,
      failed: progress.failed,
      total: progress.total,
      percentage: progress.percentage,
    });
  }

  logJobComplete(jobId, result) {
    this.info("Job completed", {
      jobId,
      success: result.success,
      completed: result.completed,
      failed: result.failed,
      duration: result.duration,
    });
  }

  logItemStart(jobId, itemId, item) {
    this.info("Item processing started", {
      jobId,
      itemId,
      prompt: item.Prompt?.substring(0, 100) + "...",
      flowUrl: item.Flow_URL,
    });
  }

  logItemComplete(jobId, itemId, result) {
    this.info("Item processing completed", {
      jobId,
      itemId,
      success: result.success,
      videoPath: result.videoPath,
      renderTime: result.renderTime,
    });
  }

  logItemError(jobId, itemId, error) {
    this.error("Item processing failed", error, {
      jobId,
      itemId,
      attempts: error.attempt || 1,
    });
  }

  // Browser automation logging
  logBrowserAction(action, details = {}) {
    this.logBrowser("info", `Browser action: ${action}`, details);
  }

  logBrowserError(action, error, details = {}) {
    this.logBrowser("error", `Browser action failed: ${action}`, {
      ...details,
      error: {
        message: error.message,
        stack: error.stack,
      },
    });
  }

  // Profile management logging
  logProfileAction(action, profileId, details = {}) {
    this.logProfiles("info", `Profile action: ${action}`, {
      profileId,
      ...details,
    });
  }

  logProfileError(action, profileId, error, details = {}) {
    this.logProfiles("error", `Profile action failed: ${action}`, {
      profileId,
      ...details,
      error: {
        message: error.message,
        stack: error.stack,
      },
    });
  }

  // Get recent logs for UI display
  async getRecentLogs(limit = 100, level = null) {
    try {
      const logFile = path.join(this.logsDir, "combined.log");

      if (!(await fs.pathExists(logFile))) {
        return [];
      }

      const content = await fs.readFile(logFile, "utf8");
      const lines = content
        .trim()
        .split("\n")
        .filter((line) => line.trim());

      // Parse JSON logs
      const logs = lines
        .slice(-limit * 2) // Get more lines to account for filtering
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch (e) {
            return null;
          }
        })
        .filter((log) => log !== null)
        .filter((log) => !level || log.level === level)
        .slice(-limit)
        .reverse(); // Most recent first

      return logs;
    } catch (error) {
      console.error("Failed to get recent logs:", error);
      return [];
    }
  }

  // Clear old logs
  async clearOldLogs(daysToKeep = 7) {
    try {
      const files = await fs.readdir(this.logsDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      let clearedCount = 0;

      for (const file of files) {
        if (file.endsWith(".log")) {
          const filePath = path.join(this.logsDir, file);
          const stats = await fs.stat(filePath);

          if (stats.mtime < cutoffDate) {
            await fs.remove(filePath);
            clearedCount++;
            this.info(`Removed old log file: ${file}`);
          }
        }
      }

      if (clearedCount > 0) {
        this.info(`Cleared ${clearedCount} old log files`);
      }

      return clearedCount;
    } catch (error) {
      this.error("Failed to clear old logs", error);
      return 0;
    }
  }

  // Export logs for debugging
  async exportLogs(outputPath, options = {}) {
    try {
      const {
        startDate = null,
        endDate = null,
        level = null,
        component = null,
      } = options;

      const logs = await this.getRecentLogs(10000); // Get large number of logs

      let filteredLogs = logs;

      // Apply filters
      if (startDate) {
        filteredLogs = filteredLogs.filter(
          (log) => new Date(log.timestamp) >= new Date(startDate)
        );
      }

      if (endDate) {
        filteredLogs = filteredLogs.filter(
          (log) => new Date(log.timestamp) <= new Date(endDate)
        );
      }

      if (level) {
        filteredLogs = filteredLogs.filter((log) => log.level === level);
      }

      if (component) {
        filteredLogs = filteredLogs.filter(
          (log) => log.component === component
        );
      }

      // Export as JSON
      await fs.writeJson(
        outputPath,
        {
          exportDate: new Date().toISOString(),
          filters: options,
          logCount: filteredLogs.length,
          logs: filteredLogs,
        },
        { spaces: 2 }
      );

      this.info(`Exported ${filteredLogs.length} logs to ${outputPath}`);
      return filteredLogs.length;
    } catch (error) {
      this.error("Failed to export logs", error);
      throw error;
    }
  }

  // Get log statistics
  async getLogStatistics() {
    try {
      const logs = await this.getRecentLogs(1000);

      const stats = {
        total: logs.length,
        byLevel: {},
        byComponent: {},
        byModule: {},
        recentErrors: [],
      };

      logs.forEach((log) => {
        // Count by level
        stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;

        // Count by component
        if (log.component) {
          stats.byComponent[log.component] =
            (stats.byComponent[log.component] || 0) + 1;
        }

        // Count by module
        if (log.module) {
          stats.byModule[log.module] = (stats.byModule[log.module] || 0) + 1;
        }

        // Collect recent errors
        if (log.level === "error" && stats.recentErrors.length < 10) {
          stats.recentErrors.push({
            timestamp: log.timestamp,
            message: log.message,
            module: log.module,
            component: log.component,
          });
        }
      });

      return stats;
    } catch (error) {
      console.error("Failed to get log statistics:", error);
      return null;
    }
  }

  // Set log level dynamically
  setLogLevel(level) {
    this.logLevel = level;
    this.logger.level = level;

    // Update component loggers
    Object.values(this.componentLoggers).forEach((logger) => {
      logger.level = level;
    });

    this.info(`Log level changed to: ${level}`);
  }
}

module.exports = Logger;
