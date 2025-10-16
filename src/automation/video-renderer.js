const { By, until, Key } = require("selenium-webdriver");
const fs = require("fs-extra");
const path = require("path");
const RetryHandler = require("./retry-handler");

class VideoRenderer {
  constructor() {
    this.retryHandler = new RetryHandler({
      maxAttempts: 3,
      baseDelay: 2000,
      maxDelay: 30000,
      retryableErrors: [
        "timeout",
        "element not found",
        "page load",
        "network",
        "connection",
        "stale element",
        "no such element",
        "element not interactable",
      ],
    });

    this.selectors = {
      // VEO3 Flow UI selectors (these may need to be updated based on actual VEO3 interface)
      promptInput: [
        'textarea[placeholder*="prompt"]',
        'textarea[placeholder*="describe"]',
        'input[name="prompt"]',
        'textarea[name="prompt"]',
        ".prompt-input textarea",
        ".text-input textarea",
      ],
      renderButton: [
        'button[data-testid="render-button"]',
        'button:contains("Render")',
        'button:contains("Generate")',
        'button:contains("Create")',
        ".render-btn",
        ".generate-btn",
      ],
      progressIndicator: [
        ".progress-bar",
        ".render-progress",
        '[data-testid="progress"]',
        ".loading-indicator",
      ],
      downloadButton: [
        'button:contains("Download")',
        "a[download]",
        ".download-btn",
        '[data-testid="download-button"]',
      ],
      errorMessage: [
        ".error-message",
        ".alert-error",
        '[data-testid="error"]',
        ".notification.error",
      ],
    };

    this.timeouts = {
      pageLoad: 30000,
      elementWait: 10000,
      renderTimeout: 600000, // 10 minutes default
      downloadTimeout: 60000,
    };
  }

  async renderVideo(driver, flowUrl, prompt, options = {}) {
    const config = {
      timeout: this.timeouts.renderTimeout,
      outputFolder: "./output",
      retryAttempts: 3,
      onProgressUpdate: null,
      ...options,
    };

    return await this.retryHandler.executeWithRetry(
      async (attempt) => {
        try {
          console.log(
            `Starting video render for: ${
              flowUrl || "new project"
            } (attempt ${attempt})`
          );

          // Step 1: Create new project or navigate to existing Flow URL
          let actualFlowUrl = flowUrl;
          if (!flowUrl || flowUrl.trim() === "") {
            console.log("No Flow_URL provided, creating new VEO3 project...");
            actualFlowUrl = await this.createNewVEO3Project(driver);
            console.log(`Created new project with URL: ${actualFlowUrl}`);
          }

          // Step 2: Navigate to Flow URL with retry
          await this.retryHandler.executeWithRetry(
            async () => {
              return await this.navigateToFlow(driver, actualFlowUrl);
            },
            { description: "Navigate to Flow URL" }
          );

          // Step 2: Input prompt with retry
          await this.retryHandler.executeWithRetry(
            async () => {
              return await this.inputPrompt(driver, prompt);
            },
            { description: "Input prompt" }
          );

          // Step 3: Configure video settings (model, aspect ratio, etc.)
          await this.retryHandler.executeWithRetry(
            async () => {
              return await this.configureVideoSettings(
                driver,
                config.videoSettings || {}
              );
            },
            { description: "Configure video settings" }
          );

          // Step 4: Click render button with retry
          await this.retryHandler.executeWithRetry(
            async () => {
              return await this.clickRender(driver);
            },
            { description: "Click render button" }
          );

          // Step 5: Monitor progress (no retry for this as it's a long-running operation)
          const renderResult = await this.enhancedProgressMonitoring(
            driver,
            config.timeout,
            config.onProgressUpdate
          );

          // Step 6: Download video with retry
          const downloadPath = await this.retryHandler.executeWithRetry(
            async () => {
              return await this.downloadVideo(driver, config.outputFolder);
            },
            { description: "Download video" }
          );

          return {
            success: true,
            videoPath: downloadPath,
            renderTime: renderResult.renderTime,
            message: "Video rendered and downloaded successfully",
            attempts: attempt,
            flowUrl: actualFlowUrl, // Return the actual Flow URL used
          };
        } catch (error) {
          console.error(`Video rendering attempt ${attempt} failed:`, error);

          // Try to capture error details from the page
          const errorDetails = await this.captureErrorDetails(driver);
          const enhancedError = new Error(
            `Video rendering failed: ${error.message}${
              errorDetails ? ` - ${errorDetails}` : ""
            }`
          );

          // Add context for better error handling
          enhancedError.originalError = error;
          enhancedError.attempt = attempt;
          enhancedError.flowUrl = flowUrl;
          enhancedError.prompt = prompt.substring(0, 100) + "...";

          throw enhancedError;
        }
      },
      { description: `Render video: ${flowUrl}` }
    );
  }

