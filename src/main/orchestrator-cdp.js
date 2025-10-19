const path = require('path');
const fs = require('fs-extra');
const { By } = require('selenium-webdriver');

/**
 * CDP-based Orchestrator
 * Uses passive network sniffing instead of active API calls
 */
class CDPOrchestrator {
    constructor(driver, cdpInterceptor, db, logger, settings = {}) {
        this.driver = driver;
        this.cdp = cdpInterceptor;
        this.db = db;
        this.logger = logger;
        this.settings = settings;

        // State
        this.running = false;
        this.submitterInterval = null;
        this.pollerInterval = null;
        this.downloaderWorkers = [];

        // Configuration
        this.SUBMIT_INTERVAL_MS = 5000; // 5s between submits
        this.POLL_INTERVAL_MS = 2000; // 2s polling
        this.DOWNLOAD_CONCURRENCY = settings.downloadConcurrency || 5;
        this.OUTPUT_DIR = settings.outputDir || 'dist/videos';

        // Ensure output directory exists
        fs.ensureDirSync(this.OUTPUT_DIR);

        // Setup CDP listeners
        this.setupCDPListeners();
    }

    /**
     * Setup CDP network listeners
     */
    setupCDPListeners() {
        // Listen for submit responses
        this.cdp.onSubmit((data) => {
            this.handleSubmitResponse(data);
        });

        // Listen for poll responses
        this.cdp.onPoll((data) => {
            this.handlePollResponse(data);
        });
    }

    /**
     * Handle submit response from CDP
     */
    async handleSubmitResponse(data) {
        try {
            if (!data.operations || data.operations.length === 0) {
                this.logger?.warn('Submit response has no operations');
                return;
            }

            // Find the prompt that was just submitted
            const prompt = this.currentSubmittingPrompt;
            if (!prompt) {
                this.logger?.warn('No prompt found for submit response');
                return;
            }

            // Mark prompt as in_progress and insert operations
            this.db.markPromptInProgress(prompt.id, data.operations);
            this.logger?.info(`✅ Prompt ${prompt.idx} submitted with ${data.operations.length} operations`);

            this.currentSubmittingPrompt = null;
        } catch (error) {
            this.logger?.error(`Error handling submit response: ${error.message}`);
        }
    }

    /**
     * Handle poll response from CDP
     */
    async handlePollResponse(data) {
        try {
            if (!data.operations || data.operations.length === 0) {
                return;
            }

            // Find which prompt these operations belong to
            const opName = data.operations[0].operation?.name;
            if (!opName) return;

            // Query database to find prompt by operation name
            const operation = this.db.prepare(`
        SELECT prompt_id FROM operations WHERE op_name = ?
      `).get(opName);

            if (!operation) {
                this.logger?.warn(`Operation ${opName} not found in database`);
                return;
            }

            // Update operations
            this.db.updateOperations(operation.prompt_id, data.operations);

            // Check if prompt is complete
            const newStatus = this.db.checkAndUpdatePromptStatus(operation.prompt_id);

            if (newStatus === 'done') {
                const prompt = this.db.prepare('SELECT idx FROM prompts WHERE id = ?').get(operation.prompt_id);
                this.logger?.info(`✅ Prompt ${prompt?.idx} completed`);
            } else if (newStatus === 'failed') {
                const prompt = this.db.prepare('SELECT idx FROM prompts WHERE id = ?').get(operation.prompt_id);
                this.logger?.warn(`❌ Prompt ${prompt?.idx} failed`);
            }
        } catch (error) {
            this.logger?.error(`Error handling poll response: ${error.message}`);
        }
    }

    /**
     * Start orchestration
     */
    start() {
        if (this.running) {
            this.logger?.warn('Orchestrator already running');
            return;
        }

        this.running = true;
        this.logger?.info('Starting CDP orchestrator...');

        // Start submitter
        this.startSubmitter();

        // Start downloader workers
        this.startDownloaders();
    }

    /**
     * Stop orchestration
     */
    stop() {
        this.running = false;
        this.logger?.info('Stopping CDP orchestrator...');

        if (this.submitterInterval) {
            clearInterval(this.submitterInterval);
            this.submitterInterval = null;
        }
    }

