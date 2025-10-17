#!/usr/bin/env node

/**
 * Helper script to open Chrome with specific profile
 * Usage: node open-chrome-profile.js [profile-name]
 */

const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs-extra");
const { getChromePath } = require("./src/main/chrome-helper");
const readline = require("readline");

async function getProfilePath(profileName) {
  const configFile = path.join(
    os.homedir(),
    ".veo3-automation",
    "profiles.json"
  );

  if (!fs.existsSync(configFile)) {
    console.log("❌ No profiles found!");
    console.log("Create a profile with: npm run setup\n");
    process.exit(1);
  }

  const data = fs.readJsonSync(configFile);
  const profiles = data.profiles || [];

  if (profiles.length === 0) {
    console.log("❌ No profiles found!");
    console.log("Create a profile with: npm run setup\n");
    process.exit(1);
  }

  // If profile name specified, find it
  if (profileName) {
    const profile = profiles.find((p) => p.name === profileName);
    if (profile) {
      console.log(`Using profile: ${profile.name}\n`);
      return profile.path;
    } else {
      console.log(`❌ Profile "${profileName}" not found!`);
      console.log("\nAvailable profiles:");
      profiles.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}`));
      process.exit(1);
    }
  }

  // Multiple profiles - ask user to select
  if (profiles.length > 1) {
    console.log("📋 Available profiles:");
    profiles.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name}`);
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise((resolve) => {
      rl.question(
        `\n💡 Select profile (1-${profiles.length}) or press Enter for first: `,
        resolve
      );
    });
    rl.close();

    const index = answer.trim() ? parseInt(answer) - 1 : 0;

    if (index >= 0 && index < profiles.length) {
      const selectedProfile = profiles[index];
      console.log(`\n✅ Using profile: ${selectedProfile.name}\n`);
      return selectedProfile.path;
    } else {
      console.log("❌ Invalid selection, using first profile\n");
      return profiles[0].path;
    }
  }

  // Single profile - use it
  console.log(`Using profile: ${profiles[0].name}\n`);
  return profiles[0].path;
}

async function main() {
  console.log("🚀 Opening Chrome for Login\n");

  // Get profile name from argument
  const profileName = process.argv[2];
  const profilePath = await getProfilePath(profileName);

  try {
    const chromePath = getChromePath();
    console.log(`Chrome: ${chromePath}\n`);

    // Open Chrome with profile
    const args = [
      `--user-data-dir=${profilePath}`,
      "--profile-directory=Default", // Use Default profile to match Selenium
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-infobars",
      "https://labs.google/fx/tools/flow",
    ];

    console.log("📋 Instructions:");
    console.log("1. Chrome will open with Google Flow");
    console.log("2. Login with your Google AI Pro/Ultra account");
    console.log("3. Verify you can access Veo 3");
    console.log(
      "4. ⚠️  WAIT 5-10 seconds after login (let Chrome save session)"
    );
    console.log("5. Close Chrome when done\n");

    const child = spawn(chromePath, args, {
      detached: true,
      stdio: "ignore",
    });

    child.unref();

    console.log("✅ Chrome opened successfully!\n");
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error("\nMake sure Chrome is installed:");
    console.error("  macOS: brew install --cask google-chrome");
    console.error("  Or download from: https://www.google.com/chrome/\n");
    process.exit(1);
  }
}

main();