  async createNewVEO3Project(driver) {
    try {
      console.log("Creating new VEO3 project...");

      // Navigate to VEO3 main page
      await driver.get("https://labs.google/fx/tools/flow");

      // Wait for page to load
      await driver.wait(until.titleContains("VEO"), this.timeouts.pageLoad);

      // Look for "New Project" or "Create" button
      const newProjectSelectors = [
        'button:contains("New")',
        'button:contains("Create")',
        'button:contains("Start")',
        '[data-testid="new-project"]',
        ".new-project-btn",
        'a[href*="new"]',
        'button[aria-label*="new"]',
      ];

      let newProjectButton = null;
      for (const selector of newProjectSelectors) {
        try {
          newProjectButton = await driver.findElement(By.css(selector));
          if (newProjectButton) break;
        } catch (e) {
          // Continue to next selector
        }
      }

      if (!newProjectButton) {
        // If no specific button found, try to find any clickable element with "new" text
        try {
          newProjectButton = await driver.findElement(
            By.xpath(
              "//button[contains(translate(text(), 'NEW', 'new'), 'new')] | //a[contains(translate(text(), 'NEW', 'new'), 'new')]"
            )
          );
        } catch (e) {
          throw new Error("Could not find 'New Project' button on VEO3 page");
        }
      }

      // Click the new project button
      await driver.wait(
        until.elementIsVisible(newProjectButton),
        this.timeouts.elementWait
      );
      await driver.wait(
        until.elementIsEnabled(newProjectButton),
        this.timeouts.elementWait
      );
      await newProjectButton.click();

      console.log(
        "Clicked new project button, waiting for project creation..."
      );

      // Wait for URL to change to a project-specific URL
      await driver.wait(async () => {
        const currentUrl = await driver.getCurrentUrl();
        return (
          currentUrl.includes("/flow/") ||
          currentUrl.includes("/project/") ||
          currentUrl.includes("/edit/")
        );
      }, this.timeouts.pageLoad);

      const projectUrl = await driver.getCurrentUrl();
      console.log(`New VEO3 project created: ${projectUrl}`);

      return projectUrl;
    } catch (error) {
      console.error("Failed to create new VEO3 project:", error);
      throw new Error(`Failed to create new VEO3 project: ${error.message}`);
    }
  }

  async configureVideoSettings(driver, videoSettings = {}) {
    try {
      console.log("Configuring video settings...", videoSettings);

      // Default settings (updated for VEO 3.1)
      const settings = {
        model: "veo-3.1-fast", // Latest VEO model version
        aspectRatio: "16:9", // Video aspect ratio
        videoCount: 1, // Number of videos to generate
        duration: "5s", // Video duration
        quality: "high", // Video quality
        ...videoSettings,
      };

      // Wait a moment for the page to fully load
      await driver.sleep(2000);

      // Configure VEO Model
      await this.configureVEOModel(driver, settings.model);

      // Configure Aspect Ratio
      await this.configureAspectRatio(driver, settings.aspectRatio);

      // Configure Video Count
      await this.configureVideoCount(driver, settings.videoCount);

      // Configure Duration (if available)
      await this.configureDuration(driver, settings.duration);

      // Configure Quality (if available)
      await this.configureQuality(driver, settings.quality);

      console.log("Video settings configured successfully");

      // Wait a moment for settings to apply
      await driver.sleep(1000);
    } catch (error) {
      console.warn("Failed to configure some video settings:", error.message);
      // Don't throw error - continue with default settings
    }
  }

