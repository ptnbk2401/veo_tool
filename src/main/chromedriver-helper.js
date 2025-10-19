const path = require('path');
const fs = require('fs');
const { app } = require('electron');

/**
 * Get ChromeDriver path for packaged app
 */
function getChromedriverPath() {
  if (!app.isPackaged) {
    // Development mode - use default
    return null;
  }

  // Production mode - use bundled chromedriver
  const platform = process.platform;
  const driverName = platform === 'win32' ? 'chromedriver.exe' : 'chromedriver';
  
  // Try multiple locations
  const possiblePaths = [
    path.join(process.resourcesPath, 'drivers', driverName),
    path.join(app.getAppPath(), 'drivers', driverName),
    path.join(__dirname, '../../drivers', driverName),
  ];

  for (const driverPath of possiblePaths) {
    if (fs.existsSync(driverPath)) {
      console.log(`Found ChromeDriver at: ${driverPath}`);
      return driverPath;
    }
  }

  console.warn('ChromeDriver not found in bundled paths, using system default');
  return null;
}

module.exports = { getChromedriverPath };
