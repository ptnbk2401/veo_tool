const fs = require("fs-extra");
const path = require("path");
const os = require("os");

async function findChromeProfiles() {
  console.log("🔍 Finding Chrome profiles...\n");

  const homeDir = os.homedir();
  const chromePath = path.join(
    homeDir,
    "Library/Application Support/Google/Chrome"
  );

  console.log(`Checking: ${chromePath}`);

  try {
    if (await fs.pathExists(chromePath)) {
      console.log("✅ Chrome installation found");

      const items = await fs.readdir(chromePath);
      const profiles = [];

      for (const item of items) {
        if (item === "Default" || item.startsWith("Profile ")) {
          const profilePath = path.join(chromePath, item);
          const prefsPath = path.join(profilePath, "Preferences");

          let profileInfo = { name: item, path: profilePath };

          if (await fs.pathExists(prefsPath)) {
            try {
              const prefs = await fs.readJson(prefsPath);
              if (prefs.profile && prefs.profile.name) {
                profileInfo.displayName = prefs.profile.name;
              }
            } catch (e) {
              // Ignore
            }
          }

          profiles.push(profileInfo);
        }
      }

      console.log(`\nFound ${profiles.length} profiles:`);
      profiles.forEach((profile, i) => {
        console.log(`${i + 1}. ${profile.name}`);
        console.log(`   Path: ${profile.path}`);
        if (profile.displayName) {
          console.log(`   Display: ${profile.displayName}`);
        }
        console.log("");
      });

      if (profiles.length > 0) {
        console.log("💡 To test with a profile:");
        console.log(`node test-veo-basic.js`);
      }
    } else {
      console.log("❌ Chrome not found");
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

findChromeProfiles();