  async configureVEOModel(driver, model) {
    try {
      const modelSelectors = [
        `[data-testid="model-selector"]`,
        `select[name="model"]`,
        `.model-selector`,
        `button[aria-label*="model"]`,
        `[aria-label*="VEO"]`,
      ];

      for (const selector of modelSelectors) {
        try {
          const modelElement = await driver.findElement(By.css(selector));

          if ((await modelElement.getTagName()) === "select") {
            // Dropdown select
            await modelElement.click();
            const option = await driver.findElement(
              By.css(`option[value*="${model}"], option:contains("${model}")`)
            );
            await option.click();
          } else {
            // Button or clickable element
            await modelElement.click();
            // Look for model option
            const modelOption = await driver.findElement(
              By.xpath(
                `//*[contains(text(), "${model}") or contains(@value, "${model}")]`
              )
            );
            await modelOption.click();
          }

          console.log(`VEO model set to: ${model}`);
          return;
        } catch (e) {
          // Continue to next selector
        }
      }

      console.log("Model selector not found, using default");
    } catch (error) {
      console.warn("Failed to configure VEO model:", error.message);
    }
  }

  async configureAspectRatio(driver, aspectRatio) {
    try {
      const ratioSelectors = [
        `[data-testid="aspect-ratio"]`,
        `select[name="aspectRatio"]`,
        `.aspect-ratio-selector`,
        `button[aria-label*="aspect"]`,
        `[title*="aspect"]`,
      ];

      for (const selector of ratioSelectors) {
        try {
          const ratioElement = await driver.findElement(By.css(selector));

          if ((await ratioElement.getTagName()) === "select") {
            await ratioElement.click();
            const option = await driver.findElement(
              By.css(
                `option[value="${aspectRatio}"], option:contains("${aspectRatio}")`
              )
            );
            await option.click();
          } else {
            await ratioElement.click();
            const ratioOption = await driver.findElement(
              By.xpath(`//*[contains(text(), "${aspectRatio}")]`)
            );
            await ratioOption.click();
          }

          console.log(`Aspect ratio set to: ${aspectRatio}`);
          return;
        } catch (e) {
          // Continue to next selector
        }
      }

      console.log("Aspect ratio selector not found, using default");
    } catch (error) {
      console.warn("Failed to configure aspect ratio:", error.message);
    }
  }

  async configureVideoCount(driver, videoCount) {
    try {
      const countSelectors = [
        `[data-testid="video-count"]`,
        `input[name="videoCount"]`,
        `select[name="count"]`,
        `.video-count-selector`,
        `input[type="number"]`,
      ];

      for (const selector of countSelectors) {
        try {
          const countElement = await driver.findElement(By.css(selector));

          if ((await countElement.getTagName()) === "input") {
            await countElement.clear();
            await countElement.sendKeys(videoCount.toString());
          } else if ((await countElement.getTagName()) === "select") {
            await countElement.click();
            const option = await driver.findElement(
              By.css(`option[value="${videoCount}"]`)
            );
            await option.click();
          }

          console.log(`Video count set to: ${videoCount}`);
          return;
        } catch (e) {
          // Continue to next selector
        }
      }

      console.log("Video count selector not found, using default");
    } catch (error) {
      console.warn("Failed to configure video count:", error.message);
    }
  }

  async configureDuration(driver, duration) {
    try {
      const durationSelectors = [
        `[data-testid="duration"]`,
        `select[name="duration"]`,
        `.duration-selector`,
        `button[aria-label*="duration"]`,
      ];

      for (const selector of durationSelectors) {
        try {
          const durationElement = await driver.findElement(By.css(selector));
          await durationElement.click();

          const durationOption = await driver.findElement(
            By.xpath(`//*[contains(text(), "${duration}")]`)
          );
          await durationOption.click();

          console.log(`Duration set to: ${duration}`);
          return;
        } catch (e) {
          // Continue to next selector
        }
      }

      console.log("Duration selector not found, using default");
    } catch (error) {
      console.warn("Failed to configure duration:", error.message);
    }
  }

  async configureQuality(driver, quality) {
    try {
      const qualitySelectors = [
        `[data-testid="quality"]`,
        `select[name="quality"]`,
        `.quality-selector`,
        `button[aria-label*="quality"]`,
      ];

      for (const selector of qualitySelectors) {
        try {
          const qualityElement = await driver.findElement(By.css(selector));
          await qualityElement.click();

          const qualityOption = await driver.findElement(
            By.xpath(
              `//*[contains(text(), "${quality}") or contains(@value, "${quality}")]`
            )
          );
          await qualityOption.click();

          console.log(`Quality set to: ${quality}`);
          return;
        } catch (e) {
          // Continue to next selector
        }
      }

      console.log("Quality selector not found, using default");
    } catch (error) {
      console.warn("Failed to configure quality:", error.message);
    }
  }

