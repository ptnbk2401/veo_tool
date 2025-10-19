/**
 * Chrome DevTools Protocol Network Interceptor
 * Passively sniff VEO API requests/responses without making our own calls
 */

class CDPInterceptor {
  constructor(driver, logger) {
    this.driver = driver;
    this.logger = logger;
    this.cdpConnection = null;
    this.pollingInterval = null;
    this.processedSubmits = new Set();
    this.processedPolls = new Set();
    this.listeners = {
      submit: [],
      poll: [],
    };
  }

  /**
   * Enable CDP and start intercepting network traffic
   */
  async enable() {
    try {
      // Get CDP session
      const cdpSession = await this.driver.createCDPConnection('page');
      this.cdpConnection = cdpSession;
      
      // Enable Network domain
      await cdpSession.execute('Network.enable', {});
      
      this.logger?.info('CDP Network interception enabled');

      // Start polling for network events
      this.startPolling();

    } catch (error) {
      this.logger?.error(`Failed to enable CDP: ${error.message}`);
      throw error;
    }
  }

  /**
   * Poll for network events using Performance API
   */
  startPolling() {
    this.pollingInterval = setInterval(async () => {
      try {
        // Get performance entries from browser
        const entries = await this.driver.executeScript(`
          return performance.getEntriesByType('resource')
            .filter(e => e.name.includes('batchAsync'))
            .map(e => ({
              name: e.name,
              duration: e.duration,
              responseEnd: e.responseEnd
            }));
        `);

        // Process new entries
        for (const entry of entries) {
          if (entry.name.includes('batchAsyncGenerateVideoText') && !this.processedSubmits.has(entry.name)) {
            this.processedSubmits.add(entry.name);
            await this.fetchAndProcessResponse(entry.name, 'submit');
          } else if (entry.name.includes('batchCheckAsyncVideoGenerationStatus') && !this.processedPolls.has(entry.name)) {
            this.processedPolls.add(entry.name);
            await this.fetchAndProcessResponse(entry.name, 'poll');
          }
        }
      } catch (error) {
        // Ignore polling errors
      }
    }, 500); // Poll every 500ms
  }

  /**
   * Fetch and process response using CDP
   */
  async fetchAndProcessResponse(url, type) {
    try {
      // Use CDP to get response body
      const result = await this.cdpConnection.execute('Network.getResponseBody', {
        requestId: url, // This won't work, need different approach
      });
      
      if (result && result.body) {
        const data = JSON.parse(result.body);
        
        if (type === 'submit') {
          this.logger?.info(`📥 Submit response: ${data.operations?.length || 0} operations`);
          this.listeners.submit.forEach(cb => cb(data));
        } else if (type === 'poll') {
          this.logger?.info(`📥 Poll response: ${data.operations?.length || 0} operations`);
          this.listeners.poll.forEach(cb => cb(data));
        }
      }
    } catch (error) {
      // Ignore fetch errors
    }
  }



  /**
   * Register listener for submit responses
   */
  onSubmit(callback) {
    this.listeners.submit.push(callback);
  }

  /**
   * Register listener for poll responses
   */
  onPoll(callback) {
    this.listeners.poll.push(callback);
  }

  /**
   * Disable CDP
   */
  async disable() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    
    if (this.cdpConnection) {
      try {
        await this.cdpConnection.execute('Network.disable', {});
      } catch (e) {
        // Ignore
      }
      this.logger?.info('CDP Network interception disabled');
    }
  }
}

module.exports = CDPInterceptor;
