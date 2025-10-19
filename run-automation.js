#!/usr/bin/env node

/**
 * Standalone automation runner for VEO3
 * Run without Electron to bypass macOS Gatekeeper
 *
 * Usage:
 *   node run-automation.js
 *   node run-automation.js --csv=prompts.csv --aspect-ratio=16:9 --output-count=1
 */

const path = require("path");
const os = require("os");
const fs = require("fs-extra");
const {
  automateWithAPIQueue,
  loadPromptsFromCSV,
} = require("./src/main/automation");

// Get profile path from profiles.json
async function getProfilePath(profileName) {
  const configFile = path.join(
    os.homedir(),
    ".veo3-automation",
    "profiles.json",
  );

  // Check if profiles.json exists
  if (fs.existsSync(configFile)) {
    try {
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
          console.log(`Using profile: ${profile.name}`);
          return profile.path;
        } else {
          console.log(`❌ Profile "${profileName}" not found!`);
          console.log("\nAvailable profiles:");
          profiles.forEach((p, i) => console.log(`  ${i + 1}. ${p.name}`));
          console.log(
            '\nUse: npm run standalone -- --profile-name="Profile Name"\n',
          );
          process.exit(1);
        }
      }

      // Multiple profiles - ask user to select
      if (profiles.length > 1) {
        console.log("📋 Available profiles:");
        profiles.forEach((p, i) => {
          console.log(`  ${i + 1}. ${p.name}`);
        });

        // Interactive prompt
        const readline = require("readline");
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise((resolve) => {
          rl.question(
            `\n💡 Select profile (1-${profiles.length}) or press Enter for first: `,
            resolve,
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
    } catch (error) {
      console.warn("Could not read profiles.json:", error.message);
    }
  }

  // Fallback to default
  console.log("❌ No profiles found!");
  console.log("Create a profile with: npm run setup\n");
  process.exit(1);
}

async function checkProfileInUse(profilePath) {
  const { exec } = require("child_process");
  return new Promise((resolve) => {
    // Check if Chrome is using this specific profile
    exec(`pgrep -f "${profilePath}"`, (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve(null); // Profile not in use
      } else {
        resolve(stdout.trim().split("\n")[0]); // Return PID
      }
    });
  });
}

async function killChromeProfile(pid) {
  const { exec } = require("child_process");
  return new Promise((resolve) => {
    exec(`kill ${pid}`, (error) => {
      resolve(!error);
    });
  });
}

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);

  // Check for profile name first
  let profileName = null;
  args.forEach((arg) => {
    if (arg.startsWith("--profile-name=")) {
      profileName = arg.split("=")[1];
    }
  });

  const config = {
    csvPath: "prompts.csv",
    aspectRatio: "16:9",
    outputCount: 1,
    headless: false, // Default: visible mode for debugging
    profilePath: await getProfilePath(profileName),
  };

  // Check if this profile is already in use
  const pid = await checkProfileInUse(config.profilePath);
  if (pid) {
    console.log("\n⚠️  WARNING: This profile is already in use by Chrome!");
    console.log(`Process ID: ${pid}\n`);
    console.log("Options:");
    console.log("  1. Close Chrome window using this profile");
    console.log("  2. Kill this Chrome process (y)");
    console.log("  3. Abort (N)\n");

    const readline = require("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise((resolve) => {
      rl.question("Kill Chrome process? (y/N): ", resolve);
    });
    rl.close();

    if (answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
      console.log(`\n🔪 Killing Chrome process ${pid}...`);
      const killed = await killChromeProfile(pid);
      if (killed) {
        console.log("✅ Chrome process killed");
        console.log("⏳ Waiting 2 seconds...\n");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } else {
        console.log("❌ Failed to kill Chrome process");
        console.log("Please close Chrome manually and try again.\n");
        process.exit(1);
      }
    } else {
      console.log("\n❌ Aborted. Please close Chrome and try again.\n");
      process.exit(0);
    }
  }

  args.forEach((arg) => {
    if (arg.startsWith("--csv=")) {
      config.csvPath = arg.split("=")[1];
    } else if (arg.startsWith("--aspect-ratio=")) {
      config.aspectRatio = arg.split("=")[1];
    } else if (arg.startsWith("--output-count=")) {
      config.outputCount = parseInt(arg.split("=")[1]);
    } else if (arg.startsWith("--profile=")) {
      config.profilePath = arg.split("=")[1];
    } else if (arg.startsWith("--profile-name=")) {
      // Already handled above
    } else if (arg === "--headless") {
      config.headless = true;
    }
  });

  console.log("\n🚀 VEO3 Automation Tool - API-Driven Mode");
  console.log("==========================================");
  console.log(`CSV File: ${config.csvPath}`);
  console.log(`Profile Path: ${config.profilePath}`);
  console.log(`Mode: API-Driven (Submit → Poll → Download via VEO APIs)`);
  console.log("==========================================");
  console.log("\n💡 Tips:");
  console.log("  - List profiles: npm run profiles");
  console.log('  - Use specific profile: --profile-name="Profile Name"');
  console.log("  - Run headless: --headless");
  console.log("  - Create new profile: npm run setup");
  console.log("\n⚠️  Chrome will be VISIBLE by default (for debugging)");
  console.log("   Don't close Chrome manually while running!\n");

  try {
    // Load prompts from CSV
    console.log("📄 Loading prompts from CSV...");
    const prompts = await loadPromptsFromCSV(config.csvPath);
    console.log(`✓ Loaded ${prompts.length} prompts\n`);

    // Run automation
    console.log("🎬 Starting API-driven automation...\n");

    const twoPhaseResults = await automateWithAPIQueue(
      config.profilePath,
      prompts,
      {
        downloadConcurrency: 5,
        retryMax: 3,
      },
    );

    // Convert to compatible format for summary
    const results = twoPhaseResults.prompts.map((prompt, index) => {
      const promptVideos = twoPhaseResults.manifest.filter(
        (m) => m.promptIndex === prompt.index,
      );
      return {
        prompt: prompt.promptText,
        filePath:
          promptVideos.length > 0
            ? `dist/videos/${promptVideos[0].filename}`
            : "",
        timestamp: prompt.submitTime || new Date().toISOString(),
        status: promptVideos.length > 0 ? "success" : "no videos found",
      };
    });

    console.log(`\n📊 API-Driven Results:`);
    console.log(`   Total prompts: ${twoPhaseResults.totalPrompts}`);
    console.log(`   Total videos: ${twoPhaseResults.totalVideos}`);
    console.log(`   Prompts with videos: ${twoPhaseResults.promptsWithVideos}`);
    console.log(`   Manifest saved: dist/manifest.json`);
    console.log(`   Database: data/veo-automation.db`);

    // Summary
    const success = results.filter((r) => r.status === "success").length;
    const failed = results.filter((r) => r.status !== "success").length;

    console.log("\n==========================================");
    console.log("✅ Automation Completed!");
    console.log(`Success: ${success}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${results.length}`);
    console.log("==========================================");

    // Show results
    console.log("\n📊 Results:");
    results.forEach((result, index) => {
      if (result.status === "success") {
        console.log(`  ${index + 1}. ✓ ${result.filePath}`);
      } else {
        console.log(`  ${index + 1}. ✗ ${result.status}`);
      }
    });

    console.log("\n📁 Videos saved to: dist/videos/");
    console.log("📝 Output CSV: output.csv");
    console.log("📋 Logs: logs/automation.log\n");

    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error:", error.message);

    // Don't show stack trace for known errors
    if (!error.message.includes("Not logged in")) {
      console.error("\n📋 Stack trace:");
      console.error(error.stack);
    }

    process.exit(1);
  }
}

main();
