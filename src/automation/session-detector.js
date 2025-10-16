const { By, until } = require("selenium-webdriver");

class SessionDetector {
  constructor() {
    this.veo3BaseUrl = "https://labs.google/fx/tools/flow";
    this.loginIndicators = {
      loggedIn: [
        { type: "url", pattern: /\/dashboard|\/projects|\/profile/ },
        { type: "element", selector: '[data-testid="user-menu"]' },
        { type: "element", selector: ".user-avatar" },
        { type: "element", selector: '[href*="logout"]' },
      ],
      loggedOut: [
        { type: "url", pattern: /\/login|\/signin|\/auth/ },
        { type: "element", selector: 'input[type="email"]' },
        { type: "element", selector: 'input[type="password"]' },
        { type: "element", selector: '[data-testid="login-form"]' },
      ],
    };
  }

  async checkVEO3LoginStatus(driver, baseUrl = this.veo3BaseUrl) {
    try {
      // Navigate to VEO3 main page
      await driver.get(baseUrl);

      // Wait for page to load (more flexible timeout)
      try {
        await driver.wait(until.titleContains("VEO"), 5000);
      } catch (titleError) {
        console.log("VEO title not found, checking page anyway...");
      }

      const currentUrl = await driver.getCurrentUrl();

      // Check URL indicators first (fastest)
      const urlStatus = this.checkUrlIndicators(currentUrl);
      if (urlStatus.isLoggedIn !== null) {
        return {
          isLoggedIn: urlStatus.isLoggedIn,
          method: "url",
          currentUrl,
          userInfo: null,
        };
      }

      // Check DOM indicators
      const domStatus = await this.checkDOMIndicators(driver);
      if (domStatus.isLoggedIn !== null) {
        return {
          isLoggedIn: domStatus.isLoggedIn,
          method: "dom",
          currentUrl,
          userInfo: domStatus.userInfo,
        };
      }

      // Check cookies as fallback
      const cookieStatus = await this.checkCookieIndicators(driver);

      return {
        isLoggedIn: cookieStatus.isLoggedIn,
        method: "cookie",
        currentUrl,
        userInfo: cookieStatus.userInfo,
      };
    } catch (error) {
      console.error("Error checking VEO3 login status:", error);
      return {
        isLoggedIn: false,
        method: "error",
        error: error.message,
        currentUrl: null,
        userInfo: null,
      };
    }
  }

  checkUrlIndicators(currentUrl) {
    // Check for logged-in URL patterns
    for (const indicator of this.loginIndicators.loggedIn) {
      if (indicator.type === "url" && indicator.pattern.test(currentUrl)) {
        return { isLoggedIn: true };
      }
    }

    // Check for logged-out URL patterns
    for (const indicator of this.loginIndicators.loggedOut) {
      if (indicator.type === "url" && indicator.pattern.test(currentUrl)) {
        return { isLoggedIn: false };
      }
    }

    return { isLoggedIn: null }; // Inconclusive
  }

  async checkDOMIndicators(driver) {
    try {
      // Check for logged-in elements
      for (const indicator of this.loginIndicators.loggedIn) {
        if (indicator.type === "element") {
          try {
            const element = await driver.findElement(
              By.css(indicator.selector)
            );
            if (element) {
              // Try to extract user info if possible
              let userInfo = null;
              try {
                if (
                  indicator.selector.includes("user-menu") ||
                  indicator.selector.includes("avatar")
                ) {
                  const text = await element.getText();
                  userInfo = { displayName: text };
                }
              } catch (e) {
                // Ignore user info extraction errors
              }

              return { isLoggedIn: true, userInfo };
            }
          } catch (e) {
            // Element not found, continue checking
          }
        }
      }

      // Check for logged-out elements
      for (const indicator of this.loginIndicators.loggedOut) {
        if (indicator.type === "element") {
          try {
            const element = await driver.findElement(
              By.css(indicator.selector)
            );
            if (element) {
              return { isLoggedIn: false, userInfo: null };
            }
          } catch (e) {
            // Element not found, continue checking
          }
        }
      }

      return { isLoggedIn: null, userInfo: null }; // Inconclusive
    } catch (error) {
      console.error("Error checking DOM indicators:", error);
      return { isLoggedIn: null, userInfo: null };
    }
  }

  async checkCookieIndicators(driver) {
    try {
      const cookies = await driver.manage().getCookies();

      // Look for common authentication cookies
      const authCookies = cookies.filter(
        (cookie) =>
          cookie.name.toLowerCase().includes("auth") ||
          cookie.name.toLowerCase().includes("session") ||
          cookie.name.toLowerCase().includes("token") ||
          cookie.name.toLowerCase().includes("jwt")
      );

      if (authCookies.length > 0) {
        // Check if cookies are not expired and have reasonable values
        const validCookies = authCookies.filter((cookie) => {
          const isNotExpired =
            !cookie.expiry || cookie.expiry > Date.now() / 1000;
          const hasValue = cookie.value && cookie.value.length > 10;
          return isNotExpired && hasValue;
        });

        if (validCookies.length > 0) {
          return {
            isLoggedIn: true,
            userInfo: {
              authMethod: "cookie",
              cookieCount: validCookies.length,
            },
          };
        }
      }

      return { isLoggedIn: false, userInfo: null };
    } catch (error) {
      console.error("Error checking cookie indicators:", error);
      return { isLoggedIn: false, userInfo: null };
    }
  }

  async waitForLogin(driver, maxWaitTime = 300000) {
    const startTime = Date.now();
    const checkInterval = 2000; // Check every 2 seconds

    while (Date.now() - startTime < maxWaitTime) {
      const status = await this.checkVEO3LoginStatus(driver);

      if (status.isLoggedIn) {
        return status;
      }

      // Wait before next check
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    throw new Error(
      "Login timeout: User did not complete login within the specified time"
    );
  }

  async promptManualLogin(driver, baseUrl = this.veo3BaseUrl) {
    try {
      // Navigate to login page
      await driver.get(`${baseUrl}/login`);

      console.log("Please complete the login process in the browser window...");

      // Wait for user to complete login
      const result = await this.waitForLogin(driver);

      console.log("Login completed successfully!");
      return result;
    } catch (error) {
      console.error("Manual login failed:", error);
      throw error;
    }
  }
}

module.exports = SessionDetector;
