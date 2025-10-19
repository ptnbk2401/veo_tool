const fs = require("fs-extra");
const csvParser = require("csv-parser");
const { Builder, By } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const winston = require("winston");
const path = require("path");
const { getChromePath } = require("./chrome-helper");

// Import new modules
const VeoDatabase = require("./db");
const CDPInterceptor = require("./cdp-interceptor-v2");
const SequentialOrchestrator = require("./sequential-orchestrator");

// Configure logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message} ${
        Object.keys(meta).length ? JSON.stringify(meta) : ""
      }`;
    }),
  ),
  transports: [
    new winston.transports.File({ filename: "logs/automation.log" }),
    new winston.transports.Console(),
  ],
});

/**
 * Main API-driven automation function
 * Replaces old DOM-based two-phase automation
 */
async function automateWithAPIQueue(profilePath, prompts, settings = {}) {
  logger.info("=== Starting API-Driven VEO Automation ===");
  logger.info(`Profile: ${profilePath}`);
  logger.info(`Prompts: ${prompts.length}`);
  logger.info(`Settings:`, settings);

  // Initialize database
  const db = new VeoDatabase("data/veo-automation.db");
  await db.init();

  // Prepare prompts data (index starts from 1)
  const promptsData = prompts.map((promptText, index) => ({
    index: index + 1,
    promptText,
  }));

  logger.info(
    `Prepared ${promptsData.length} prompts: ${promptsData.map((p) => `#${p.index}`).join(", ")}`,
  );

  // Clear old data from database (BEFORE inserting new prompts)
  try {
    db.exec("DELETE FROM downloads");
    db.exec("DELETE FROM operations");
    db.exec("DELETE FROM prompts");
    db.save();
    logger.info("Cleared old data from database");
  } catch (clearError) {
    logger.warn(`Failed to clear old data: ${clearError.message}`);
  }

  // Verify database is empty
  const countBefore = db.prepare("SELECT COUNT(*) as count FROM prompts").get();
  logger.info(`Prompts in DB before insert: ${countBefore.count}`);

  // Insert prompts into database
  db.insertPrompts(promptsData);
  logger.info(`Inserted ${promptsData.length} prompts into database`);

  // Verify all prompts were inserted
  const countAfter = db.prepare("SELECT COUNT(*) as count FROM prompts").get();
  logger.info(`Prompts in DB after insert: ${countAfter.count}`);

  if (countAfter.count !== promptsData.length) {
    logger.error(
      `ERROR: Expected ${promptsData.length} prompts but found ${countAfter.count}!`,
    );

    // Show which prompts are in DB
    const allPrompts = db.prepare("SELECT idx FROM prompts ORDER BY idx").all();
    logger.info(
      `Prompts in DB: ${allPrompts.map((p) => `#${p.idx}`).join(", ")}`,
    );
  }

  // Create Selenium driver for authentication
  const driver = await createDriver(profilePath);
  let apiClient = null;
  let orchestrator = null;

  try {
    // Navigate to VEO Flow and authenticate
    logger.info("Opening VEO Flow for authentication...");
    await driver.get("https://labs.google/fx/tools/flow");
    await driver.sleep(3000);

    // Create new project (optional, for clean state)
    try {
      const buttons = await driver.findElements(By.css("button"));
      for (const button of buttons) {
        try {
          const text = await button.getText();
          if (text.includes("Dự án mới") || text.includes("New project")) {
            await driver.executeScript("arguments[0].click();", button);
            logger.info("New project created");
            break;
          }
        } catch (e) {
          continue;
        }
      }
    } catch (error) {
      logger.warn("Could not create project, continuing...");
    }

    await driver.sleep(2000);

    // ========================================
    // Configure VEO Settings (NEW)
    // ========================================
    if (settings.mode || settings.aspectRatio || settings.outputs || settings.model) {
      logger.info("Configuring VEO settings...");
      const { configureVEOSettings } = require('./veo-settings-integration');
      
      try {
        await configureVEOSettings(driver, {
          mode: settings.mode,
          aspectRatio: settings.aspectRatio,
          outputs: settings.outputs,
          model: settings.model
        }, logger);
        logger.info("VEO settings configured successfully");
      } catch (error) {
        logger.warn(`Failed to configure VEO settings: ${error.message}`);
        // Continue anyway - settings might already be correct
      }
    }
    // ========================================

    // Enable CDP network interception
    logger.info("Enabling CDP network interception...");
    const cdpInterceptor = new CDPInterceptor(driver, logger);
    await cdpInterceptor.enable();
    logger.info("CDP enabled - passively monitoring VEO API calls");

    // Create sequential orchestrator
    orchestrator = new SequentialOrchestrator(
      driver,
      cdpInterceptor,
      db,
      logger,
      {
        downloadConcurrency: settings.downloadConcurrency || 5,
        outputDir: settings.outputDir || "outputs",
        onProgress: settings.onProgress, // Pass progress callback to orchestrator
      },
    );

    // Start orchestration
    logger.info("Starting orchestrator (Feeder, Poller, Downloader)...");
    orchestrator.start();

    // Log stats periodically
    const statsInterval = setInterval(() => {
      const stats = orchestrator.getStats();
      logger.info(
        `[Stats] Prompts: queued=${stats.queued}, in_progress=${stats.in_progress}, done=${stats.done}, failed=${stats.failed}, timeout=${stats.timeout} | Ops: total=${stats.total_ops}, downloaded=${stats.downloaded}`,
      );
    }, 10000); // Every 10 seconds

    // Wait for completion
    logger.info("Waiting for all prompts to complete...");
    await orchestrator.waitForCompletion();

    clearInterval(statsInterval);

    // Export manifest
    logger.info("Exporting manifest...");
    const manifest = orchestrator.exportManifest("dist/manifest.json");

    // Get final stats
    const finalStats = orchestrator.getStats();

    // Format results for compatibility with existing UI
    const results = {
      totalPrompts: promptsData.length,
      totalVideos: finalStats.downloaded || 0,
      promptsWithVideos: finalStats.done || 0,
      manifest: manifest,
      prompts: promptsData.map((p) => {
        const promptOps = manifest.filter((m) => m.idx === p.index);
        return {
          index: p.index,
          promptText: p.promptText,
          submitTime: promptOps[0]?.submit_at || null,
          status: promptOps[0]?.prompt_status || "unknown",
        };
      }),
      stats: finalStats,
    };

    logger.info("=== API-Driven Automation Completed ===");
    logger.info(`Total prompts: ${results.totalPrompts}`);
    logger.info(`Total videos downloaded: ${results.totalVideos}`);
    logger.info(`Prompts with videos: ${results.promptsWithVideos}`);

    return results;
  } catch (error) {
    logger.error(`API-driven automation failed: ${error.message}`);
    logger.error(error.stack);
    throw error;
  } finally {
    // Cleanup
    if (orchestrator) {
      orchestrator.stop();
    }

    if (orchestrator && orchestrator.cdp) {
      await orchestrator.cdp.disable();
    }

    if (db) {
      db.close();
    }

    try {
      await driver.quit();
    } catch (e) {
      logger.warn(`Failed to quit driver: ${e.message}`);
    }
  }
}

/**
 * Create Selenium WebDriver
 */
async function createDriver(profilePath) {
  const chromePath = getChromePath();

  const options = new chrome.Options()
    .setChromeBinaryPath(chromePath)
    .addArguments(`--user-data-dir=${profilePath}`)
    .addArguments("--profile-directory=Default")
    .addArguments("--no-first-run")
    .addArguments("--no-default-browser-check")
    .addArguments("--disable-blink-features=AutomationControlled")
    .addArguments(
      "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    )
    .addArguments("--window-size=1920,1080")
    .addArguments("--no-sandbox")
    .excludeSwitches(["enable-automation", "enable-logging"]);

  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(options)
    .build();

  return driver;
}

/**
 * Load prompts from CSV file
 */
async function loadPromptsFromCSV(csvPath) {
  const prompts = [];

  return new Promise((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csvParser())
      .on("data", (row) => {
        if (row.prompt && row.prompt.trim()) {
          prompts.push(row.prompt.trim());
        }
      })
      .on("end", () => {
        logger.info(`Loaded ${prompts.length} prompts from CSV`);
        resolve(prompts);
      })
      .on("error", reject);
  });
}

/**
 * Legacy function for backward compatibility
 * Redirects to new API-driven automation
 */
async function automateWithTwoPhase(profilePath, prompts, settings = {}) {
  logger.warn(
    "automateWithTwoPhase is deprecated, using automateWithAPIQueue instead",
  );
  return automateWithAPIQueue(profilePath, prompts, settings);
}

/**
 * Placeholder for concurrent generation (multi-profile)
 * TODO: Implement multi-profile support with API-driven approach
 */
async function automateConcurrentGeneration(
  profiles,
  prompts,
  settings,
  maxConcurrent = 4,
) {
  logger.error(
    "automateConcurrentGeneration not yet implemented with API-driven approach",
  );
  throw new Error("Multi-profile automation not yet implemented");
}

module.exports = {
  automateWithAPIQueue, // New main function
  automateWithTwoPhase, // Legacy compatibility
  automateConcurrentGeneration,
  loadPromptsFromCSV,
  logger,
};
