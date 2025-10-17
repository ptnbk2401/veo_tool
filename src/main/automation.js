const fs = require("fs-extra");
const csvParser = require("csv-parser");
const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const winston = require("winston");
const { v4: uuidv4 } = require("uuid");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;
const path = require("path");
const { getChromePath } = require("./chrome-helper");

// Configure logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message} ${
        Object.keys(meta).length ? JSON.stringify(meta) : ""
      }`;
    })
  ),
  transports: [
    new winston.transports.File({ filename: "logs/automation.log" }),
    new winston.transports.Console(),
  ],
});

// Check if browser window is still open
async function isWindowOpen(driver) {
  try {
    await driver.getTitle();
    return true;
  } catch (error) {
    return false;
  }
}

// Utility function for safe clicking with retry logic
async function safeClick(driver, selector, retries = 3, timeout = 10000) {
  // Check window first
  if (!(await isWindowOpen(driver))) {
    throw new Error("Browser window was closed");
  }
  for (let i = 0; i < retries; i++) {
    try {
      await driver.wait(until.elementLocated(By.css(selector)), timeout);
      const element = await driver.findElement(By.css(selector));
      await driver.wait(until.elementIsEnabled(element), timeout);
      await element.click();
      logger.info(`Successfully clicked: ${selector}`);
      return;
    } catch (error) {
      logger.warn(
        `Retry ${i + 1}/${retries} for clicking ${selector}: ${error.message}`
      );
      if (i < retries - 1) {
        await driver.sleep(1000);
      }
    }
  }
  throw new Error(`Failed to click ${selector} after ${retries} retries`);
}

// Utility function for safe text input
async function safeInput(driver, selector, text, retries = 3, timeout = 10000) {
  for (let i = 0; i < retries; i++) {
    try {
      await driver.wait(until.elementLocated(By.css(selector)), timeout);
      const element = await driver.findElement(By.css(selector));
      await element.clear();
      await element.sendKeys(text);
      logger.info(`Successfully input text to: ${selector}`);
      return;
    } catch (error) {
      logger.warn(
        `Retry ${i + 1}/${retries} for input to ${selector}: ${error.message}`
      );
      if (i < retries - 1) {
        await driver.sleep(1000);
      }
    }
  }
  throw new Error(
    `Failed to input text to ${selector} after ${retries} retries`
  );
}

// Utility function to wait for element with text content
async function waitForElementWithText(
  driver,
  selector,
  expectedText,
  timeout = 10000
) {
  await driver.wait(async () => {
    try {
      const elements = await driver.findElements(By.css(selector));
      for (const element of elements) {
        const text = await element.getText();
        if (text.includes(expectedText)) {
          return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }, timeout);
}

// Main automation function for single clip creation
async function automateClipCreation(profilePath, prompts, settings) {
  logger.info("Starting automation", {
    profilePath,
    promptCount: prompts.length,
    settings,
  });

  // Ensure required directories exist
  await fs.ensureDir("dist/videos");
  await fs.ensureDir("logs");
  await fs.ensureDir(path.dirname(profilePath));

  // Get Chrome binary path
  const chromePath = getChromePath();
  logger.info(`Using Chrome at: ${chromePath}`);

  // Setup Chrome options with profile
  logger.info(`Profile path: ${profilePath}`);
  logger.info(`Checking profile exists: ${await fs.pathExists(profilePath)}`);

  // Use minimal Chrome options to ensure session loads correctly
  // IMPORTANT: Must use --profile-directory=Default to load the correct profile
  const options = new chrome.Options()
    .setChromeBinaryPath(chromePath)
    .addArguments(`--user-data-dir=${profilePath}`)
    .addArguments("--profile-directory=Default") // Use Default profile where cookies are stored
    .addArguments("--no-first-run")
    .addArguments("--no-default-browser-check")
    .addArguments("--window-size=1920,1080")
    .excludeSwitches(["enable-automation"]); // Hide "Chrome is being controlled" message

  // Add headless mode if specified in settings
  if (settings.headless) {
    options.addArguments("--headless=new");
    logger.info("Running in headless mode");
  } else {
    logger.info("Running in visible mode (you can see Chrome)");
  }

  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(options)
    .build();

  // Setup CSV writer for output
  const csvWriter = createCsvWriter({
    path: "output.csv",
    header: [
      { id: "prompt", title: "Prompt" },
      { id: "filePath", title: "File Path" },
      { id: "timestamp", title: "Timestamp" },
      { id: "status", title: "Status" },
    ],
    append: true,
  });

  const results = [];

  try {
    // Navigate to Google Flow
    logger.info("Navigating to Google Flow");
    await driver.get("https://labs.google/fx/tools/flow");

    // Wait longer for page to fully load and session to be restored
    logger.info("Waiting for page to load...");
    await driver.sleep(5000); // Increased wait time for session restoration

    // Check if user is logged in
    logger.info("Checking login status");
    try {
      // Look for "Sign in with Google" button or similar login indicators
      const loginButtons = await driver.findElements(
        By.css('button, a, [role="button"]')
      );

      for (const button of loginButtons) {
        try {
          const text = await button.getText();
          const lowerText = text.toLowerCase();

          if (
            lowerText.includes("sign in") ||
            lowerText.includes("log in") ||
            lowerText.includes("đăng nhập") ||
            lowerText.includes("login")
          ) {
            logger.error("Not logged in! Found login button:", text);
            console.error("\n❌ ERROR: Not logged in to Google Flow!");
            console.error("\n📋 Please login first:");
            console.error("   1. Run: npm run login");
            console.error("   2. Or run: npm run setup");
            console.error("   3. Login with your Google AI Pro/Ultra account");
            console.error("   4. Then run automation again\n");

            throw new Error(
              "Not logged in. Please login to Google Flow first."
            );
          }
        } catch (e) {
          // Ignore errors getting text from individual buttons
          if (e.message.includes("Not logged in")) {
            throw e; // Re-throw our custom error
          }
        }
      }

      logger.info("Login check passed");
    } catch (error) {
      if (error.message.includes("Not logged in")) {
        throw error;
      }
      // If we can't check login status, continue anyway
      logger.warn("Could not verify login status, continuing...");
    }

    // Create new project - try multiple selectors
    logger.info("Creating new project");
    let projectCreated = false;
    const newProjectSelectors = [
      '[data-testid="new-project"]',
      'button[aria-label*="New"]',
      'button[title*="New"]',
      ".new-project-button",
    ];

    for (const selector of newProjectSelectors) {
      try {
        await safeClick(driver, selector, 1);
        projectCreated = true;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!projectCreated) {
      // Fallback: find by text content
      try {
        const buttons = await driver.findElements(By.css("button"));
        for (const button of buttons) {
          try {
            const text = await button.getText();
            if (
              text.includes("New project") ||
              text.includes("Dự án mới") ||
              text.includes("New")
            ) {
              await button.click();
              projectCreated = true;
              break;
            }
          } catch (e) {
            continue;
          }
        }
      } catch (error) {
        logger.warn("Error finding buttons:", error.message);
      }
    }

    if (!projectCreated) {
      throw new Error(
        'Could not find "New project" button. Please check DOM selectors.'
      );
    }
    await driver.sleep(2000);

    // Select Text to Video mode
    logger.info("Selecting Text to Video mode");
    let modeSelected = false;
    const textToVideoSelectors = [
      '[data-mode="text-to-video"]',
      '[aria-label*="Text to video"]',
      'button[title*="Text to video"]',
    ];

    for (const selector of textToVideoSelectors) {
      try {
        await safeClick(driver, selector, 1);
        modeSelected = true;
        break;
      } catch (e) {
        continue;
      }
    }

    if (!modeSelected) {
      // Fallback: find by text content
      const buttons = await driver.findElements(
        By.css('button, div[role="button"]')
      );
      for (const button of buttons) {
        try {
          const text = await button.getText();
          if (
            text.includes("Text to video") ||
            text.includes("Văn bản sang video")
          ) {
            await button.click();
            modeSelected = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }
    }

    if (!modeSelected) {
      logger.warn('Could not find "Text to video" mode, continuing anyway');
    }
    await driver.sleep(2000);

    // Configure settings
    logger.info("Configuring settings", settings);

    // Click settings/gear icon
    await safeClick(
      driver,
      '.settings-icon, [aria-label*="Settings"], button[title*="Settings"]'
    );
    await driver.sleep(1000);

    // Select Veo 3 model
    try {
      await safeClick(
        driver,
        '[data-model="veo-3"], [value="veo-3"], option:contains("Veo 3")'
      );
      logger.info("Selected Veo 3 model");
    } catch (error) {
      logger.warn("Could not select Veo 3 model, using default");
    }

    // Set aspect ratio
    try {
      await safeClick(
        driver,
        `[data-aspect-ratio="${settings.aspectRatio}"], [value="${settings.aspectRatio}"]`
      );
      logger.info(`Selected aspect ratio: ${settings.aspectRatio}`);
    } catch (error) {
      logger.warn(
        `Could not set aspect ratio to ${settings.aspectRatio}, using default`
      );
    }

    // Set output count
    try {
      const outputCountSelector =
        '[data-output-count], input[type="number"][aria-label*="output"], input[type="number"][name*="count"]';
      await safeInput(
        driver,
        outputCountSelector,
        settings.outputCount.toString()
      );
      logger.info(`Set output count: ${settings.outputCount}`);
    } catch (error) {
      logger.warn(
        `Could not set output count to ${settings.outputCount}, using default`
      );
    }

    // Close settings panel
    try {
      await safeClick(
        driver,
        '.close-settings, [aria-label*="Close"], button:contains("Close")'
      );
    } catch (error) {
      // Settings panel might close automatically
      logger.info("Settings panel closed or not found");
    }

    // Process each prompt
    for (let i = 0; i < prompts.length; i++) {
      const prompt = prompts[i];
      logger.info(
        `Processing prompt ${i + 1}/${prompts.length}: ${prompt.substring(
          0,
          50
        )}...`
      );

      try {
        // Clear and enter prompt
        const promptBoxSelector =
          '#prompt-box, [data-testid="prompt-input"], textarea[placeholder*="prompt"], textarea[aria-label*="prompt"]';
        await safeInput(driver, promptBoxSelector, prompt);
        await driver.sleep(1000);

        // Click generate button
        await safeClick(
          driver,
          '#generate-button, [data-testid="generate"], button:contains("Generate"), button[aria-label*="Generate"]'
        );
        logger.info("Generate button clicked, waiting for completion...");

        // Wait for clip to complete (with extended timeout)
        const completionSelector =
          '.clip-status-complete, [data-status="complete"], .status-complete, [aria-label*="Complete"]';
        await driver.wait(
          until.elementLocated(By.css(completionSelector)),
          120000
        ); // 2 minutes timeout
        logger.info("Clip generation completed");

        // Wait a bit more to ensure download button is ready
        await driver.sleep(2000);

        // Click download button
        const downloadSelector =
          '.download-icon, [data-testid="download"], button[aria-label*="Download"], [title*="Download"]';
        await safeClick(driver, downloadSelector);
        logger.info("Download initiated");

        // Wait for download to complete
        await driver.sleep(5000);

        // Generate unique filename and move file
        const fileId = uuidv4();
        const fileName = `video-${fileId}.mp4`;
        const filePath = path.join("dist/videos", fileName);

        // Try to find and move the downloaded file
        const downloadDir = path.join(require("os").homedir(), "Downloads");
        const possibleFiles = [
          path.join(downloadDir, "video.mp4"),
          path.join(downloadDir, "flow-video.mp4"),
          path.join(downloadDir, "generated-video.mp4"),
        ];

        let moved = false;
        for (const possibleFile of possibleFiles) {
          if (await fs.pathExists(possibleFile)) {
            await fs.move(possibleFile, filePath);
            moved = true;
            logger.info(`Moved video file to: ${filePath}`);
            break;
          }
        }

        if (!moved) {
          throw new Error("Downloaded video file not found");
        }

        // Record success
        const result = {
          prompt,
          filePath,
          timestamp: new Date().toISOString(),
          status: "success",
        };

        results.push(result);
        await csvWriter.writeRecords([result]);
        logger.info(`Successfully processed prompt ${i + 1}/${prompts.length}`);
      } catch (error) {
        logger.error(`Failed to process prompt ${i + 1}: ${error.message}`);

        // Record failure
        const result = {
          prompt,
          filePath: "",
          timestamp: new Date().toISOString(),
          status: `error: ${error.message}`,
        };

        results.push(result);
        await csvWriter.writeRecords([result]);
      }

      // Small delay between prompts
      if (i < prompts.length - 1) {
        await driver.sleep(2000);
      }
    }
  } catch (error) {
    logger.error(`Automation failed: ${error.message}`);

    // Check if window was closed
    if (
      error.message.includes("window already closed") ||
      error.message.includes("web view not found")
    ) {
      logger.error("Browser window was closed unexpectedly!");
      logger.error("Possible causes:");
      logger.error("  1. You closed Chrome manually");
      logger.error("  2. Chrome crashed");
      logger.error("  3. DOM selectors are incorrect");
      logger.error("\nTips:");
      logger.error("  - Don't close Chrome while automation is running");
      logger.error("  - Check logs/automation.log for details");
      logger.error("  - Verify DOM selectors are correct (see README)");
    }

    throw error;
  } finally {
    try {
      await driver.quit();
      logger.info("Browser closed");
    } catch (e) {
      // Ignore cleanup errors
    }
  }

  return results;
}

// Concurrent generation function (for multiple profiles)
async function automateConcurrentGeneration(
  profiles,
  prompts,
  settings,
  maxConcurrent = 4
) {
  logger.info("Starting concurrent generation", {
    profileCount: profiles.length,
    promptCount: prompts.length,
    maxConcurrent,
  });

  const results = [];
  const activeJobs = new Map();
  let promptIndex = 0;

  // Create CSV writer for concurrent results
  const csvWriter = createCsvWriter({
    path: "output.csv",
    header: [
      { id: "prompt", title: "Prompt" },
      { id: "filePath", title: "File Path" },
      { id: "timestamp", title: "Timestamp" },
      { id: "status", title: "Status" },
      { id: "profileId", title: "Profile ID" },
    ],
    append: true,
  });

  // Function to process a single prompt with a profile
  async function processPromptWithProfile(profilePath, profileId, prompt) {
    const driver = await createDriverForProfile(profilePath);

    try {
      // Setup Flow for this profile (similar to single automation but streamlined)
      await setupFlowForProfile(driver, settings);

      // Generate video
      const result = await generateVideoForPrompt(driver, prompt, profileId);

      // Record result
      await csvWriter.writeRecords([result]);
      results.push(result);

      return result;
    } finally {
      await driver.quit();
    }
  }

  // Start initial jobs
  for (
    let i = 0;
    i < Math.min(maxConcurrent, profiles.length, prompts.length);
    i++
  ) {
    if (promptIndex < prompts.length) {
      const profile = profiles[i % profiles.length];
      const prompt = prompts[promptIndex++];

      const jobPromise = processPromptWithProfile(
        profile.path,
        profile.id,
        prompt
      );
      activeJobs.set(`job-${i}`, jobPromise);
    }
  }

  // Process remaining prompts as jobs complete
  while (activeJobs.size > 0 && promptIndex < prompts.length) {
    // Wait for any job to complete
    const completedJobKey = await Promise.race(
      Array.from(activeJobs.entries()).map(async ([key, promise]) => {
        try {
          await promise;
          return key;
        } catch (error) {
          logger.error(`Job ${key} failed: ${error.message}`);
          return key;
        }
      })
    );

    // Remove completed job
    activeJobs.delete(completedJobKey);

    // Start new job if there are more prompts
    if (promptIndex < prompts.length) {
      const profileIndex = parseInt(completedJobKey.split("-")[1]);
      const profile = profiles[profileIndex % profiles.length];
      const prompt = prompts[promptIndex++];

      const jobPromise = processPromptWithProfile(
        profile.path,
        profile.id,
        prompt
      );
      activeJobs.set(completedJobKey, jobPromise);
    }
  }

  // Wait for all remaining jobs to complete
  await Promise.allSettled(Array.from(activeJobs.values()));

  logger.info(
    `Concurrent generation completed. Processed ${results.length} prompts`
  );
  return results;
}

// Helper function to create driver for profile
async function createDriverForProfile(profilePath) {
  const options = new chrome.Options()
    .addArguments(`--user-data-dir=${profilePath}`)
    .addArguments("--no-sandbox")
    .addArguments("--disable-dev-shm-usage")
    .addArguments("--disable-blink-features=AutomationControlled")
    .addArguments("--window-size=1920,1080");

  return await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(options)
    .build();
}

// Helper function to setup Flow for a profile
async function setupFlowForProfile(driver, settings) {
  await driver.get("https://labs.google/fx/tools/flow");
  await driver.sleep(3000);

  // Create new project and configure (streamlined version)
  await safeClick(
    driver,
    '[data-testid="new-project"], button[aria-label*="New"]'
  );
  await driver.sleep(2000);

  await safeClick(driver, '[data-mode="text-to-video"]');
  await driver.sleep(2000);

  // Quick settings configuration
  try {
    await safeClick(driver, '.settings-icon, [aria-label*="Settings"]');
    await driver.sleep(1000);

    await safeClick(driver, `[data-aspect-ratio="${settings.aspectRatio}"]`);
    await safeClick(driver, '.close-settings, [aria-label*="Close"]');
  } catch (error) {
    logger.warn("Could not configure settings for profile, using defaults");
  }
}

// Helper function to generate video for a specific prompt
async function generateVideoForPrompt(driver, prompt, profileId) {
  const startTime = Date.now();

  try {
    // Enter prompt
    const promptBoxSelector =
      '#prompt-box, [data-testid="prompt-input"], textarea[placeholder*="prompt"]';
    await safeInput(driver, promptBoxSelector, prompt);

    // Generate
    await safeClick(
      driver,
      '#generate-button, [data-testid="generate"], button:contains("Generate")'
    );

    // Wait for completion
    await driver.wait(
      until.elementLocated(
        By.css('.clip-status-complete, [data-status="complete"]')
      ),
      120000
    );

    // Download
    await safeClick(driver, '.download-icon, [data-testid="download"]');
    await driver.sleep(5000);

    // Move file
    const fileId = uuidv4();
    const fileName = `video-${fileId}-${profileId}.mp4`;
    const filePath = path.join("dist/videos", fileName);

    const downloadDir = path.join(require("os").homedir(), "Downloads");
    const sourceFile = path.join(downloadDir, "video.mp4");

    if (await fs.pathExists(sourceFile)) {
      await fs.move(sourceFile, filePath);
    } else {
      throw new Error("Downloaded video file not found");
    }

    return {
      prompt,
      filePath,
      timestamp: new Date().toISOString(),
      status: "success",
      profileId,
      processingTime: Date.now() - startTime,
    };
  } catch (error) {
    return {
      prompt,
      filePath: "",
      timestamp: new Date().toISOString(),
      status: `error: ${error.message}`,
      profileId,
      processingTime: Date.now() - startTime,
    };
  }
}

// Function to load prompts from CSV
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

module.exports = {
  automateClipCreation,
  automateConcurrentGeneration,
  loadPromptsFromCSV,
  logger,
};
