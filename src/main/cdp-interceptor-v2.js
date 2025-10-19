/**
 * CDP Interceptor V2 - Inject script to intercept fetch/XHR
 * Simpler and more reliable than CDP Network domain
 */

class CDPInterceptorV2 {
  constructor(driver, logger) {
    this.driver = driver;
    this.logger = logger;
    this.listeners = {
      submit: [],
      poll: [],
    };
  }

  /**
   * Enable interception by injecting script into page
   */
  async enable() {
    try {
      this.logger?.info('Injecting network interceptor script...');
      
      // Inject script to intercept fetch
      await this.driver.executeScript(`
        // Store intercepted responses
        window.__veoInterceptedResponses = {
          submit: [],
          poll: []
        };
        
        // Intercept fetch
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
          const response = await originalFetch.apply(this, args);
          
          // Clone response to read body
          const clonedResponse = response.clone();
          const url = args[0];
          
          // Check if this is a VEO API call
          if (url.includes('batchAsyncGenerateVideoText')) {
            try {
              const data = await clonedResponse.json();
              window.__veoInterceptedResponses.submit.push({
                url: url,
                data: data,
                timestamp: Date.now()
              });
              console.log('🎯 Intercepted submit:', data);
            } catch (e) {
              console.error('Failed to parse submit response:', e);
            }
          } else if (url.includes('batchCheckAsyncVideoGenerationStatus')) {
            try {
              const data = await clonedResponse.json();
              window.__veoInterceptedResponses.poll.push({
                url: url,
                data: data,
                timestamp: Date.now()
              });
              console.log('🎯 Intercepted poll:', data);
            } catch (e) {
              console.error('Failed to parse poll response:', e);
            }
          }
          
          return response;
        };
        
        // Intercept XMLHttpRequest
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          this.__url = url;
          return originalOpen.apply(this, [method, url, ...rest]);
        };
        
        XMLHttpRequest.prototype.send = function(...args) {
          this.addEventListener('load', function() {
            const url = this.__url;
            
            if (url && url.includes('batchAsyncGenerateVideoText')) {
              try {
                const data = JSON.parse(this.responseText);
                window.__veoInterceptedResponses.submit.push({
                  url: url,
                  data: data,
                  timestamp: Date.now()
                });
                console.log('🎯 Intercepted submit (XHR):', data);
              } catch (e) {
                console.error('Failed to parse submit response (XHR):', e);
              }
            } else if (url && url.includes('batchCheckAsyncVideoGenerationStatus')) {
              try {
                const data = JSON.parse(this.responseText);
                window.__veoInterceptedResponses.poll.push({
                  url: url,
                  data: data,
                  timestamp: Date.now()
                });
                console.log('🎯 Intercepted poll (XHR):', data);
              } catch (e) {
                console.error('Failed to parse poll response (XHR):', e);
              }
            }
          });
          
          return originalSend.apply(this, args);
        };
        
        console.log('✅ VEO network interceptor injected');
      `);
      
      this.logger?.info('Network interceptor script injected successfully');
      
      // Start polling for intercepted responses
      this.startPolling();
      
    } catch (error) {
      this.logger?.error(`Failed to inject interceptor: ${error.message}`);
      throw error;
    }
  }

  /**
   * Poll for intercepted responses
   */
  startPolling() {
    this.pollingInterval = setInterval(async () => {
      try {
        // Get intercepted responses from page
        const responses = await this.driver.executeScript(`
          const responses = window.__veoInterceptedResponses;
          const result = {
            submit: [...responses.submit],
            poll: [...responses.poll]
          };
          
          // Clear processed responses
          responses.submit = [];
          responses.poll = [];
          
          return result;
        `);
        
        // Process submit responses
        if (responses.submit && responses.submit.length > 0) {
          for (const item of responses.submit) {
            this.logger?.info(`📥 Submit response: ${item.data.operations?.length || 0} operations`);
            this.listeners.submit.forEach(cb => cb(item.data));
          }
        }
        
        // Process poll responses
        if (responses.poll && responses.poll.length > 0) {
          for (const item of responses.poll) {
            this.logger?.info(`📥 Poll response: ${item.data.operations?.length || 0} operations`);
            this.listeners.poll.forEach(cb => cb(item.data));
          }
        }
        
      } catch (error) {
        // Ignore polling errors (page might not be ready)
      }
    }, 500); // Poll every 500ms
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
   * Disable interception
   */
  async disable() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    
    this.logger?.info('Network interception disabled');
  }
}

module.exports = CDPInterceptorV2;
