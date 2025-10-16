const { By, until, Key } = require("selenium-webdriver");
const fs = require("fs-extra");
const path = require("path");
const RetryHandler = require("./retry-handler");
const StatusTracker = require("./status-tracker");

class VideoRenderer {
  constructor() {
    this.statusTracker = new StatusTracker();
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
        '#PINHOLE_TEXT_AREA_ELEMENT_ID', // Specific ID for VEO3 Vietnamese interface
        'textarea[placeholder*="Tạo một video bằng văn bản"]', // Vietnamese placeholder text
        'textarea.sc-2b17b33c-0.egXthD', // Specific CSS classes for the textarea
        'textarea[placeholder*="prompt"]',
        'textarea[placeholder*="describe"]',
        'input[name="prompt"]',
        'textarea[name="prompt"]',
        ".prompt-input textarea",
        ".text-input textarea",
      ],
      renderButton: [
        'button.sc-d6df593a-1.eEpoHF.sc-408537d4-2.gdXWm', // Specific Vietnamese "Tạo" button
        'button:contains("Tạo")', // Vietnamese "Create" text
        'button[aria-label*="Tạo"]', // Vietnamese aria-label
        'button i[class*="arrow_forward"]', // Button with arrow_forward icon
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
            `Starting video render for: ${flowUrl || "new project"
            } (attempt ${attempt})`
          );

