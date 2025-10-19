const { exec } = require("child_process");

async function killChrome() {
  console.log("🔪 Killing all Chrome processes...\n");

  return new Promise((resolve) => {
    // Kill Chrome processes on macOS
    exec('pkill -f "Google Chrome"', (error, stdout, stderr) => {
      if (error) {
        console.log("ℹ️  No Chrome processes found or already closed");
      } else {
        console.log("✅ Chrome processes killed");
      }

      // Also kill chromedriver processes
      exec("pkill -f chromedriver", (error2, stdout2, stderr2) => {
        if (error2) {
          console.log("ℹ️  No chromedriver processes found");
        } else {
          console.log("✅ Chromedriver processes killed");
        }

        console.log("\n🎉 All Chrome-related processes cleaned up");
        console.log("💡 You can now run: node test-veo-basic.js");
        resolve();
      });
    });
  });
}

killChrome();