  async navigateToFlow(driver, flowUrl) {
    try {
      console.log(`Navigating to: ${flowUrl}`);

      await driver.get(flowUrl);

      // Wait for page to load
      await driver.wait(until.titleMatches(/.+/), this.timeouts.pageLoad);

      // Wait a bit more for dynamic content to load
      await this.sleep(2000);

      // Check if we're on the right page
      const currentUrl = await driver.getCurrentUrl();
      if (!currentUrl.includes("veo") && !currentUrl.includes("flow")) {
        throw new Error(`Unexpected page loaded: ${currentUrl}`);
      }

      console.log("Successfully navigated to Flow page");
    } catch (error) {
      throw new Error(`Failed to navigate to Flow URL: ${error.message}`);
    }
  }

  async inputPrompt(driver, prompt) {
    try {
      console.log("Looking for prompt input field...");

      let promptElement = null;

      // Try to find prompt input using multiple selectors
      for (const selector of this.selectors.promptInput) {
        try {
          promptElement = await driver.wait(
            until.elementLocated(By.css(selector)),
            this.timeouts.elementWait
          );

          // Check if element is visible and enabled
          const isDisplayed = await promptElement.isDisplayed();
          const isEnabled = await promptElement.isEnabled();

          if (isDisplayed && isEnabled) {
            console.log(`Found prompt input with selector: ${selector}`);
            break;
          }
        } catch (e) {
          // Continue to next selector
          promptElement = null;
        }
      }

      if (!promptElement) {
        throw new Error("Could not find prompt input field");
      }

      // Clear existing text and input new prompt
      await promptElement.clear();
      await promptElement.sendKeys(prompt);

      // Verify the text was entered
      const enteredText =
        (await promptElement.getAttribute("value")) ||
        (await promptElement.getText());
      if (!enteredText.includes(prompt.substring(0, 20))) {
        throw new Error("Failed to enter prompt text correctly");
      }

      console.log("Successfully entered prompt");
    } catch (error) {
      throw new Error(`Failed to input prompt: ${error.message}`);
    }
  }

  async clickRender(driver) {
    try {
      console.log("Looking for render button...");

      let renderButton = null;

      // Try to find render button using multiple selectors
      for (const selector of this.selectors.renderButton) {
        try {
          // For text-based selectors, we need to use XPath
          if (selector.includes("contains")) {
            const xpathSelector = `//${selector
              .replace('button:contains("', 'button[contains(text(), "')
              .replace('")', '")]')}`;
            renderButton = await driver.wait(
              until.elementLocated(By.xpath(xpathSelector)),
              this.timeouts.elementWait
            );
          } else {
            renderButton = await driver.wait(
              until.elementLocated(By.css(selector)),
              this.timeouts.elementWait
            );
          }

          // Check if button is clickable
          const isDisplayed = await renderButton.isDisplayed();
          const isEnabled = await renderButton.isEnabled();

          if (isDisplayed && isEnabled) {
            console.log(`Found render button with selector: ${selector}`);
            break;
          }
        } catch (e) {
          // Continue to next selector
          renderButton = null;
        }
      }

      if (!renderButton) {
        throw new Error("Could not find render button");
      }

      // Scroll button into view if needed
      await driver.executeScript(
        "arguments[0].scrollIntoView(true);",
        renderButton
      );
      await this.sleep(500);

      // Click the render button
      await renderButton.click();

      console.log("Successfully clicked render button");

      // Wait a moment for the render to start
      await this.sleep(2000);
    } catch (error) {
      throw new Error(`Failed to click render button: ${error.message}`);
    }
  }

