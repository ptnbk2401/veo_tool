const { Builder } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const { By, until } = require("selenium-webdriver");

async function inspectLoginStatus() {
  console.log("🔍 Inspecting VEO Flow login status indicators...\n");

  const profilePath =
    "/Users/nals_macbook_206/Library/Application Support/Google/Chrome/Default";
  const veoFlowUrl = "https://labs.google/fx/tools/flow";

  try {
    // Create stealth Chrome options
    const chromeOptions = new chrome.Options();
    chromeOptions.addArguments(`--user-data-dir=${profilePath}`);
    chromeOptions.addArguments("--no-first-run");
    chromeOptions.addArguments("--disable-blink-features=AutomationControlled");
    chromeOptions.excludeSwitches(["enable-automation"]);

    const driver = await new Builder()
      .forBrowser("chrome")
      .setChromeOptions(chromeOptions)
      .build();

    console.log("🚀 Browser created, navigating to VEO Flow...");
    await driver.get(veoFlowUrl);
    await driver.sleep(5000);

    const currentUrl = await driver.getCurrentUrl();
    console.log("📍 Current URL:", currentUrl);

    // Check if redirected to login
    if (currentUrl.includes("accounts.google.com")) {
      console.log("❌ NOT LOGGED IN - Redirected to Google login");
      console.log("💡 Please login manually and run the script again");

      console.log("\n⏳ Waiting for manual login (60 seconds)...");
      await driver.sleep(60000);

      const newUrl = await driver.getCurrentUrl();
      if (!newUrl.includes("accounts.google.com")) {
        console.log("✅ Login completed! Analyzing logged-in state...");
      } else {
        console.log("⏰ Still on login page");
        await driver.quit();
        return;
      }
    } else {
      console.log("✅ Already on VEO Flow page - checking login status...");
    }

    // Analyze page elements to detect login status
    console.log("\n🔍 Analyzing page elements...");

    // 1. Check page title and URL
    const title = await driver.getTitle();
    console.log("📄 Page title:", title);

    // 2. Look for user-related elements
    const userIndicators = [
      // Google account indicators
      '[data-testid="user-avatar"]',
      ".user-avatar",
      '[aria-label*="Account"]',
      '[aria-label*="Profile"]',
      'img[alt*="Profile"]',
      'button[aria-label*="Google Account"]',

      // Common login/logout buttons
      'button:contains("Sign in")',
      'button:contains("Login")',
      'button:contains("Sign out")',
      'button:contains("Logout")',

      // User menu or dropdown
      '[data-testid="user-menu"]',
      ".user-menu",
      ".account-menu",

      // Profile picture or initials
      ".profile-picture",
      ".user-initials",
      'img[src*="googleusercontent"]',
    ];

    console.log("\n🔍 Checking for user indicators...");
    let loginIndicatorsFound = [];

    for (const selector of userIndicators) {
      try {
        let elements;

        if (selector.includes(":contains(")) {
          // Convert to XPath for text-based selectors
          const text = selector.match(/contains\("([^"]+)"\)/)[1];
          const tag = selector.split(":")[0];
          const xpath = `//${tag}[contains(text(), "${text}")]`;
          elements = await driver.findElements(By.xpath(xpath));
        } else {
          elements = await driver.findElements(By.css(selector));
        }

        if (elements.length > 0) {
          console.log(`✅ Found: ${selector} (${elements.length} elements)`);
          loginIndicatorsFound.push(selector);

          // Try to get text content for analysis
          for (let i = 0; i < Math.min(elements.length, 3); i++) {
            try {
              const text = await elements[i].getText();
              const tagName = await elements[i].getTagName();
              if (text) {
                console.log(`   Text: "${text}" (${tagName})`);
              }
            } catch (e) {
              // Ignore text extraction errors
            }
          }
        }
      } catch (e) {
        // Element not found or error
      }
    }

    // 3. Check cookies for authentication
    console.log("\n🍪 Checking authentication cookies...");
    const cookies = await driver.manage().getCookies();
    const authCookies = cookies.filter(
      (cookie) =>
        cookie.name.toLowerCase().includes("auth") ||
        cookie.name.toLowerCase().includes("session") ||
        cookie.name.toLowerCase().includes("token") ||
        cookie.name.toLowerCase().includes("login") ||
        cookie.domain.includes("google")
    );

    console.log(`Found ${authCookies.length} potential auth cookies:`);
    authCookies.forEach((cookie) => {
      console.log(`  - ${cookie.name} (${cookie.domain})`);
    });

    // 4. Check local storage
    console.log("\n💾 Checking local storage...");
    try {
      const localStorageKeys = await driver.executeScript(`
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
          keys.push(localStorage.key(i));
        }
        return keys;
      `);

      const authKeys = localStorageKeys.filter(
        (key) =>
          key &&
          (key.toLowerCase().includes("auth") ||
            key.toLowerCase().includes("user") ||
            key.toLowerCase().includes("token") ||
            key.toLowerCase().includes("session"))
      );

      console.log(
        `Found ${authKeys.length} potential auth keys in localStorage:`
      );
      authKeys.forEach((key) => console.log(`  - ${key}`));
    } catch (e) {
      console.log("Could not access localStorage");
    }

    // 5. Look for specific VEO Flow elements
    console.log("\n🎬 Looking for VEO Flow specific elements...");
    const veoElements = [
      'textarea[placeholder*="prompt"]',
      'input[placeholder*="describe"]',
      'button[aria-label*="generate"]',
      'button[aria-label*="create"]',
      ".prompt-input",
      ".video-generator",
      '[data-testid*="prompt"]',
      '[data-testid*="generate"]',
    ];

    let veoElementsFound = [];
    for (const selector of veoElements) {
      try {
        const elements = await driver.findElements(By.css(selector));
        if (elements.length > 0) {
          console.log(`✅ Found VEO element: ${selector}`);
          veoElementsFound.push(selector);
        }
      } catch (e) {
        // Element not found
      }
    }

    // 6. Summary and recommendations
    console.log("\n📊 ANALYSIS SUMMARY:");
    console.log("=".repeat(50));

    if (loginIndicatorsFound.length > 0) {
      console.log("✅ LOGIN STATUS: Likely logged in");
      console.log(`   Found ${loginIndicatorsFound.length} login indicators`);
    } else {
      console.log("❌ LOGIN STATUS: Likely not logged in");
      console.log("   No clear login indicators found");
    }

    if (authCookies.length > 0) {
      console.log("✅ COOKIES: Authentication cookies present");
    } else {
      console.log("❌ COOKIES: No authentication cookies found");
    }

    if (veoElementsFound.length > 0) {
      console.log("✅ VEO ACCESS: Can access VEO Flow features");
      console.log(`   Found ${veoElementsFound.length} VEO-specific elements`);
    } else {
      console.log("❌ VEO ACCESS: Limited access to VEO Flow features");
    }

    console.log("\n💡 RECOMMENDED DETECTION STRATEGY:");
    if (loginIndicatorsFound.length > 0) {
      console.log(
        `Use these selectors to detect login: ${loginIndicatorsFound
          .slice(0, 3)
          .join(", ")}`
      );
    }
    if (authCookies.length > 0) {
      console.log(
        `Check for these cookies: ${authCookies
          .slice(0, 3)
          .map((c) => c.name)
          .join(", ")}`
      );
    }

    console.log(
      "\n⏳ Keeping browser open for manual inspection (30 seconds)..."
    );
    await driver.sleep(30000);

    await driver.quit();
    console.log("✅ Analysis completed");
  } catch (error) {
    console.error("❌ Analysis failed:", error.message);
  }
}

inspectLoginStatus();
