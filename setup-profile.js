#!/usr/bin/env node

const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const { v4: uuidv4 } = require("uuid");
const { getChromePath, getChromeVersion } = require("./src/main/chrome-helper");
const { spawn } = require("child_process");
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  console.log("🚀 VEO3 Profile Setup\n");

  // Check Chrome
  console.log("1️⃣  Checking Chrome...");
  try {
    const chromePath = getChromePath();
    const version = getChromeVersion();
    console.log(`   ✅ ${version}\n`);
  } catch (error) {
    console.error(
      "   ❌ Chrome not found! Install: https://www.google.com/chrome/\n",
    );
    process.exit(1);
  }

  // Load existing profiles
  const profilesDir = path.join(os.homedir(), ".veo3-automation", "profiles");
  const configFile = path.join(
    os.homedir(),
    ".veo3-automation",
    "profiles.json",
  );
  await fs.ensureDir(profilesDir);

  let profiles = [];
  if (await fs.pathExists(configFile)) {
    const data = await fs.readJson(configFile);
    profiles = data.profiles || [];
  }

  console.log("2️⃣  Profile setup...");

  let profile;

  // Show existing profiles
  if (profiles.length > 0) {
    console.log(`\n   Existing profiles:`);
    profiles.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.name}`);
    });
    console.log(`   ${profiles.length + 1}. Create new profile\n`);

    let choice;
    try {
      choice = await question(`   Select (1-${profiles.length + 1}): `);
    } catch (error) {
      choice = "1"; // Default to first profile
    }

    const index = parseInt(choice) - 1;

    if (index >= 0 && index < profiles.length) {
      // Use existing profile
      profile = profiles[index];
      console.log(`\n   ✅ Selected: ${profile.name}\n`);
    } else if (index === profiles.length) {
      // Create new
      profile = await createNewProfile(profiles, profilesDir, configFile);
    } else {
      console.log("   ❌ Invalid selection");
      rl.close();
      process.exit(1);
    }
  } else {
    // No profiles, create first one
    console.log("   No profiles found. Creating first profile...\n");
    profile = await createNewProfile(profiles, profilesDir, configFile);
  }

  // Ask to login
  console.log("3️⃣  Login to Google Flow...");
  let shouldLogin = "n";

  try {
    shouldLogin = await question("   Open Chrome to login now? (y/n): ");
  } catch (error) {
    // Skip
  }

  if (shouldLogin.toLowerCase() === "y") {
    console.log("\n   Opening Chrome...\n");

    const chromePath = getChromePath();
    const child = spawn(
      chromePath,
      [
        `--user-data-dir=${profile.path}`,
        "--profile-directory=Default", // Use Default profile to match Selenium
        "--no-first-run",
        "--no-default-browser-check",
        "https://labs.google/fx/tools/flow",
      ],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    child.unref();

    console.log("   📋 Login with your Google AI Pro/Ultra account");
    console.log("   📋 Close Chrome when done\n");
  }

  // Summary
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ Setup Complete!\n");
  console.log(`📝 Profile: ${profile.name}`);
  console.log(`📁 Path: ${profile.path}\n`);
  console.log("🎯 Next Steps:");
  console.log("   npm run standalone    # Run automation");
  console.log("   npm run profiles      # List all profiles");
  console.log("   npm run login         # Login again\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  rl.close();
}

async function createNewProfile(profiles, profilesDir, configFile) {
  let profileName = process.argv[2];

  if (!profileName) {
    try {
      profileName = await question("   Enter profile name: ");
    } catch (error) {
      profileName = "";
    }

    if (!profileName.trim()) {
      console.log("   ❌ Profile name is required");
      rl.close();
      process.exit(1);
    }
  }

  const profileId = uuidv4();
  const profilePath = path.join(profilesDir, profileId);
  await fs.ensureDir(profilePath);

  const profile = {
    id: profileId,
    name: profileName.trim(),
    path: profilePath,
    createdAt: new Date().toISOString(),
    lastUsed: null,
  };

  profiles.push(profile);
  await fs.writeJson(configFile, { profiles }, { spaces: 2 });

  console.log(`\n   ✅ Created: ${profile.name}\n`);

  return profile;
}

main().catch((error) => {
  console.error("\n❌ Error:", error.message);
  rl.close();
  process.exit(1);
});
