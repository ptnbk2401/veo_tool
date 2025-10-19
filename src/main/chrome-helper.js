const fs = require("fs-extra");
const { execSync } = require("child_process");

/**
 * Detect Chrome binary path based on OS
 */
function getChromePath() {
  const platform = process.platform;

  if (platform === "darwin") {
    // macOS
    const paths = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    ];

    for (const path of paths) {
      if (fs.existsSync(path)) {
        return path;
      }
    }
  } else if (platform === "win32") {
    // Windows
    const paths = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    ];

    for (const path of paths) {
      if (fs.existsSync(path)) {
        return path;
      }
    }
  } else {
    // Linux
    const commands = [
      "google-chrome",
      "google-chrome-stable",
      "chromium-browser",
      "chromium",
    ];

    for (const cmd of commands) {
      try {
        const path = execSync(`which ${cmd}`, { encoding: "utf-8" }).trim();
        if (path) {
          return path;
        }
      } catch (e) {
        // Command not found, continue
      }
    }
  }

  throw new Error(
    "Chrome not found. Please install Google Chrome:\n" +
      "  macOS: https://www.google.com/chrome/\n" +
      "  Windows: https://www.google.com/chrome/\n" +
      "  Linux: sudo apt install google-chrome-stable",
  );
}

/**
 * Check if Chrome is installed
 */
function isChromeInstalled() {
  try {
    getChromePath();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Get Chrome version
 */
function getChromeVersion() {
  try {
    const chromePath = getChromePath();
    const platform = process.platform;

    if (platform === "darwin") {
      const version = execSync(`"${chromePath}" --version`, {
        encoding: "utf-8",
      }).trim();
      return version;
    } else if (platform === "win32") {
      const version = execSync(`"${chromePath}" --version`, {
        encoding: "utf-8",
      }).trim();
      return version;
    } else {
      const version = execSync(`${chromePath} --version`, {
        encoding: "utf-8",
      }).trim();
      return version;
    }
  } catch (e) {
    return "Unknown";
  }
}

/**
 * Open Chrome with specific profile
 * This is a helper for manual login
 */
function openChromeWithProfile(profilePath) {
  const chromePath = getChromePath();
  const platform = process.platform;

  let command;
  if (platform === "darwin") {
    command = `"${chromePath}" --user-data-dir="${profilePath}" --no-first-run --no-default-browser-check`;
  } else if (platform === "win32") {
    command = `"${chromePath}" --user-data-dir="${profilePath}" --no-first-run --no-default-browser-check`;
  } else {
    command = `${chromePath} --user-data-dir="${profilePath}" --no-first-run --no-default-browser-check`;
  }

  console.log("Opening Chrome with command:", command);

  try {
    // Open Chrome in background (don't wait for it to close)
    const { spawn } = require("child_process");
    const child = spawn(
      chromePath,
      [
        `--user-data-dir=${profilePath}`,
        "--profile-directory=Default", // Use Default profile to match Selenium
        "--no-first-run",
        "--no-default-browser-check",
      ],
      {
        detached: true,
        stdio: "ignore",
      },
    );

    child.unref();
    return true;
  } catch (e) {
    console.error("Failed to open Chrome:", e);
    return false;
  }
}

module.exports = {
  getChromePath,
  isChromeInstalled,
  getChromeVersion,
  openChromeWithProfile,
};
