#!/usr/bin/env node

/**
 * Test if profile session is valid
 * Usage: node test-session.js
 */

const { Builder, By } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const path = require("path");
const os = require("os");
const fs = require("fs-extra");
const { getChromePath } = require("./src/main/chrome-helper");

async function testSession() {
  const configFile = path.join(
    os.homedir(),
    ".veo3-automation",
    "profiles.json"
  );

  if (!fs.existsSync(configFile)) {
    console.log("❌ No profiles found!");
    process.exit(1);
  }

  const data = fs.readJsonSync(configFile);
  const profiles = data.profiles || [];

  if (profiles.length === 0) {
    console.log("❌ No profiles found!");
    process.exit(1);
  }

  console.log("📋 Select profile to test:\n");
  profiles.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.name}`);
  });

  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise((resolve) => {
    rl.question(`\nSelect (1-${profiles.length}): `, resolve);
  });
  rl.close();

  const index = parseInt(answer) - 1;
  if (index < 0 || index >= profiles.length) {
    console.log("❌ Invalid selection");
    process.exit(1);
  }

  const profile = profiles[index];
  console.log(`\n🧪 Testing session for: ${profile.name}`);
  console.log(`Profile path: ${profile.path}\n`);

  const chromePath = getChromePath();
  const options = new chrome.Options()
    .setChromeBinaryPath(chromePath)
    .addArguments(`--user-data-dir=${profile.path}`)
    .addArguments("--profile-directory=Default") // Use Default profile where cookies are stored
    .addArguments("--no-first-run")
    .addArguments("--no-default-browser-check")
    .excludeSwitches(["enable-automation"]);

  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(options)
    .build();

  try {
    console.log("🌐 Opening Google Flow...");
    await driver.get("https://labs.google/fx/tools/flow");
    await driver.sleep(5000);

    console.log("🔍 Checking for login button...");
    const buttons = await driver.findElements(By.css("button, a"));

    console.log(`\n📊 Found ${buttons.length} buttons/links on page`);
    console.log("Checking for login indicators...\n");

    let foundLogin = false;
    const allButtonTexts = [];

    for (const button of buttons) {
      try {
        const text = await button.getText();
        if (text && text.trim()) {
          allButtonTexts.push(text.trim());
        }

        if (
          text.toLowerCase().includes("sign in") ||
          text.toLowerCase().includes("log in") ||
          text.toLowerCase().includes("đăng nhập") ||
          text.toLowerCase().includes("login")
        ) {
          foundLogin = true;
          console.log(`❌ NOT LOGGED IN! Found button: "${text}"`);
          break;
        }
      } catch (e) {
        // Ignore
      }
    }

    if (!foundLogin) {
      console.log("📋 Sample buttons found (first 10):");
      allButtonTexts.slice(0, 10).forEach((text, i) => {
        console.log(`   ${i + 1}. "${text}"`);
      });
      console.log("");
    }

    if (!foundLogin) {
      console.log("\n✅ LOGGED IN! Session is valid.");
      console.log("You can now run: npm run standalone\n");
    } else {
      console.log("\n💡 Please login:");
      console.log("   npm run login\n");
    }
  } catch (error) {
    console.error("\n❌ Error:", error.message);
  } finally {
    await driver.quit();
  }
}

testSession();
