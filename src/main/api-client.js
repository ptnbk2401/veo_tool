const https = require('https');
const http = require('http');

class VeoApiClient {
  constructor(baseUrl, cookies, logger) {
    this.baseUrl = baseUrl || 'https://labs.google';
    this.cookies = cookies || '';
    this.logger = logger;
  }

  /**
   * Extract cookies from Selenium driver
   */
  static async extractCookies(driver) {
    const cookies = await driver.manage().getCookies();
    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  }

  /**
   * Extract base URL from driver
   */
  static async extractBaseUrl(driver) {
    const currentUrl = await driver.getCurrentUrl();
    const url = new URL(currentUrl);
    // Ensure we have the full domain
    let baseUrl = `${url.protocol}//${url.host}`;
    
    // Fix incomplete domain (labs.google → labs.google.com)
    if (baseUrl.includes('labs.google') && !baseUrl.includes('labs.google.com')) {
      baseUrl = baseUrl.replace('labs.google', 'labs.google.com');
    }
    
    return baseUrl;
  }

  /**
   * Make HTTP request with retry logic
   */
  async makeRequest(method, path, body, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const result = await this._makeRequestOnce(method, path, body);
        return result;
      } catch (error) {
        this.logger?.warn(`API request attempt ${attempt}/${retries} failed: ${error.message}`);
        
        if (attempt < retries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, attempt - 1) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Make single HTTP request
   */
  _makeRequestOnce(method, path, body) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.baseUrl);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const bodyStr = body ? JSON.stringify(body) : null;

      const options = {
        method,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Cookie': this.cookies,
          'x-same-domain': 'true',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 15000, // 15s timeout
      };
      
      // Debug logging
      this.logger?.info(`API Request: ${method} ${url.href}`);

      if (bodyStr) {
        options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
      }

      const req = client.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const parsed = JSON.parse(data);
              resolve(parsed);
            } catch (err) {
              reject(new Error(`Failed to parse JSON response: ${err.message}`));
            }
          } else if (res.statusCode === 401 || res.statusCode === 403) {
            reject(new Error(`Authentication failed: ${res.statusCode} ${res.statusMessage}`));
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (bodyStr) {
        req.write(bodyStr);
      }

      req.end();
    });
  }

  /**
   * Submit prompt to VEO API
   * POST /v1/video:batchAsyncGenerateVideoText
   */
  async submitPrompt(promptText, settings = {}) {
    const body = {
      requestData: {
        videoGenerationRequestData: {
          videoModelControlInput: {
            videoModelName: settings.videoModelName || 'veo_3_1_t2v_fast_ultra',
            videoGenerationMode: 'VIDEO_GENERATION_MODE_TEXT_TO_VIDEO',
            videoAspectRatio: settings.videoAspectRatio || 'VIDEO_ASPECT_RATIO_LANDSCAPE',
          },
        },
        promptInputs: [
          { textInput: promptText },
        ],
      },
    };

    this.logger?.info(`Submitting prompt via API: ${promptText.slice(0, 50)}...`);

    const response = await this.makeRequest('POST', '/v1/video:batchAsyncGenerateVideoText', body);

    this.logger?.info(`API response: ${response.operations?.length || 0} operations, credits: ${response.remainingCredits}`);

    return response;
  }

  /**
   * Poll status of operations
   * POST /v1/video:batchCheckAsyncVideoGenerationStatus
   */
  async pollStatus(operations) {
    const body = {
      operations: operations.map(op => ({
        operation: { name: op.op_name },
        sceneId: op.scene_id,
        status: op.status,
      })),
    };

    this.logger?.info(`Polling status for ${operations.length} operations`);

    const response = await this.makeRequest('POST', '/v1/video:batchCheckAsyncVideoGenerationStatus', body);

    return response;
  }

  /**
   * Download video from fifeUrl
   */
  async downloadVideo(fifeUrl, filePath, onProgress) {
    return new Promise((resolve, reject) => {
      const url = new URL(fifeUrl);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        timeout: 60000, // 60s timeout for downloads
      };

      const req = client.request(options, (res) => {
        if (res.statusCode === 200) {
          const fs = require('fs');
          const tmpPath = `${filePath}.tmp`;
          const fileStream = fs.createWriteStream(tmpPath);

          let downloaded = 0;
          const totalSize = parseInt(res.headers['content-length'] || '0', 10);

          res.on('data', (chunk) => {
            downloaded += chunk.length;
            if (onProgress && totalSize > 0) {
              onProgress(downloaded, totalSize);
            }
          });

          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            // Atomic rename
            fs.renameSync(tmpPath, filePath);
            this.logger?.info(`Downloaded: ${filePath}`);
            resolve(filePath);
          });

          fileStream.on('error', (error) => {
            fs.unlinkSync(tmpPath).catch(() => {});
            reject(error);
          });
        } else if (res.statusCode === 302 || res.statusCode === 301) {
          // Follow redirect
          const redirectUrl = res.headers.location;
          this.logger?.info(`Following redirect to: ${redirectUrl}`);
          this.downloadVideo(redirectUrl, filePath, onProgress).then(resolve).catch(reject);
        } else if (res.statusCode === 403) {
          reject(new Error('URL expired (403)'));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
        }
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Download timeout'));
      });

      req.end();
    });
  }
}

module.exports = VeoApiClient;