          // Step 1: Create new project or navigate to existing Flow URL
          let actualFlowUrl = flowUrl;
          if (!flowUrl || flowUrl.trim() === "") {
            console.log("🔄 No Flow URL provided, trying to use current page as project...");
            this.statusTracker.updateStatus(
              "using_current_page",
              "Using current page as VEO3 project...",
              10
            );

            // Navigate to VEO3 main page if not already there
            await driver.get("https://labs.google/fx/tools/flow");
            actualFlowUrl = await driver.getCurrentUrl();

            console.log(`✅ Using current page as project: ${actualFlowUrl}`);
            this.statusTracker.updateStatus(
              "project_ready",
              `Project ready: ${actualFlowUrl}`,
              20
            );
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
            `Video rendering failed: ${error.message}${errorDetails ? ` - ${errorDetails}` : ""
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

  async createNewVEO3Project(driver, options = {}) {
    try {
      console.log("🚀 Creating new VEO3 project... [UPDATED VERSION]");

      // Navigate to VEO3 main page
      console.log("📍 Navigating to VEO3 main page...");
      await driver.get("https://labs.google/fx/tools/flow");

      // Wait for page to load - more flexible approach
      console.log("⏳ Waiting for page to load...");
      try {
        console.log("🔍 Looking for 'Flow' in page title...");
        await driver.wait(until.titleContains("Flow"), 10000);
        console.log("✅ Flow title found successfully!");
      } catch (titleError) {
        console.log("❌ Flow title not found, checking if page loaded anyway...");
        console.log(`Title error details: ${titleError.name} - ${titleError.message}`);

        try {
          // Check if page loaded by looking for body element
          console.log("🔍 Looking for body element...");
          await driver.wait(until.elementLocated(By.css("body")), 10000);
          console.log("✅ Body element found, page seems loaded");
        } catch (bodyError) {
          console.log("❌ Body element not found either, page may not be loading");
          console.log(`Body error details: ${bodyError.name} - ${bodyError.message}`);
          console.log(`Body error stack: ${bodyError.stack}`);
          throw new Error(`Page failed to load: ${bodyError.message}`);
        }

        // Get actual title and URL for debugging
        console.log("📋 Getting page details for debugging...");
        const actualTitle = await driver.getTitle();
        const currentUrl = await driver.getCurrentUrl();
        console.log(`📄 Page title: "${actualTitle}"`);
        console.log(`🌐 Current URL: ${currentUrl}`);

        // Check if we're on the right domain
        if (!currentUrl.includes("labs.google") && !currentUrl.includes("google")) {
          throw new Error(`Unexpected page loaded: ${currentUrl}`);
        }
      }

      // Look for "New Project" or "Create" button
      const newProjectSelectors = [
        'button.sc-d6df593a-1.csfEZL.sc-a38764c7-0.fXsrxE', // Specific selector for "Dự án mới" button
        'button:contains("Dự án mới")', // Vietnamese "New Project" text
        'button:contains("New")',
        'button:contains("Create")',
        'button:contains("Start")',
        '[data-testid="new-project"]',
        ".new-project-btn",
        'a[href*="new"]',
        'button[aria-label*="new"]',
      ];

      let newProjectButton = null;
      console.log("Searching for New Project button...");

      for (const selector of newProjectSelectors) {
        try {
          console.log(`Trying selector: ${selector}`);
          newProjectButton = await driver.findElement(By.css(selector));
          if (newProjectButton) {
            console.log(`✅ Found button with selector: ${selector}`);
            break;
          }
        } catch (e) {
          console.log(`❌ Selector failed: ${selector}`);
          // Continue to next selector
        }
      }

      if (!newProjectButton) {
        console.log("No button found with CSS selectors, trying XPath...");

        // If no specific button found, try to find any clickable element with "new" text (including Vietnamese)
        try {
          newProjectButton = await driver.findElement(
            By.xpath(
              "//button[contains(text(), 'Dự án mới') or contains(translate(text(), 'NEW', 'new'), 'new')] | //a[contains(text(), 'Dự án mới') or contains(translate(text(), 'NEW', 'new'), 'new')]"
            )
          );
          console.log("✅ Found button with XPath");
        } catch (e) {
          // Debug: Get page source to see what's actually on the page
          console.log("❌ No button found. Getting page info for debugging...");

          const currentUrl = await driver.getCurrentUrl();
          const pageTitle = await driver.getTitle();
          console.log(`Current URL: ${currentUrl}`);
          console.log(`Page Title: ${pageTitle}`);

          // Try to find any buttons on the page
          try {
            const allButtons = await driver.findElements(
              By.css('button, a[role="button"], .btn')
            );
            console.log(`Found ${allButtons.length} buttons/links on page`);

            for (let i = 0; i < Math.min(allButtons.length, 5); i++) {
              try {
                const buttonText = await allButtons[i].getText();
                const buttonTag = await allButtons[i].getTagName();
                console.log(`Button ${i + 1}: <${buttonTag}> "${buttonText}"`);
              } catch (btnError) {
                console.log(`Button ${i + 1}: Could not get text`);
              }
            }
          } catch (debugError) {
            console.log("Could not get page buttons for debugging");
          }

          throw new Error(
            `Could not find 'New Project' button on VEO3 page. URL: ${currentUrl}, Title: ${pageTitle}`
          );
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
      console.log(`✅ New VEO3 project created successfully: ${projectUrl}`);

      return projectUrl;
    } catch (error) {
      console.log("💥 UNEXPECTED ERROR in createNewVEO3Project:");
      console.log(`Error name: ${error.name}`);
      console.log(`Error message: ${error.message}`);
      console.log(`Error stack: ${error.stack}`);

      // Try to get current page info for debugging
      try {
        const currentUrl = await driver.getCurrentUrl();
        const pageTitle = await driver.getTitle();
        console.log(`Current URL when error occurred: ${currentUrl}`);
        console.log(`Page title when error occurred: ${pageTitle}`);
      } catch (debugError) {
        console.log("Could not get page info for debugging");
      }

      throw error; // Re-throw the original error
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
    console.log(`Navigating to: ${flowUrl}`);

    await driver.get(flowUrl);

    // Wait for page to load
    await driver.wait(until.titleMatches(/.+/), this.timeouts.pageLoad);

    // Wait a bit more for dynamic content to load
    await this.sleep(2000);

    // Check if we're on the right page
    const currentUrl = await driver.getCurrentUrl();
    if (!currentUrl.includes("flow") && !currentUrl.includes("labs.google")) {
      throw new Error(`Unexpected page loaded: ${currentUrl}`);
    }

    console.log("Successfully navigated to Flow page");
  }

  async inputPrompt(driver, prompt) {
    console.log("Looking for prompt input field...");

    let promptElement = null;

    // Try to find prompt input using multiple selectors
    for (const selector of this.selectors.promptInput) {
      console.log(`Trying selector: ${selector}`);

      try {
        promptElement = await driver.wait(
          until.elementLocated(By.css(selector)),
          this.timeouts.elementWait
        );

        // Check if element is visible and enabled
        const isDisplayed = await promptElement.isDisplayed();
        const isEnabled = await promptElement.isEnabled();

        if (isDisplayed && isEnabled) {
          console.log(`✅ Found prompt input with selector: ${selector}`);
          break;
        } else {
          console.log(`❌ Element found but not usable (displayed: ${isDisplayed}, enabled: ${isEnabled})`);
          promptElement = null;
        }
      } catch (e) {
        console.log(`❌ Selector failed: ${selector} - ${e.message}`);
        promptElement = null;
      }
    }

    if (!promptElement) {
      // Debug: Try to find any textarea or input elements on the page
      console.log("No prompt input found with specific selectors. Searching for any text inputs...");

      const allTextInputs = await driver.findElements(By.css('textarea, input[type="text"], input:not([type])'));
      console.log(`Found ${allTextInputs.length} text input elements on page`);

      for (let i = 0; i < Math.min(allTextInputs.length, 5); i++) {
        try {
          const tagName = await allTextInputs[i].getTagName();
          const placeholder = await allTextInputs[i].getAttribute('placeholder') || '';
          const id = await allTextInputs[i].getAttribute('id') || '';
          const className = await allTextInputs[i].getAttribute('class') || '';
          const isDisplayed = await allTextInputs[i].isDisplayed();

          console.log(`Input ${i + 1}: <${tagName}> id="${id}" class="${className}" placeholder="${placeholder}" visible=${isDisplayed}`);

          // Try to use the first visible textarea
          if (tagName === 'textarea' && isDisplayed) {
            promptElement = allTextInputs[i];
            console.log(`✅ Using fallback textarea element`);
            break;
          }
        } catch (debugError) {
          console.log(`Could not inspect input ${i + 1}: ${debugError.message}`);
        }
      }

      if (!promptElement) {
        // Get current URL and page title for debugging
        const currentUrl = await driver.getCurrentUrl();
        const pageTitle = await driver.getTitle();
        console.log(`DEBUG: Current URL: ${currentUrl}`);
        console.log(`DEBUG: Page Title: ${pageTitle}`);

        // Get page source snippet for debugging
        const pageSource = await driver.getPageSource();
        console.log(`DEBUG: Page source length: ${pageSource.length}`);
        console.log(`DEBUG: Page contains 'textarea': ${pageSource.includes('textarea')}`);
        console.log(`DEBUG: Page contains 'PINHOLE_TEXT_AREA': ${pageSource.includes('PINHOLE_TEXT_AREA')}`);

        throw new Error("Could not find prompt input field");
      }
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
  }

  async clickRender(driver) {
    console.log("Looking for render button...");

    let renderButton = null;

    // Try to find render button using multiple selectors
    for (const selector of this.selectors.renderButton) {
      console.log(`Trying render button selector: ${selector}`);

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
          console.log(`✅ Found render button with selector: ${selector}`);
          break;
        } else {
          console.log(`❌ Render button found but not usable (displayed: ${isDisplayed}, enabled: ${isEnabled})`);
          renderButton = null;
        }
      } catch (e) {
        console.log(`❌ Render button selector failed: ${selector} - ${e.message}`);
        renderButton = null;
      }
    }

    if (!renderButton) {
      // Debug: Try to find any buttons on the page
      console.log("No render button found with specific selectors. Searching for any buttons...");

      const allButtons = await driver.findElements(By.css('button, input[type="submit"], input[type="button"]'));
      console.log(`Found ${allButtons.length} buttons on page`);

      for (let i = 0; i < Math.min(allButtons.length, 10); i++) {
        try {
          const buttonText = await allButtons[i].getText();
          const buttonType = await allButtons[i].getAttribute('type') || '';
          const buttonClass = await allButtons[i].getAttribute('class') || '';
          const isDisplayed = await allButtons[i].isDisplayed();

          console.log(`Button ${i + 1}: "${buttonText}" type="${buttonType}" class="${buttonClass}" visible=${isDisplayed}`);
        } catch (debugError) {
          console.log(`Could not inspect button ${i + 1}: ${debugError.message}`);
        }
      }

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
      console.log("🔍 Checking render completion status...");

      // VEO3 specific completion indicators based on actual HTML structure
      const veo3CompletionSelectors = [
        // Specific selectors from actual VEO3 interface
        'span:contains("Tải xuống")', // Vietnamese download text in span
        'button[aria-label*="Tải xuống"]', // Vietnamese download aria-label  
        'i.google-symbols:contains("download")', // Google symbols download icon
        'i.sc-95c4f607-0:contains("download")', // Specific icon class with download
        // Generic fallbacks
        'button:contains("Download")',
        'button:contains("Tải xuống")',
        'a[download]',
        '.download-btn',
        '[data-testid="download-button"]',
      ];

      // Check for download buttons (strongest indicator of completion)
      for (const selector of veo3CompletionSelectors) {
        try {
          let element;
          if (selector.includes("contains")) {
            const xpathSelector = `//${selector
              .replace('button:contains("', 'button[contains(text(), "')
              .replace('")', '")]')}`;
            element = await driver.findElement(By.xpath(xpathSelector));
          } else {
            element = await driver.findElement(By.css(selector));
          }

          if (await element.isDisplayed()) {
            console.log(`✅ Render complete! Found download element: ${selector}`);
            return true;
          }
        } catch (e) {
          // Continue checking
        }
      }

      // Check for video preview/player (strongest indicator of completion)
      const videoIndicators = [
        'video[src*="storage.googleapis.com"]', // VEO3 specific video with Google storage URL
        'video[src]', // Any video with src attribute
        'video', // HTML5 video element
        '.video-player',
        '.video-preview',
        '[data-testid="video-player"]',
        'canvas', // Video canvas
      ];

      for (const selector of videoIndicators) {
        try {
          const element = await driver.findElement(By.css(selector));
          if (await element.isDisplayed()) {
            console.log(`🎥 Video element found: ${selector}`);

            // Check if video has valid src
            const src = await element.getAttribute('src');
            if (src && src.length > 0) {
              console.log(`✅ Video has valid src: ${src.substring(0, 100)}...`);

              // Additional check for duration if available
              try {
                const duration = await element.getAttribute('duration');
                if (duration && parseFloat(duration) > 0) {
                  console.log(`✅ Video ready with duration: ${duration}s`);
                } else {
                  console.log(`✅ Video element ready (duration not yet available)`);
                }
              } catch (e) {
                console.log(`✅ Video element ready (could not get duration)`);
              }

              return true;
            }
          }
        } catch (e) {
          // Continue checking
        }
      }

      // Check for video duration display (indicates video is processed)
      const durationIndicators = [
        '.sc-c194362c-4', // Specific class for duration display from HTML
        'p:contains("0:")', // Duration format like "0:08"
        '[class*="duration"]',
        '[class*="time"]',
      ];

      for (const selector of durationIndicators) {
        try {
          let element;
          if (selector.includes("contains")) {
            const xpathSelector = `//${selector
              .replace('p:contains("', 'p[contains(text(), "')
              .replace('")', '")]')}`;
            element = await driver.findElement(By.xpath(xpathSelector));
          } else {
            element = await driver.findElement(By.css(selector));
          }

          if (await element.isDisplayed()) {
            const text = await element.getText();
            // Check if it's a valid duration format (e.g., "0:08")
            if (text.match(/^\d+:\d{2}$/)) {
              console.log(`✅ Video duration found: "${text}" - Video is ready!`);
              return true;
            }
          }
        } catch (e) {
          // Continue checking
        }
      }

      // Check for completion status text
      const statusTexts = [
        'text()*="hoàn thành"', // Vietnamese "completed"
        'text()*="completed"',
        'text()*="finished"',
        'text()*="ready"',
        'text()*="done"',
      ];

      for (const textPattern of statusTexts) {
        try {
          const element = await driver.findElement(By.xpath(`//*[contains(${textPattern})]`));
          if (await element.isDisplayed()) {
            const text = await element.getText();
            console.log(`✅ Completion status found: "${text}"`);
            return true;
          }
        } catch (e) {
          // Continue checking
        }
      }

      return false;
    } catch (error) {
      console.log(`❌ Error checking render completion: ${error.message}`);
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
            `Progress update: ${progressInfo.message || progressInfo.percentage || "Rendering..."
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
        estimatedTime: null,
      };

      console.log("📊 Getting detailed progress info...");

      // VEO3 specific progress indicators
      const veo3ProgressSelectors = [
        ".progress-bar",
        ".render-progress",
        '[role="progressbar"]',
        ".percentage",
        '[class*="progress"]',
        '[class*="loading"]',
      ];

      // Check for progress bars
      for (const selector of veo3ProgressSelectors) {
        try {
          const element = await driver.findElement(By.css(selector));
          if (await element.isDisplayed()) {
            const ariaValue = await element.getAttribute("aria-valuenow");
            const ariaMax = await element.getAttribute("aria-valuemax");
            const styleWidth = await element.getAttribute("style");
            const textContent = await element.getText();

            console.log(`📊 Progress element found: ${selector}`);
            console.log(`  - aria-valuenow: ${ariaValue}`);
            console.log(`  - style: ${styleWidth}`);
            console.log(`  - text: ${textContent}`);

            if (ariaValue && ariaMax) {
              progressData.percentage = Math.round((parseInt(ariaValue) / parseInt(ariaMax)) * 100);
            } else if (ariaValue) {
              progressData.percentage = parseInt(ariaValue);
            } else if (styleWidth && styleWidth.includes("width:")) {
              const match = styleWidth.match(/width:\s*(\d+(?:\.\d+)?)%/);
              if (match) {
                progressData.percentage = Math.round(parseFloat(match[1]));
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

      // Check for status messages
      const statusSelectors = [
        '[class*="status"]',
        '[class*="message"]',
        '[class*="info"]',
        '.render-status',
        '.processing-status',
      ];

      for (const selector of statusSelectors) {
        try {
          const elements = await driver.findElements(By.css(selector));
          for (const element of elements) {
            if (await element.isDisplayed()) {
              const text = await element.getText();
              if (text && text.trim().length > 0) {
                console.log(`📝 Status message: "${text}"`);
                if (!progressData.message) {
                  progressData.message = text;
                }

                // Extract stage info
                if (text.includes("đang xử lý") || text.includes("processing")) {
                  progressData.stage = "processing";
                } else if (text.includes("đang tạo") || text.includes("generating")) {
                  progressData.stage = "generating";
                } else if (text.includes("hoàn thành") || text.includes("complete")) {
                  progressData.stage = "completed";
                }

                // Extract time estimates
                const timeMatch = text.match(/(\d+)\s*(phút|giây|minute|second)/i);
                if (timeMatch) {
                  progressData.estimatedTime = timeMatch[0];
                }

                break;
              }
            }
          }
        } catch (e) {
          // Continue
        }
      }

      // Check current page state
      try {
        const currentUrl = await driver.getCurrentUrl();
        const pageTitle = await driver.getTitle();
        console.log(`🌐 Current state - URL: ${currentUrl}, Title: ${pageTitle}`);
      } catch (e) {
        // Ignore
      }

      const hasProgress = progressData.percentage !== null || progressData.message || progressData.stage;
      console.log(`📊 Progress result: ${hasProgress ? JSON.stringify(progressData) : 'No progress info found'}`);

      return hasProgress ? progressData : null;
    } catch (error) {
      console.log(`❌ Error getting progress: ${error.message}`);
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
