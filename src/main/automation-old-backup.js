const fs = require("fs-extra");
const csvParser = require("csv-parser");
const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const winston = require("winston");

const path = require("path");
const { getChromePath } = require("./chrome-helper");
const https = require("https");
const http = require("http");

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

// Check if browser window is still open
async function isWindowOpen(driver) {
  try {
    await driver.getTitle();
    return true;
  } catch (error) {
    return false;
  }
}

// Download video from URL
async function downloadVideo(url, filePath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https:") ? https : http;

    const request = protocol.get(url, (response) => {
      if (response.statusCode === 200) {
        const fileStream = fs.createWriteStream(filePath);
        response.pipe(fileStream);

        fileStream.on("finish", () => {
          fileStream.close();
          logger.info(`Video downloaded successfully to: ${filePath}`);
          resolve(filePath);
        });

        fileStream.on("error", (error) => {
          fs.unlink(filePath, () => {}); // Delete partial file
          reject(error);
        });
      } else if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirects
        const redirectUrl = response.headers.location;
        logger.info(`Following redirect to: ${redirectUrl}`);
        downloadVideo(redirectUrl, filePath).then(resolve).catch(reject);
      } else {
        reject(
          new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`),
        );
      }
    });

    request.on("error", (error) => {
      reject(error);
    });

    request.setTimeout(60000, () => {
      request.abort();
      reject(new Error("Download timeout"));
    });
  });
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

      // Scroll to element first
      await driver.executeScript(
        "arguments[0].scrollIntoView({behavior: 'instant', block: 'center'});",
        element,
      );
      await driver.sleep(200);

      // Try multiple click methods
      try {
        // Method 1: Regular click
        await element.click();
      } catch (clickError) {
        try {
          // Method 2: JavaScript click (bypasses overlays)
          await driver.executeScript("arguments[0].click();", element);
        } catch (jsClickError) {
          // Method 3: Action click
          const actions = driver.actions();
          await actions.move({ origin: element }).click().perform();
        }
      }

      logger.info(`Successfully clicked: ${selector}`);
      return;
    } catch (error) {
      logger.warn(
        `Retry ${i + 1}/${retries} for clicking ${selector}: ${error.message}`,
      );
      if (i < retries - 1) {
        await driver.sleep(500); // Reduced sleep time
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

      // Scroll to element and make sure it's visible
      await driver.executeScript("arguments[0].scrollIntoView(true);", element);
      await driver.sleep(300);

      // Click to focus
      await element.click();
      await driver.sleep(300);

      // Clear and input text
      await element.clear();
      await driver.sleep(200);

      // Try different methods to input text
      try {
        await element.sendKeys(text);
      } catch (e) {
        // Fallback: use JavaScript to set value
        await driver.executeScript(
          "arguments[0].value = arguments[1];",
          element,
          text,
        );
        // Trigger input event
        await driver.executeScript(
          "arguments[0].dispatchEvent(new Event('input', { bubbles: true }));",
          element,
        );
      }

      // Verify text was entered
      const currentValue = await element.getAttribute("value");
      if (currentValue === text || currentValue.includes(text)) {
        logger.info(`Successfully input text to: ${selector}`);
        return;
      } else {
        throw new Error(
          `Text verification failed. Expected: ${text}, Got: ${currentValue}`,
        );
      }
    } catch (error) {
      logger.warn(
        `Retry ${i + 1}/${retries} for input to ${selector}: ${error.message}`,
      );
      if (i < retries - 1) {
        await driver.sleep(1000);
      }
    }
  }
  throw new Error(
    `Failed to input text to ${selector} after ${retries} retries`,
  );
}

// Utility function to wait for element with text content
async function waitForElementWithText(
  driver,
  selector,
  expectedText,
  timeout = 10000,
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

// Concurrent generation function (for multiple profiles)
async function automateConcurrentGeneration(
  profiles,
  prompts,
  settings,
  maxConcurrent = 4,
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
        prompt,
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
      }),
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
        prompt,
      );
      activeJobs.set(completedJobKey, jobPromise);
    }
  }

  // Wait for all remaining jobs to complete
  await Promise.allSettled(Array.from(activeJobs.values()));

  logger.info(
    `Concurrent generation completed. Processed ${results.length} prompts`,
  );
  return results;
}

// Helper function to create driver for profile
async function createDriverForProfile(profilePath) {
  const chromePath = getChromePath();

  const options = new chrome.Options()
    .setChromeBinaryPath(chromePath)
    .addArguments(`--user-data-dir=${profilePath}`)
    .addArguments("--profile-directory=Default")
    .addArguments("--no-sandbox")
    .addArguments("--disable-dev-shm-usage")
    .addArguments("--disable-blink-features=AutomationControlled")
    .addArguments("--disable-extensions")
    .addArguments("--disable-plugins")
    .addArguments("--disable-web-security")
    .addArguments(
      "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    )
    .addArguments("--window-size=1920,1080")
    .excludeSwitches(["enable-automation", "enable-logging"])
    .addArguments("--disable-infobars");

  return await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(options)
    .build();
}

// Helper function to setup Flow for a profile
async function setupFlowForProfile(driver, settings) {
  await driver.get("https://labs.google/fx/tools/flow");
  await driver.sleep(3000);

  // Create new project only - skip mode and settings
  try {
    const buttons = await driver.findElements(By.css("button"));
    for (const button of buttons) {
      try {
        const text = await button.getText();
        if (text.includes("Dự án mới") || text.includes("New project")) {
          await driver.executeScript("arguments[0].click();", button);
          logger.info("New project created for concurrent processing");
          break;
        }
      } catch (e) {
        continue;
      }
    }
  } catch (error) {
    logger.warn("Could not create new project for profile, continuing anyway");
  }

  await driver.sleep(1000);
}

// Helper function to generate video for a specific prompt
async function generateVideoForPrompt(driver, prompt, profileId) {
  const startTime = Date.now();

  try {
    // Enter prompt (simple - only one textarea on page)
    const textarea = await driver.findElement(By.css("textarea"));
    await textarea.click();
    await driver.sleep(200);
    await textarea.clear();
    await textarea.sendKeys(prompt);

    // Wait for generate button to be enabled and click
    await driver.wait(async () => {
      const buttons = await driver.findElements(
        By.css("button:not([disabled])"),
      );
      for (const button of buttons) {
        try {
          const text = await button.getText();
          const ariaLabel = (await button.getAttribute("aria-label")) || "";
          if (
            text.includes("Tạo") ||
            text.includes("Generate") ||
            ariaLabel.includes("Tạo") ||
            ariaLabel.includes("Generate")
          ) {
            return true;
          }
        } catch (e) {
          continue;
        }
      }
      return false;
    }, 30000);

    // Click the enabled generate button
    const allButtons = await driver.findElements(
      By.css("button:not([disabled])"),
    );
    for (const button of allButtons) {
      try {
        const text = await button.getText();
        const ariaLabel = (await button.getAttribute("aria-label")) || "";
        if (
          text.includes("Tạo") ||
          text.includes("Generate") ||
          ariaLabel.includes("Tạo") ||
          ariaLabel.includes("Generate")
        ) {
          await button.click();
          break;
        }
      } catch (e) {
        continue;
      }
    }

    // Wait for video generation completion
    await driver.wait(async () => {
      try {
        const videoElements = await driver.findElements(
          By.css('video[src*="storage.googleapis.com"]'),
        );
        if (videoElements.length > 0) {
          const videoSrc = await videoElements[0].getAttribute("src");
          return (
            videoSrc &&
            videoSrc.includes("storage.googleapis.com/ai-sandbox-videofx")
          );
        }
        return false;
      } catch (error) {
        return false;
      }
    }, 120000);

    // Get video URL and download
    const videoElements = await driver.findElements(
      By.css('video[src*="storage.googleapis.com"]'),
    );
    if (videoElements.length === 0) {
      throw new Error("Video element not found after generation");
    }

    const videoSrc = await videoElements[0].getAttribute("src");
    // Create filename from prompt (use a counter for concurrent processing)
    const safeFilename = createSafeFilename(prompt, Date.now() % 1000);
    const fileName = `${safeFilename}_profile-${profileId}.mp4`;
    const filePath = path.join("dist/videos", fileName);

    // Download using JavaScript
    await driver.executeScript(
      `
      const link = document.createElement('a');
      link.href = arguments[0];
      link.download = arguments[1];
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    `,
      videoSrc,
      fileName,
    );

    await driver.sleep(5000);

    // Try to move downloaded file
    const downloadDir = path.join(require("os").homedir(), "Downloads");
    const sourceFile = path.join(downloadDir, fileName);

    if (await fs.pathExists(sourceFile)) {
      await fs.move(sourceFile, filePath);
    } else {
      // Save URL as fallback with descriptive name
      const urlFilePath = path.join(
        "dist/videos",
        `${safeFilename}_profile-${profileId}_url.txt`,
      );
      await fs.writeFile(
        urlFilePath,
        `Prompt: ${prompt}\n\nVideo URL:\n${videoSrc}`,
      );
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

// ============================================================================
// TWO-PHASE AUTOMATION (NEW)
// ============================================================================

// Two-Phase Constants
const MAX_INFLIGHT_TWO_PHASE = 5;
const DOWNLOAD_CONCURRENCY_TWO_PHASE = 5;
const RETRY_MAX_TWO_PHASE = 3;

// Two-Phase Global state
let twoPhasePrompts = [];
let twoPhaseInFlight = [];
let twoPhaseScroller = null;
let twoPhaseManifest = [];

// Create tail slug from last 50 chars of prompt
function createTailSlug(promptText) {
  const tail50 = promptText.slice(-50);
  return tail50
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Create VEO filename with promptIndex
function createVeoFilename(
  promptIndex,
  tailSlug,
  takeIndex,
  variant = "veo3",
  durationSec = 8,
) {
  const dateISO = new Date().toISOString().slice(0, 10);
  const pIdx3 = String(promptIndex).padStart(3, "0");
  const takeIdx2 = String(takeIndex).padStart(2, "0");
  return `${dateISO}_${pIdx3}_${tailSlug}_${variant}_${takeIdx2}_${durationSec}s.mp4`;
}

// Initialize prompts for two-phase
function initializeTwoPhasePrompts(inputPrompts) {
  twoPhasePrompts = inputPrompts.map((promptText, index) => ({
    index: index + 1,
    promptText,
    tail50: promptText.slice(-50),
    tailSlug: createTailSlug(promptText),
    submitTime: null,
  }));

  logger.info(
    `Initialized ${twoPhasePrompts.length} prompts for two-phase processing`,
  );
  return twoPhasePrompts;
}

// Find scroller for two-phase
async function findTwoPhaseScroller(driver) {
  try {
    twoPhaseScroller = await driver.executeScript(`
            const virtuosoList = document.querySelector('div[data-testid="virtuoso-item-list"]');
            if (!virtuosoList) return null;
            
            let parent = virtuosoList.parentElement;
            while (parent && parent !== document.body) {
                const style = window.getComputedStyle(parent);
                if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                    return parent;
                }
                parent = parent.parentElement;
            }
            return null;
        `);

    return twoPhaseScroller;
  } catch (error) {
    logger.warn(`Failed to find scroller: ${error.message}`);
    return null;
  }
}

// Two-Phase: Submit all prompts
async function twoPhaseSubmitPrompts(driver, textarea) {
  logger.info("=== PHASE A: Starting prompt submission ===");

  const queue = [...twoPhasePrompts];
  twoPhaseInFlight = [];
  let jobIdCounter = 1;

  // Check if can submit more
  const canSubmitMore = () =>
    twoPhaseInFlight.filter((j) => !j.slotReleased).length <
    MAX_INFLIGHT_TWO_PHASE;

  // Submit next prompt
  const submitNextPrompt = async (jobId) => {
    if (queue.length === 0) return false;

    const promptData = queue.shift();

    logger.info(
      `Submitting prompt ${promptData.index}/${twoPhasePrompts.length}: ${promptData.tailSlug}`,
    );

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Wait for textarea to be ready and enabled
        logger.info(
          `Attempt ${attempt}/${maxRetries} to submit prompt ${promptData.index}`,
        );

        await driver.wait(
          async () => {
            try {
              const ta = await driver.findElement(By.css("textarea"));
              const isEnabled = await ta.isEnabled();
              const isDisplayed = await ta.isDisplayed();
              return isEnabled && isDisplayed;
            } catch (e) {
              return false;
            }
          },
          10000,
          "Textarea not ready",
        );

        // Get fresh textarea reference
        const ta = await driver.findElement(By.css("textarea"));

        // Focus and clear using multiple methods
        await ta.click();
        await driver.sleep(200);

        // Method 1: Select all and delete
        await driver.executeScript(
          `
                    const textarea = arguments[0];
                    textarea.focus();
                    textarea.select();
                    textarea.value = '';
                `,
          ta,
        );

        await driver.sleep(100);

        // Method 2: Send keys to ensure it's cleared
        await ta.clear();
        await driver.sleep(100);

        // Input prompt using native setter for reliability
        await driver.executeScript(
          `
                    const textarea = arguments[0];
                    const prompt = arguments[1];
                    
                    // Set value
                    textarea.value = prompt;
                    
                    // Trigger events
                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                    textarea.dispatchEvent(new Event('change', { bubbles: true }));
                    
                    // Focus to ensure UI updates
                    textarea.focus();
                `,
          ta,
          promptData.promptText,
        );

        await driver.sleep(300);

        // Verify prompt was entered correctly
        const currentValue = await ta.getAttribute("value");
        if (
          !currentValue ||
          currentValue.trim() !== promptData.promptText.trim()
        ) {
          throw new Error(
            `Prompt verification failed. Expected length: ${promptData.promptText.length}, Got: ${currentValue?.length || 0}`,
          );
        }

        logger.info(
          `Prompt ${promptData.index} entered and verified successfully`,
        );

        // Wait for Generate button to be enabled
        await driver.wait(
          async () => {
            try {
              const buttons = await driver.findElements(
                By.css("button:not([disabled])"),
              );
              for (const button of buttons) {
                try {
                  const text = await button.getText();
                  if (
                    text.includes("Tạo") ||
                    text.includes("Generate") ||
                    text.includes("Create")
                  ) {
                    return true;
                  }
                } catch (e) {
                  continue;
                }
              }
              return false;
            } catch (e) {
              return false;
            }
          },
          5000,
          "Generate button not enabled",
        );

        // Click generate button
        let buttonClicked = false;
        const buttons = await driver.findElements(
          By.css("button:not([disabled])"),
        );
        for (const button of buttons) {
          try {
            const text = await button.getText();
            if (
              text.includes("Tạo") ||
              text.includes("Generate") ||
              text.includes("Create")
            ) {
              await driver.executeScript("arguments[0].click();", button);
              buttonClicked = true;
              logger.info(
                `Generate button clicked for prompt ${promptData.index}`,
              );
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (!buttonClicked) {
          throw new Error("Could not click Generate button");
        }

        promptData.submitTime = new Date().toISOString();

        const job = {
          id: jobId,
          promptIndex: promptData.index,
          promptText: promptData.promptText,
          tailSlug: promptData.tailSlug,
          openedAt: Date.now(),
          done: false,
          slotReleased: false,
        };

        twoPhaseInFlight.push(job);

        // Wait a bit longer to ensure submission is processed
        await driver.sleep(800);

        logger.info(
          `✅ Successfully submitted prompt ${promptData.index}/${twoPhasePrompts.length}`,
        );
        return true;
      } catch (error) {
        logger.warn(
          `Attempt ${attempt}/${maxRetries} failed for prompt ${promptData.index}: ${error.message}`,
        );

        if (attempt < maxRetries) {
          // Wait before retry
          await driver.sleep(1000 * attempt);
        } else {
          // Final attempt failed
          logger.error(
            `❌ Failed to submit prompt ${promptData.index} after ${maxRetries} attempts`,
          );

          // Put prompt back in queue for later retry
          queue.unshift(promptData);
          return false;
        }
      }
    }

    return false;
  };

  // Submit initial burst with delay between each
  while (canSubmitMore() && queue.length > 0) {
    const success = await submitNextPrompt(jobIdCounter++);
    if (!success) {
      logger.warn("Failed to submit prompt, will retry later");
      await driver.sleep(2000); // Wait before next attempt
    }
  }

  // Main polling loop
  const pollInterval = setInterval(async () => {
    try {
      for (const job of twoPhaseInFlight) {
        if (job.done) continue;

        const timeSinceStart = Date.now() - job.openedAt;

        if (timeSinceStart > 120000) {
          // 2 minutes timeout
          job.done = true;
          job.slotReleased = true;
          logger.info(`Job ${job.id} completed (timeout)`);
        }

        if (!job.slotReleased && timeSinceStart > 10000) {
          // 10s release slot
          job.slotReleased = true;
          logger.info(`Job ${job.id} released slot`);
        }
      }

      while (canSubmitMore() && queue.length > 0) {
        const success = await submitNextPrompt(jobIdCounter++);
        if (!success) {
          logger.warn("Failed to submit prompt in polling loop, will retry");
          await driver.sleep(2000);
        }
      }

      const activeJobs = twoPhaseInFlight.filter((j) => !j.done).length;

      if (queue.length === 0 && activeJobs === 0) {
        logger.info("Phase A completed");
        clearInterval(pollInterval);
      }

      if (queue.length > 0 || activeJobs > 0) {
        const submitted = twoPhasePrompts.length - queue.length;
        logger.info(
          `Phase A Status: submitted=${submitted}/${twoPhasePrompts.length}, queue=${queue.length}, active=${activeJobs}, slots_used=${slotsUsed}`,
        );
      }
    } catch (pollError) {
      logger.error(`Phase A poll error: ${pollError.message}`);
    }
  }, 1000);

  // Wait for completion
  while (
    queue.length > 0 ||
    twoPhaseInFlight.filter((j) => !j.done).length > 0
  ) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  logger.info("=== PHASE A: All prompts submitted ===");
}

// Two-Phase: Harvest and download
async function twoPhaseHarvestAndDownload(driver) {
  logger.info("=== PHASE B: Starting harvest and download ===");

  // Wait for final video generation
  logger.info("Waiting 30s for final video generation...");
  await new Promise((resolve) => setTimeout(resolve, 30000));

  // Scroll to bottom
  if (twoPhaseScroller) {
    logger.info("Scrolling to bottom...");
    for (let i = 0; i < 20; i++) {
      const scrollInfo = await driver.executeScript(
        `
                const scroller = arguments[0];
                if (!scroller) return null;
                
                scroller.scrollTop = scroller.scrollHeight;
                
                return {
                    scrollTop: scroller.scrollTop,
                    scrollHeight: scroller.scrollHeight,
                    clientHeight: scroller.clientHeight,
                    isAtBottom: (scroller.scrollTop + scroller.clientHeight) >= (scroller.scrollHeight - 8)
                };
            `,
        twoPhaseScroller,
      );

      if (!scrollInfo || scrollInfo.isAtBottom) {
        logger.info("Reached bottom");
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  // Harvest videos
  twoPhaseManifest = [];
  await harvestTwoPhaseVideos(driver);

  // Download videos
  await downloadTwoPhaseVideos();

  logger.info("=== PHASE B: Completed ===");
  return twoPhaseManifest;
}

// Harvest videos from bottom to top
async function harvestTwoPhaseVideos(driver) {
  logger.info("Harvesting videos from bottom to top...");

  let processedItems = new Set();
  let noNewItemsCount = 0;

  while (noNewItemsCount < 5) {
    const currentItems = await driver.executeScript(`
            const virtuosoList = document.querySelector('div[data-testid="virtuoso-item-list"]');
            if (!virtuosoList) return [];
            
            const items = Array.from(virtuosoList.querySelectorAll('div[data-index]'));
            
            return items.map(item => ({
                dataIndex: parseInt(item.getAttribute('data-index')),
                element: item
            })).filter(item => !isNaN(item.dataIndex))
              .sort((a, b) => a.dataIndex - b.dataIndex);
        `);

    if (!currentItems || currentItems.length === 0) break;

    let foundNewItems = false;

    // Process from bottom to top
    for (let i = currentItems.length - 1; i >= 0; i--) {
      const item = currentItems[i];
      const itemKey = `${item.dataIndex}`;

      if (processedItems.has(itemKey)) continue;

      foundNewItems = true;
      processedItems.add(itemKey);

      await extractTwoPhaseVideosFromItem(driver, item);
    }

    if (!foundNewItems) {
      noNewItemsCount++;
    } else {
      noNewItemsCount = 0;
    }

    // Scroll up
    const scrolled = await driver.executeScript(
      `
            const scroller = arguments[0];
            if (!scroller) return false;
            
            const oldScrollTop = scroller.scrollTop;
            scroller.scrollTop = Math.max(0, scroller.scrollTop - 400);
            
            return scroller.scrollTop < oldScrollTop;
        `,
      twoPhaseScroller,
    );

    if (!scrolled) break;

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  logger.info(`Harvest completed. Found ${twoPhaseManifest.length} videos`);
}

// Extract videos from item
async function extractTwoPhaseVideosFromItem(driver, item) {
  try {
    const itemData = await driver.executeScript(
      `
            const item = arguments[0];
            
            // Get prompt text
            let promptText = '';
            const textElements = item.querySelectorAll('p, div');
            for (const el of textElements) {
                if (el.textContent && el.textContent.length > 20) {
                    promptText = el.textContent.trim();
                    break;
                }
            }
            
            // Get videos
            const videos = Array.from(item.querySelectorAll('video[src][poster]'));
            const videoSrcs = videos
                .map(video => video.getAttribute('src'))
                .filter(src => src && (
                    src.includes('storage.googleapis.com') || 
                    src.includes('googleusercontent.com') ||
                    src.includes('ai-sandbox-videofx')
                ));
            
            return {
                dataIndex: item.dataIndex,
                promptText,
                videoSrcs
            };
        `,
      item.element,
    );

    if (!itemData.promptText || itemData.videoSrcs.length === 0) return;

    // Match prompt
    const matchedPrompt = matchTwoPhasePromptByTail(itemData.promptText);
    if (!matchedPrompt) {
      logger.warn(`Could not match prompt for item ${itemData.dataIndex}`);
      return;
    }

    // Add to manifest
    itemData.videoSrcs.forEach((src, index) => {
      const takeIndex = index + 1;
      const filename = createVeoFilename(
        matchedPrompt.index,
        matchedPrompt.tailSlug,
        takeIndex,
      );

      twoPhaseManifest.push({
        promptIndex: matchedPrompt.index,
        takeIndex,
        src,
        filename,
        tailSlug: matchedPrompt.tailSlug,
      });

      logger.info(`Added to manifest: ${filename}`);
    });
  } catch (error) {
    logger.warn(`Failed to extract videos from item: ${error.message}`);
  }
}

// Match prompt by tail
function matchTwoPhasePromptByTail(itemPromptText) {
  const itemTail50 = itemPromptText.slice(-50);
  const itemTailSlug = createTailSlug(itemPromptText);

  // Try exact tail50 match
  let match = twoPhasePrompts.find((p) => p.tail50 === itemTail50);
  if (match) return match;

  // Try tailSlug match
  match = twoPhasePrompts.find((p) => p.tailSlug === itemTailSlug);
  if (match) return match;

  // Try partial match
  match = twoPhasePrompts.find(
    (p) =>
      p.promptText.includes(itemPromptText.slice(0, 30)) ||
      itemPromptText.includes(p.promptText.slice(0, 30)),
  );

  return match;
}

// Download all videos
async function downloadTwoPhaseVideos() {
  if (twoPhaseManifest.length === 0) {
    logger.info("No videos to download");
    return;
  }

  logger.info(`Starting download of ${twoPhaseManifest.length} videos`);

  await fs.ensureDir("dist/videos");

  // Sort by promptIndex
  twoPhaseManifest.sort((a, b) => {
    if (a.promptIndex !== b.promptIndex) {
      return a.promptIndex - b.promptIndex;
    }
    return a.takeIndex - b.takeIndex;
  });

  const downloadQueue = [...twoPhaseManifest];
  const workers = [];

  for (let i = 1; i <= DOWNLOAD_CONCURRENCY_TWO_PHASE; i++) {
    workers.push(twoPhaseDownloadWorker(i, downloadQueue));
  }

  await Promise.all(workers);

  logger.info("All downloads completed");
}

// Download worker
async function twoPhaseDownloadWorker(workerId, downloadQueue) {
  while (downloadQueue.length > 0) {
    const task = downloadQueue.shift();
    if (!task) break;

    const { src, filename, promptIndex, tailSlug } = task;
    const filePath = path.join("dist/videos", filename);

    // Skip if exists
    if (await fs.pathExists(filePath)) {
      try {
        const stats = await fs.stat(filePath);
        if (stats.size > 1000) {
          logger.info(`Worker ${workerId} skipping existing: ${filename}`);
          continue;
        }
      } catch (e) {
        // Continue to download
      }
    }

    logger.info(`Worker ${workerId} downloading: ${filename}`);

    const success = await twoPhaseDownloadVideoWithRetry(src, filePath);

    if (success) {
      logger.info(`Worker ${workerId} completed: ${filename}`);
    } else {
      // Save URL fallback
      const urlFileName = filename.replace(".mp4", "_url.txt");
      const urlFilePath = path.join("dist/videos", urlFileName);

      try {
        await fs.writeFile(
          urlFilePath,
          `Prompt Index: ${promptIndex}\nTail Slug: ${tailSlug}\nFailed after ${RETRY_MAX_TWO_PHASE} retries\n\nVideo URL:\n${src}`,
        );
        logger.warn(`Worker ${workerId} saved URL fallback: ${urlFileName}`);
      } catch (urlError) {
        logger.error(
          `Worker ${workerId} failed to save URL: ${urlError.message}`,
        );
      }
    }
  }
}

// Download with retry
async function twoPhaseDownloadVideoWithRetry(url, filePath) {
  for (let attempt = 1; attempt <= RETRY_MAX_TWO_PHASE; attempt++) {
    try {
      await downloadVideo(url, filePath); // Reuse existing downloadVideo function
      return true;
    } catch (error) {
      logger.warn(
        `Download attempt ${attempt}/${RETRY_MAX_TWO_PHASE} failed: ${error.message}`,
      );
      if (attempt < RETRY_MAX_TWO_PHASE) {
        const backoffMs = Math.pow(2, attempt - 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }
  return false;
}

// Main Two-Phase Automation Function
async function automateWithTwoPhase(profilePath, inputPrompts, settings = {}) {
  logger.info(
    `Starting two-phase automation with ${inputPrompts.length} prompts`,
  );

  await fs.ensureDir("dist/videos");
  await fs.ensureDir("logs");

  initializeTwoPhasePrompts(inputPrompts);

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

  try {
    logger.info("Opening Google Flow");
    await driver.get("https://labs.google/fx/tools/flow");
    await driver.sleep(3000);

    // Create new project
    try {
      const buttons = await driver.findElements(By.css("button"));
      for (const button of buttons) {
        const text = await button.getText();
        if (text.includes("Dự án mới") || text.includes("New project")) {
          await driver.executeScript("arguments[0].click();", button);
          logger.info("New project created");
          break;
        }
      }
    } catch (error) {
      logger.warn("Could not create project, continuing...");
    }

    await driver.sleep(2000);

    // Find textarea
    const textarea = await driver.findElement(By.css("textarea"));
    await findTwoPhaseScroller(driver);

    // PHASE A: Submit all prompts
    await twoPhaseSubmitPrompts(driver, textarea);

    // PHASE B: Harvest and download
    const finalManifest = await twoPhaseHarvestAndDownload(driver);

    const results = {
      totalPrompts: twoPhasePrompts.length,
      totalVideos: finalManifest.length,
      promptsWithVideos: new Set(finalManifest.map((m) => m.promptIndex)).size,
      manifest: finalManifest,
      prompts: twoPhasePrompts,
    };

    const manifestPath = path.join("dist", "manifest.json");
    await fs.writeJson(manifestPath, results, { spaces: 2 });
    logger.info(`Manifest saved to: ${manifestPath}`);

    return results;
  } catch (error) {
    logger.error(`Two-phase automation failed: ${error.message}`);
    throw error;
  } finally {
    try {
      await driver.quit();
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

module.exports = {
  automateWithTwoPhase, // Main automation function
  automateConcurrentGeneration, // Keep for multi-profile support
  loadPromptsFromCSV,
  logger,
};