    /**
     * Wait for completion
     */
    async waitForCompletion() {
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                const stats = this.db.getStats();
                const inflight = stats.in_progress || 0;
                const queued = stats.queued || 0;

                // Check if all done
                if (inflight === 0 && queued === 0) {
                    // Also check downloads
                    const pendingDownloads = this.db.prepare(`
            SELECT COUNT(*) as count FROM downloads WHERE state IN ('queued', 'running')
          `).get();

                    if (pendingDownloads.count === 0) {
                        clearInterval(checkInterval);
                        this.stop();
                        resolve();
                    }
                }
            }, 2000);
        });
    }

    /**
     * Submitter: Submit prompts via UI automation
     */
    startSubmitter() {
        this.submitterInterval = setInterval(async () => {
            if (!this.running) return;

            try {
                // Check inflight count first (VEO limit: 5)
                const stats = this.db.getStats();
                const inflight = stats.in_progress || 0;

                if (inflight >= 5) {
                    this.logger?.info(`[Submitter] Waiting... (${inflight}/5 in progress)`);
                    return;
                }

                const prompt = this.db.getNextQueuedPrompt();

                if (!prompt) {
                    // No more queued prompts
                    return;
                }

                this.logger?.info(`[Submitter] Submitting prompt ${prompt.idx}: ${prompt.tail_slug} (${inflight}/5 in progress)`);

                // Store current prompt for CDP callback
                this.currentSubmittingPrompt = prompt;

                try {
                    // Submit via UI
                    await this.submitPromptViaUI(prompt.prompt_text);
                    this.logger?.info(`[Submitter] Prompt ${prompt.idx} submitted successfully`);
                } catch (submitError) {
                    this.logger?.error(`[Submitter] Failed to submit prompt ${prompt.idx}: ${submitError.message}`);
                    throw submitError;
                }

            } catch (error) {
                this.logger?.error(`[Submitter] Error: ${error.message}`);

                // Mark prompt as failed if submission fails
                if (this.currentSubmittingPrompt) {
                    this.db.markPromptFailed(this.currentSubmittingPrompt.id, error.message);
                    this.currentSubmittingPrompt = null;
                }
            }
        }, this.SUBMIT_INTERVAL_MS);
    }

    /**
     * Submit prompt via UI automation
     */
    async submitPromptViaUI(promptText) {
        try {
            // Find textarea using multiple strategies
            let textarea;
            try {
                textarea = await this.driver.findElement(By.css('textarea'));
            } catch (e) {
                // Try alternative selectors
                textarea = await this.driver.findElement(By.css('textarea[placeholder*="prompt" i], textarea[aria-label*="prompt" i]'));
            }

            // Clear and input prompt using JavaScript (more reliable)
            await this.driver.executeScript(`
        const textarea = arguments[0];
        const prompt = arguments[1];
        
        // Focus first
        textarea.focus();
        
        // Clear
        textarea.value = '';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        
        // Set new value
        textarea.value = prompt;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Keep focus
        textarea.focus();
      `, textarea, promptText);

            this.logger?.info(`Prompt entered: ${promptText.slice(0, 50)}...`);

            // Verify prompt was entered
            const currentValue = await this.driver.executeScript(`
        return document.querySelector('textarea').value;
      `);

            if (!currentValue || currentValue.trim() !== promptText.trim()) {
                this.logger?.warn(`Prompt verification failed. Expected: ${promptText.length} chars, Got: ${currentValue?.length || 0} chars`);
                // Try again
                await this.driver.executeScript(`
          const textarea = document.querySelector('textarea');
          textarea.value = arguments[0];
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        `, promptText);
            }

            // Wait longer for UI to process and enable button
            await this.driver.sleep(2000);

            // Find and click Generate button using multiple strategies
            const clicked = await this.driver.executeScript(`
        // Strategy 1: Find by text content
        const buttons = Array.from(document.querySelectorAll('button'));
        
        for (const button of buttons) {
          const text = button.textContent || button.innerText || '';
          const ariaLabel = button.getAttribute('aria-label') || '';
          
          // Check if this is the generate button
          if (text.match(/tạo|generate|create/i) || ariaLabel.match(/tạo|generate|create/i)) {
            // Check if enabled
            if (!button.disabled && !button.hasAttribute('disabled')) {
              console.log('Found generate button:', text || ariaLabel);
              button.click();
              return true;
            }
          }
        }
        
        // Strategy 2: Find by common patterns
        const generateBtn = document.querySelector('button[aria-label*="Generate" i], button[aria-label*="Create" i]');
        if (generateBtn && !generateBtn.disabled) {
          generateBtn.click();
          return true;
        }
        
        return false;
      `);

            if (!clicked) {
                // Fallback: try Selenium click
                const buttons = await this.driver.findElements(By.css("button"));
                let found = false;

                for (const button of buttons) {
                    try {
                        const text = await button.getText();
                        const isEnabled = await button.isEnabled();

                        if (isEnabled && (text.match(/tạo|generate|create/i))) {
                            await this.driver.executeScript("arguments[0].click();", button);
                            this.logger?.info(`Generate button clicked (fallback)`);
                            found = true;
                            break;
                        }
                    } catch (e) {
                        continue;
                    }
                }

                if (!found) {
                    throw new Error('Generate button not found or disabled');
                }
            } else {
                this.logger?.info(`Generate button clicked`);
            }

            // Wait for request to be sent
            await this.driver.sleep(2000);

        } catch (error) {
            throw new Error(`Failed to submit via UI: ${error.message}`);
        }
    }

    /**
     * Downloader: Download videos from fifeUrl
     */
    startDownloaders() {
        for (let i = 0; i < this.DOWNLOAD_CONCURRENCY; i++) {
            this.startDownloaderWorker(i);
        }
    }

    /**
     * Single downloader worker
     */
    async startDownloaderWorker(workerId) {
        const https = require('https');
        const http = require('http');

        while (this.running) {
            try {
                const download = this.db.getNextQueuedDownload();

                if (!download) {
                    // No downloads queued, wait a bit
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                }

                this.logger?.info(`[Downloader-${workerId}] Starting download for prompt ${download.prompt_idx}, take ${download.take_index}`);

                // Mark as running
                this.db.markDownloadRunning(download.id);

                // Generate filename
                const filename = this.generateFilename(
                    download.prompt_idx,
                    download.tail_slug,
                    download.model,
                    download.take_index,
                    download.duration_sec
                );

                const filePath = path.join(this.OUTPUT_DIR, filename);

                try {
                    // Download with retry
                    await this.downloadWithRetry(download.fife_url, filePath);

                    // Mark as done
                    this.db.markDownloadDone(download.id, download.operation_id, filePath);
                    this.logger?.info(`[Downloader-${workerId}] Downloaded: ${filename}`);
                } catch (error) {
                    this.logger?.error(`[Downloader-${workerId}] Download failed: ${error.message}`);

                    // Mark as failed and retry if possible
                    this.db.markDownloadFailed(download.id, error.message);

                    if (!this.db.retryDownload(download.id)) {
                        this.logger?.error(`[Downloader-${workerId}] Max retries reached for download ${download.id}`);
                    }
                }
            } catch (error) {
                this.logger?.error(`[Downloader-${workerId}] Worker error: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    /**
     * Download with retry logic
     */
    async downloadWithRetry(url, filePath, maxRetries = 3) {
        const https = require('https');
        const http = require('http');

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await new Promise((resolve, reject) => {
                    const urlObj = new URL(url);
                    const client = urlObj.protocol === 'https:' ? https : http;

                    const req = client.get(url, (res) => {
                        if (res.statusCode === 200) {
                            const tmpPath = `${filePath}.tmp`;
                            const fileStream = fs.createWriteStream(tmpPath);

                            res.pipe(fileStream);

                            fileStream.on('finish', () => {
                                fileStream.close();
                                fs.renameSync(tmpPath, filePath);
                                resolve();
                            });

                            fileStream.on('error', reject);
                        } else if (res.statusCode === 302 || res.statusCode === 301) {
                            // Follow redirect
                            const redirectUrl = res.headers.location;
                            this.downloadWithRetry(redirectUrl, filePath, maxRetries).then(resolve).catch(reject);
                        } else {
                            reject(new Error(`HTTP ${res.statusCode}`));
                        }
                    });

                    req.on('error', reject);
                    req.setTimeout(60000, () => {
                        req.destroy();
                        reject(new Error('Timeout'));
                    });
                });

                return; // Success
            } catch (error) {
                if (attempt < maxRetries) {
                    const delay = Math.pow(2, attempt - 1) * 1000;
                    this.logger?.warn(`Download attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    throw error;
                }
            }
        }
    }

    /**
     * Generate filename according to spec
     */
    generateFilename(promptIdx, tailSlug, model, takeIndex, durationSec) {
        const date = new Date().toISOString().slice(0, 10);
        const pIdx3 = String(promptIdx).padStart(3, '0');
        const takeIdx2 = String(takeIndex).padStart(2, '0');
        const modelShort = this.extractModelShort(model);
        const dur = durationSec || 8;

        return `${date}_${pIdx3}_${tailSlug}_${modelShort}_${takeIdx2}_${dur}s.mp4`;
    }

    /**
     * Extract short model name
     */
    extractModelShort(model) {
        if (!model) return 'veo3';

        if (model.includes('veo_3_1')) {
            if (model.includes('fast')) {
                return 'veo3.1-fast';
            }
            return 'veo3.1';
        }

        return 'veo3';
    }

    /**
     * Get current statistics
     */
    getStats() {
        return this.db.getStats();
    }

    /**
     * Export manifest
     */
    exportManifest(outputPath = 'dist/manifest.json') {
        const manifest = this.db.getManifest();
        fs.ensureDirSync(path.dirname(outputPath));
        fs.writeJsonSync(outputPath, manifest, { spaces: 2 });
        this.logger?.info(`Manifest exported to: ${outputPath}`);
        return manifest;
    }
}

module.exports = CDPOrchestrator;
