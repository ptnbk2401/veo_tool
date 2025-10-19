#!/usr/bin/env node

/**
 * Helper script to find correct VEO API endpoint
 * Opens Chrome with DevTools and guides user to inspect network requests
 */

const { Builder, By } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const { getChromePath } = require("./src/main/chrome-helper");
const ProfileManager = require("./src/main/profile-manager");

async function findApiEndpoint() {
  console.log('\n🔍 VEO API Endpoint Finder\n');
  console.log('This tool will help you find the correct API endpoint.\n');

  // Get profile
  const profileManager = new ProfileManager();
  await profileManager.init();
  const profiles = profileManager.listProfiles();

  if (profiles.length === 0) {
    console.log('❌ No profiles found!');
    console.log('Create a profile first: npm run setup\n');
    process.exit(1);
  }

  const profile = profiles[0];
  console.log(`Using profile: ${profile.name}\n`);

  // Create driver with DevTools
  const chromePath = getChromePath();
  const options = new chrome.Options()
    .setChromeBinaryPath(chromePath)
    .addArguments(`--user-data-dir=${profile.path}`)
    .addArguments("--profile-directory=Default")
    .addArguments("--auto-open-devtools-for-tabs") // Open DevTools automatically
    .addArguments("--no-sandbox")
    .addArguments("--window-size=1920,1080");

  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(options)
    .build();

  try {
    console.log('📖 Instructions:');
    console.log('1. Chrome will open with DevTools');
    console.log('2. Go to Network tab');
    console.log('3. Filter by: batchAsync');
    console.log('4. Submit a prompt manually on VEO Flow');
    console.log('5. Find the request "batchAsyncGenerateVideoText"');
    console.log('6. Right-click → Copy → Copy as cURL');
    console.log('7. Paste here and press Enter\n');

    // Open VEO Flow
    await driver.get("https://labs.google/fx/tools/flow");
    console.log('✅ VEO Flow opened\n');

    // Wait for user input
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const curlCommand = await new Promise((resolve) => {
      rl.question('Paste cURL command here: ', resolve);
    });
    rl.close();

    // Parse cURL to extract URL
    const urlMatch = curlCommand.match(/curl '([^']+)'/);
    if (urlMatch) {
      const fullUrl = urlMatch[1];
      const url = new URL(fullUrl);
      
      console.log('\n✅ Found API endpoint!\n');
      console.log('Base URL:', `${url.protocol}//${url.host}`);
      console.log('Path:', url.pathname);
      console.log('Full URL:', fullUrl);
      
      // Extract prefix if any
      const pathParts = url.pathname.split('/v1/');
      if (pathParts.length > 1 && pathParts[0]) {
        console.log('\n📝 API Prefix:', pathParts[0]);
        console.log('\nUpdate src/main/api-client.js:');
        console.log(`  this.apiPrefix = '${pathParts[0]}';`);
      }
      
      console.log('\n✅ Done! Update your code with these values.\n');
    } else {
      console.log('\n❌ Could not parse cURL command.');
      console.log('Make sure you copied the full cURL command.\n');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    console.log('\nPress Ctrl+C to close Chrome and exit.\n');
    // Keep browser open for inspection
    await new Promise(() => {}); // Wait forever
  }
}

findApiEndpoint().catch(console.error);