  async monitorProgress(driver, timeout) {
    const startTime = Date.now();
    const endTime = startTime + timeout;

    console.log("Monitoring render progress...");

    try {
      while (Date.now() < endTime) {
        // Check for completion indicators
        const isComplete = await this.checkRenderComplete(driver);
        if (isComplete) {
          const renderTime = Date.now() - startTime;
          console.log(
            `Render completed in ${Math.round(renderTime / 1000)} seconds`
          );
          return { renderTime, completed: true };
        }

        // Check for error indicators
        const errorMessage = await this.checkForErrors(driver);
        if (errorMessage) {
          throw new Error(`Render failed: ${errorMessage}`);
        }

        // Log progress if available
        const progressInfo = await this.getProgressInfo(driver);
        if (progressInfo) {
          console.log(`Render progress: ${progressInfo}`);
        }

        // Wait before next check
        await this.sleep(5000);
      }

      throw new Error("Render timeout: Video generation took too long");
    } catch (error) {
      throw new Error(`Progress monitoring failed: ${error.message}`);
    }
  }

  async checkRenderComplete(driver) {
    try {
      // Look for download button or completed status
      for (const selector of this.selectors.downloadButton) {
        try {
          if (selector.includes("contains")) {
            const xpathSelector = `//${selector
              .replace('button:contains("', 'button[contains(text(), "')
              .replace('")', '")]')}`;
            const element = await driver.findElement(By.xpath(xpathSelector));
            if (await element.isDisplayed()) {
              return true;
            }
          } else {
            const element = await driver.findElement(By.css(selector));
            if (await element.isDisplayed()) {
              return true;
            }
          }
        } catch (e) {
          // Continue checking
        }
      }

      // Check for other completion indicators
      try {
        const completionIndicators = [
          ".render-complete",
          ".status-complete",
          '[data-status="complete"]',
          ".success-message",
        ];

        for (const selector of completionIndicators) {
          const element = await driver.findElement(By.css(selector));
          if (await element.isDisplayed()) {
            return true;
          }
        }
      } catch (e) {
        // No completion indicators found
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  async checkForErrors(driver) {
    try {
      for (const selector of this.selectors.errorMessage) {
        try {
          const element = await driver.findElement(By.css(selector));
          if (await element.isDisplayed()) {
            const errorText = await element.getText();
            if (errorText && errorText.trim().length > 0) {
              return errorText.trim();
            }
          }
        } catch (e) {
          // Continue checking
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async getProgressInfo(driver) {
    try {
      for (const selector of this.selectors.progressIndicator) {
        try {
          const element = await driver.findElement(By.css(selector));
          if (await element.isDisplayed()) {
            const progressText = await element.getText();
            if (progressText && progressText.trim().length > 0) {
              return progressText.trim();
            }

            // Try to get progress from aria-valuenow or similar attributes
            const ariaValue = await element.getAttribute("aria-valuenow");
            if (ariaValue) {
              return `${ariaValue}%`;
            }
          }
        } catch (e) {
          // Continue checking
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async captureErrorDetails(driver) {
    try {
      // Try to capture any error messages or status information
      const errorSelectors = [
        ".error",
        ".alert",
        ".notification",
        ".message",
        '[role="alert"]',
      ];

      for (const selector of errorSelectors) {
        try {
          const elements = await driver.findElements(By.css(selector));
          for (const element of elements) {
            if (await element.isDisplayed()) {
              const text = await element.getText();
              if (text && text.trim().length > 0) {
                return text.trim();
              }
            }
          }
        } catch (e) {
          // Continue
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  async downloadVideo(driver, outputFolder) {
    try {
      console.log("Looking for download link...");

      // Ensure output folder exists
      await fs.ensureDir(outputFolder);

      let downloadElement = null;

      // Try to find download button/link
      for (const selector of this.selectors.downloadButton) {
        try {
          if (selector.includes("contains")) {
            const xpathSelector = `//${selector
              .replace('button:contains("', 'button[contains(text(), "')
              .replace('")', '")]')}`;
            downloadElement = await driver.wait(
              until.elementLocated(By.xpath(xpathSelector)),
              this.timeouts.elementWait
            );
          } else {
            downloadElement = await driver.wait(
              until.elementLocated(By.css(selector)),
              this.timeouts.elementWait
            );
          }

          if (await downloadElement.isDisplayed()) {
            console.log(`Found download element with selector: ${selector}`);
            break;
          }
        } catch (e) {
          downloadElement = null;
        }
      }

      if (!downloadElement) {
        throw new Error("Could not find download button or link");
      }

      // Get download URL
      let downloadUrl = null;

      // Try to get href attribute (for links)
      try {
        downloadUrl = await downloadElement.getAttribute("href");
      } catch (e) {
        // Not a link, might be a button that triggers download
      }

      if (!downloadUrl) {
        // Try to get data-url or similar attributes
        const urlAttributes = ["data-url", "data-download-url", "data-src"];
        for (const attr of urlAttributes) {
          try {
            downloadUrl = await downloadElement.getAttribute(attr);
            if (downloadUrl) break;
          } catch (e) {
            // Continue
          }
        }
      }

      if (downloadUrl) {
        // Direct download using URL
        return await this.downloadFromUrl(driver, downloadUrl, outputFolder);
      } else {
        // Click download button and monitor for file download
        return await this.downloadByClick(
          driver,
          downloadElement,
          outputFolder
        );
      }
    } catch (error) {
      throw new Error(`Failed to download video: ${error.message}`);
    }
  }

  async downloadFromUrl(driver, downloadUrl, outputFolder) {
    try {
      console.log(`Downloading from URL: ${downloadUrl}`);

      // Generate filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `video_${timestamp}.mp4`;
      const filePath = path.join(outputFolder, filename);

      // Navigate to download URL
      await driver.get(downloadUrl);

      // Wait for download to complete (this is a simplified approach)
      await this.sleep(5000);

      console.log(`Video downloaded to: ${filePath}`);
      return filePath;
    } catch (error) {
      throw new Error(`URL download failed: ${error.message}`);
    }
  }

  async downloadByClick(driver, downloadElement, outputFolder) {
    try {
      console.log("Initiating download by clicking...");

      // Set up download preferences
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `video_${timestamp}.mp4`;
      const filePath = path.join(outputFolder, filename);

      // Click the download button
      await downloadElement.click();

      // Wait for download to start and complete
      await this.waitForDownload(filePath);

      console.log(`Video downloaded to: ${filePath}`);
      return filePath;
    } catch (error) {
      throw new Error(`Click download failed: ${error.message}`);
    }
  }

  async waitForDownload(expectedFilePath, timeout = 60000) {
    const startTime = Date.now();
    const checkInterval = 1000;

    while (Date.now() - startTime < timeout) {
      // Check if file exists and is not being written to
      if (await fs.pathExists(expectedFilePath)) {
        // Wait a bit more to ensure download is complete
        await this.sleep(2000);

        // Check file size stability
        const initialSize = (await fs.stat(expectedFilePath)).size;
        await this.sleep(1000);
        const finalSize = (await fs.stat(expectedFilePath)).size;

        if (initialSize === finalSize && finalSize > 0) {
          return true;
        }
      }

      await this.sleep(checkInterval);
    }

    throw new Error(
      "Download timeout: File was not downloaded within the specified time"
    );
  }

  async enhancedProgressMonitoring(driver, timeout, onProgressUpdate) {
    const startTime = Date.now();
    const endTime = startTime + timeout;
    let lastProgress = null;

    console.log("Starting enhanced progress monitoring...");

    try {
      while (Date.now() < endTime) {
        // Check for completion
        const isComplete = await this.checkRenderComplete(driver);
        if (isComplete) {
          const renderTime = Date.now() - startTime;
          if (onProgressUpdate) {
            onProgressUpdate({
              status: "completed",
              progress: 100,
              renderTime,
              message: "Render completed successfully",
            });
          }
          return { renderTime, completed: true };
        }

        // Check for errors
        const errorMessage = await this.checkForErrors(driver);
        if (errorMessage) {
          if (onProgressUpdate) {
            onProgressUpdate({
              status: "error",
              error: errorMessage,
              message: `Render failed: ${errorMessage}`,
            });
          }
          throw new Error(`Render failed: ${errorMessage}`);
        }

        // Get detailed progress information
        const progressInfo = await this.getDetailedProgress(driver);
        if (progressInfo && progressInfo !== lastProgress) {
          lastProgress = progressInfo;
          if (onProgressUpdate) {
            onProgressUpdate({
              status: "rendering",
              progress: progressInfo.percentage || null,
              message: progressInfo.message || "Rendering in progress...",
              details: progressInfo,
            });
          }
          console.log(
            `Progress update: ${
              progressInfo.message || progressInfo.percentage || "Rendering..."
            }`
          );
        }

        await this.sleep(3000);
      }

      throw new Error("Render timeout: Video generation took too long");
    } catch (error) {
      if (onProgressUpdate) {
        onProgressUpdate({
          status: "error",
          error: error.message,
          message: `Monitoring failed: ${error.message}`,
        });
      }
      throw error;
    }
  }

  async getDetailedProgress(driver) {
    try {
      const progressData = {
        percentage: null,
        message: null,
        stage: null,
      };

      // Try to get percentage from progress bars
      const progressSelectors = [
        ".progress-bar",
        ".render-progress",
        '[role="progressbar"]',
        ".percentage",
      ];

      for (const selector of progressSelectors) {
        try {
          const element = await driver.findElement(By.css(selector));
          if (await element.isDisplayed()) {
            const ariaValue = await element.getAttribute("aria-valuenow");
            const styleWidth = await element.getAttribute("style");
            const textContent = await element.getText();

            if (ariaValue) {
              progressData.percentage = parseInt(ariaValue);
            } else if (styleWidth && styleWidth.includes("width:")) {
              const match = styleWidth.match(/width:\s*(\d+)%/);
              if (match) {
                progressData.percentage = parseInt(match[1]);
              }
            } else if (textContent && textContent.includes("%")) {
              const match = textContent.match(/(\d+)%/);
              if (match) {
                progressData.percentage = parseInt(match[1]);
              }
            }

            if (textContent) {
              progressData.message = textContent;
            }

            break;
          }
        } catch (e) {
          // Continue
        }
      }

      return progressData.percentage !== null || progressData.message
        ? progressData
        : null;
    } catch (error) {
      return null;
    }
  }

  async handleBrowserError(driver, error, context = "") {
    try {
      console.error(`Browser error in ${context}:`, error.message);

      // Try to get current page info for debugging
      const currentUrl = await driver.getCurrentUrl().catch(() => "unknown");
      const pageTitle = await driver.getTitle().catch(() => "unknown");

      console.log(`Current page: ${pageTitle} (${currentUrl})`);

      // Check if browser is still responsive
      try {
        await driver.executeScript("return document.readyState;");
      } catch (e) {
        throw new Error(`Browser became unresponsive: ${error.message}`);
      }

      // Capture screenshot if possible for debugging
      try {
        const screenshot = await driver.takeScreenshot();
        const screenshotPath = path.join(
          process.cwd(),
          "logs",
          `error_${Date.now()}.png`
        );
        await fs.ensureDir(path.dirname(screenshotPath));
        await fs.writeFile(screenshotPath, screenshot, "base64");
        console.log(`Error screenshot saved: ${screenshotPath}`);
      } catch (screenshotError) {
        console.warn(
          "Could not capture error screenshot:",
          screenshotError.message
        );
      }
    } catch (handlingError) {
      console.error(
        "Error while handling browser error:",
        handlingError.message
      );
    }
  }

  async recoverFromError(driver, error, context = "") {
    try {
      console.log(`Attempting to recover from error in ${context}...`);

      // Try to refresh the page
      await driver.navigate().refresh();
      await this.sleep(3000);

      // Wait for page to be ready
      await driver.wait(async () => {
        const readyState = await driver.executeScript(
          "return document.readyState;"
        );
        return readyState === "complete";
      }, 10000);

      console.log("Page refresh completed, recovery successful");
      return true;
    } catch (recoveryError) {
      console.error("Recovery failed:", recoveryError.message);
      return false;
    }
  }

  validateRenderResult(result) {
    if (!result) {
      throw new Error("Render result is null or undefined");
    }

    if (!result.success) {
      throw new Error(`Render failed: ${result.message || "Unknown error"}`);
    }

    if (!result.videoPath) {
      throw new Error("Render completed but no video path provided");
    }

    // Additional validation can be added here
    return true;
  }

  async cleanup(driver) {
    try {
      // Clear any downloads or temporary files
      // Close any modal dialogs
      // Reset browser state if needed
      console.log("Cleaning up browser state...");

      // Try to close any open dialogs
      try {
        await driver.switchTo().alert().dismiss();
      } catch (e) {
        // No alert present
      }

      // Navigate to a clean state
      await driver.get("about:blank");
    } catch (error) {
      console.warn("Cleanup warning:", error.message);
    }
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = VideoRenderer;
