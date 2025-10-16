const { Builder } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const { exec } = require("child_process");

async function killChromeForProfile(profilePath) {
  console.log("🔪 Killing Chrome processes using this profile...");
  return new Promise((resolve) => {
    const escapedPath = profilePath.replace(/'/g, "'\"'\"'");
    exec(`pkill -f "${escapedPath}"`, () => {
      exec("pkill -f chromedriver", () => {
        console.log("✅ Profile-specific Chrome processes cleaned up\n");
        resolve();
      });
    });
  });
}

async function testVEOBasic() {
  console.log("🥷 Testing VEO Flow with stealth mode...\n");

  const profilePath =
    "/Users/nals_macbook_206/Library/Application Support/Google/Chrome/Default";
  const veoFlowUrl = "https://labs.google/fx/tools/flow";

  await killChromeForProfile(profilePath);

  let driver = null;

  try {
    console.log("🚀 Creating stealth browser session...");

    const chromeOptions = new chrome.Options();
    chromeOptions.addArguments(`--user-data-dir=${profilePath}`);
    chromeOptions.addArguments("--no-first-run");
    chromeOptions.addArguments("--no-default-browser-check");
    chromeOptions.addArguments("--disable-blink-features=AutomationControlled");
    chromeOptions.addArguments("--disable-extensions");
    chromeOptions.addArguments("--disable-web-security");
    chromeOptions.addArguments("--allow-running-insecure-content");
    chromeOptions.addArguments("--disable-features=VizDisplayCompositor");
    chromeOptions.addArguments(
      "--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    );
    chromeOptions.excludeSwitches(["enable-automation"]);
    chromeOptions.setUserPreferences({
      "profile.default_content_setting_values.notifications": 2,
      "profile.default_content_settings.popups": 0,
    });

    driver = await new Builder()
      .forBrowser("chrome")
      .setChromeOptions(chromeOptions)
      .build();

    await driver.executeScript(`
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      delete navigator.__webdriver_evaluate;
      delete navigator.__webdriver_script_function;
      if (navigator.chrome) navigator.chrome.runtime = undefined;
    `);

    console.log("✅ Stealth browser created");

    console.log(`\n🎯 Navigating to VEO Flow: ${veoFlowUrl}`);
    await driver.get(veoFlowUrl);
    await driver.sleep(5000);

    const currentUrl = await driver.getCurrentUrl();
    const title = await driver.getTitle();

    console.log("Current URL:", currentUrl);
    console.log("Page title:", title);

    const pageSource = await driver.getPageSource();
    if (pageSource.includes("This browser or app may not be secure")) {
      console.log("❌ Still seeing security warning");
    } else {
      console.log("✅ No security warning detected!");
    }

    if (currentUrl.includes("accounts.google.com")) {
      console.log("🔐 Redirected to Google login - please login manually...");

      let loginCompleted = false;
      let attempts = 0;

      while (!loginCompleted && attempts < 60) {
        await driver.sleep(5000);
        attempts++;

        const newUrl = await driver.getCurrentUrl();
        if (attempts % 6 === 0) {
          console.log(`Waiting for login... (${attempts * 5}s)`);
        }

        if (newUrl.includes("labs.google") && newUrl.includes("flow")) {
          loginCompleted = true;
          console.log("✅ Login completed! Now on VEO Flow");
          break;
        }
      }

      if (!loginCompleted) {
        console.log("⏰ Login timeout");
      }
    } else if (
      currentUrl.includes("labs.google") &&
      currentUrl.includes("flow")
    ) {
      console.log("✅ Already logged in - direct access to VEO Flow");
    }

    console.log("\n📋 VEO Flow ready! Keeping browser open for 30 seconds...");
    await driver.sleep(30000);

    console.log("\n🔒 Closing browser...");
    await driver.quit();
    console.log("✅ Test completed!");
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    if (driver) {
      try {
        await driver.quit();
      } catch (e) {}
    }
  }
}

testVEOBasic();
