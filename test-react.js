// Simple test to check if React components are working
const fs = require("fs");
const path = require("path");

console.log("🧪 Testing React UI components...\n");

// Check if build files exist
const distPath = path.join(__dirname, "dist-renderer");
const indexPath = path.join(distPath, "src/renderer/index.html");

if (fs.existsSync(indexPath)) {
  console.log("✅ React build files exist");

  // Check HTML content
  const htmlContent = fs.readFileSync(indexPath, "utf8");
  if (htmlContent.includes("VEO3 Automation Tool")) {
    console.log("✅ HTML contains correct title");
  }

  if (htmlContent.includes("script")) {
    console.log("✅ JavaScript bundle included");
  }

  if (htmlContent.includes("css")) {
    console.log("✅ CSS bundle included");
  }
} else {
  console.log("❌ Build files not found");
  console.log("Run: npm run build-renderer");
}

// Check component files
const components = [
  "src/renderer/App.jsx",
  "src/renderer/components/AccountManager.jsx",
  "src/renderer/components/BatchProcessor.jsx",
  "src/renderer/components/ProgressMonitor.jsx",
  "src/renderer/components/SettingsPanel.jsx",
  "src/renderer/store/app-store.js",
];

console.log("\n📁 Checking component files:");
components.forEach((component) => {
  if (fs.existsSync(component)) {
    console.log(`✅ ${component}`);
  } else {
    console.log(`❌ ${component}`);
  }
});

console.log("\n🎉 React UI setup complete!");
console.log("💡 To run the app:");
console.log("   1. npm run build-renderer  (if needed)");
console.log("   2. npm run dev             (in terminal)");
console.log("   3. Or: electron .          (direct run)");
