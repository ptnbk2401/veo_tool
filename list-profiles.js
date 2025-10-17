#!/usr/bin/env node

/**
 * CLI script to list all Chrome profiles
 * Usage: node list-profiles.js
 */

const fs = require("fs-extra");
const path = require("path");
const os = require("os");

async function main() {
  const configFile = path.join(
    os.homedir(),
    ".veo3-automation",
    "profiles.json"
  );

  console.log("📋 VEO3 Chrome Profiles\n");

  if (!(await fs.pathExists(configFile))) {
    console.log("No profiles found.");
    console.log("Create one with: node setup-profile.js\n");
    return;
  }

  const data = await fs.readJson(configFile);
  const profiles = data.profiles || [];

  if (profiles.length === 0) {
    console.log("No profiles found.");
    console.log("Create one with: node setup-profile.js\n");
    return;
  }

  console.log(`Found ${profiles.length} profile(s):\n`);

  profiles.forEach((profile, index) => {
    console.log(`${index + 1}. ${profile.name}`);
    console.log(`   ID: ${profile.id}`);
    console.log(`   Path: ${profile.path}`);
    console.log(`   Created: ${new Date(profile.createdAt).toLocaleString()}`);
    if (profile.lastUsed) {
      console.log(
        `   Last Used: ${new Date(profile.lastUsed).toLocaleString()}`
      );
    }
    console.log("");
  });

  console.log("💡 Tips:");
  console.log('   - Create new: node setup-profile.js "Profile Name"');
  console.log("   - Login: npm run login");
  console.log("   - Run automation: npm run standalone\n");
}

main().catch((error) => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});
