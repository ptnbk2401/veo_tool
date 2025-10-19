const path = require('path');
const fs = require('fs-extra');
const { By } = require('selenium-webdriver');

/**
 * Sequential Orchestrator - Implements VEO_Sequential_API_Flow.md
 * Submit → Poll → Download with max 5 in-progress
 */
class SequentialOrchestrator {
  constructor(driver, cdpInterceptor, db, logger, settings = {}) {
    this.driver = driver;
    this.cdp = cdpInterceptor;
    this.db = db;
    this.logger = logger;
    this.settings = settings;

    // State
    this.running = false;
    this.submitterInterval = null;
    this.pollerIntervals = new Map(); // Per-prompt pollers
    this.downloaderWorkers = [];
    this.currentSubmittingPrompt = null;

    // Configuration
    this.MAX_IN_PROGRESS = 5;
    this.SUBMIT_HEARTBEAT_MS = 400; // 300-500ms
    this.POLL_INTERVAL_MS = 2000; // 1.5-2.5s base
    this.POLL_JITTER_MS = 250;
    this.DOWNLOAD_CONCURRENCY = settings.downloadConcurrency || 5;
    this.T_TIMEOUT_PROMPT = 210000; // 180-240s, use 210s
    this.OUTPUT_DIR = settings.outputDir || 'dist/videos';

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
        this.logger?.warn('[CDP] Submit response has no operations');
        if (this.currentSubmittingPrompt) {
          this.db.markPromptFailed(this.currentSubmittingPrompt.id, 'No operations returned');
          this.currentSubmittingPrompt = null;
        }
        return;
      }

      // Try to find prompt by currentSubmittingPrompt first
      let prompt = this.currentSubmittingPrompt;

      // If not found, try to find by checking if operations already exist (duplicate response)
      if (!prompt) {
        const opName = data.operations[0]?.operation?.name;
        if (opName) {
          const existingOp = this.db.prepare(`
            SELECT prompt_id FROM operations WHERE op_name = ?
          `).get(opName);

          if (existingOp) {
            this.logger?.warn(`[CDP] Duplicate submit response for operation ${opName}, ignoring`);
            return;
          }
        }

        // Try to find a submitting prompt without operations
        const submittingPrompt = this.db.prepare(`
          SELECT p.* FROM prompts p
          LEFT JOIN operations o ON o.prompt_id = p.id
          WHERE p.status = 'submitting'
          AND o.id IS NULL
          ORDER BY p.idx
          LIMIT 1
        `).get();

        if (submittingPrompt) {
          prompt = submittingPrompt;
          this.logger?.info(`[CDP] Matched submit response to prompt ${prompt.idx} by status`);
        } else {
          this.logger?.warn('[CDP] No matching prompt found for submit response');
          return;
        }
      }

      // Check if this prompt already has operations (prevent duplicate)
      const existingOps = this.db.prepare(`
        SELECT COUNT(*) as count FROM operations WHERE prompt_id = ?
      `).get(prompt.id);

      if (existingOps.count > 0) {
        this.logger?.warn(`[CDP] Prompt ${prompt.idx} already has operations, ignoring duplicate submit response`);
        this.currentSubmittingPrompt = null;
        return;
      }

      // Mark prompt as in_progress and insert operations
      this.db.markPromptInProgress(prompt.id, data.operations);
      this.logger?.info(`✅ [CDP] Prompt ${prompt.idx} submitted with ${data.operations.length} operations`);

      // Start polling for this prompt
      this.startPromptPoller(prompt.id);

      this.currentSubmittingPrompt = null;
    } catch (error) {
      this.logger?.error(`[CDP] Error handling submit response: ${error.message}`);
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
        return;
      }

      // Update operations
      this.db.updateOperations(operation.prompt_id, data.operations);

      // Check if prompt is complete
      const newStatus = this.db.checkAndUpdatePromptStatus(operation.prompt_id);

      if (newStatus === 'done') {
        const prompt = this.db.prepare('SELECT idx FROM prompts WHERE id = ?').get(operation.prompt_id);
        this.logger?.info(`✅ [CDP] Prompt ${prompt?.idx} completed`);

        // Stop polling for this prompt
        this.stopPromptPoller(operation.prompt_id);
      } else if (newStatus === 'failed') {
        const prompt = this.db.prepare('SELECT idx FROM prompts WHERE id = ?').get(operation.prompt_id);
        this.logger?.warn(`❌ [CDP] Prompt ${prompt?.idx} failed`);

        // Stop polling for this prompt
        this.stopPromptPoller(operation.prompt_id);
      } else if (newStatus === 'timeout') {
        const prompt = this.db.prepare('SELECT idx FROM prompts WHERE id = ?').get(operation.prompt_id);
        this.logger?.warn(`⏱️ [CDP] Prompt ${prompt?.idx} timed out`);

        // Stop polling for this prompt
        this.stopPromptPoller(operation.prompt_id);
      }
    } catch (error) {
      this.logger?.error(`[CDP] Error handling poll response: ${error.message}`);
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
    this.logger?.info('Starting sequential orchestrator...');

    // Log initial stats
    const initialStats = this.db.getStats();
    this.logger?.info(`Initial stats: ${JSON.stringify(initialStats)}`);

    // Auto-recover stuck prompts with operations
    this.recoverStuckPrompts();

    // Start browser health check
    this.startBrowserHealthCheck();

    // Start submitter
    this.startSubmitter();

    // Start downloader workers
    this.startDownloaders();

    this.logger?.info(`Submitter interval: ${this.SUBMIT_HEARTBEAT_MS}ms`);
  }

  /**
   * Stop orchestration
   */
  stop() {
    this.running = false;
    this.logger?.info('Stopping sequential orchestrator...');

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.submitterInterval) {
      clearInterval(this.submitterInterval);
      this.submitterInterval = null;
    }

    // Stop all pollers
    for (const [promptId, interval] of this.pollerIntervals.entries()) {
      clearInterval(interval);
    }
    this.pollerIntervals.clear();
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

        // Also count submitting prompts
        const submitting = this.db.prepare(`
          SELECT COUNT(*) as count FROM prompts WHERE status = 'submitting'
        `).get();
        const submittingCount = submitting.count || 0;

        // Check if all done (including submitting prompts)
        if (inflight === 0 && queued === 0 && submittingCount === 0) {
          // Also check downloads
          const pendingDownloads = this.db.prepare(`
            SELECT COUNT(*) as count FROM downloads WHERE state IN ('queued', 'running')
          `).get();

          if (pendingDownloads.count === 0) {
            this.logger?.info(`[Completion] All prompts processed. Stopping...`);
            clearInterval(checkInterval);
            this.stop();
            resolve();
          }
        } else {
          this.logger?.info(`[Completion] Waiting: queued=${queued}, submitting=${submittingCount}, inflight=${inflight}`);
        }
      }, 2000);
    });
  }

  /**
   * Recover stuck prompts that have operations but wrong status
   */
  recoverStuckPrompts() {
    try {
      // Find prompts stuck in 'submitting' that have operations
      const stuckPrompts = this.db.prepare(`
        SELECT DISTINCT p.id, p.idx
        FROM prompts p
        JOIN operations o ON o.prompt_id = p.id
        WHERE p.status = 'submitting'
      `).all();

      if (stuckPrompts.length > 0) {
        this.logger?.warn(`[Recovery] Found ${stuckPrompts.length} stuck prompts with operations`);

        for (const prompt of stuckPrompts) {
          // Update status and check completion
          this.db.prepare(`UPDATE prompts SET status = 'in_progress' WHERE id = ?`).run(prompt.id);
          const newStatus = this.db.checkAndUpdatePromptStatus(prompt.id);
          this.logger?.info(`[Recovery] Prompt ${prompt.idx}: submitting → ${newStatus}`);

          // Start poller if still in progress
          if (newStatus === 'in_progress') {
            this.startPromptPoller(prompt.id);
          }
        }
      }
    } catch (error) {
      this.logger?.error(`[Recovery] Error recovering stuck prompts: ${error.message}`);
    }
  }

  /**
   * Browser health check
   */
  startBrowserHealthCheck() {
    this.healthCheckInterval = setInterval(async () => {
      if (!this.running) return;

      try {
        await this.driver.getTitle();
      } catch (error) {
        this.logger?.error(`[HealthCheck] Browser crashed or closed: ${error.message}`);
        this.running = false;
      }
    }, 5000); // Check every 5s
  }

  /**
   * Submitter: Submit prompts via UI when inflight < 5
   */
  startSubmitter() {
    this.logger?.info('[Submitter] Starting submitter loop...');

    this.submitterInterval = setInterval(async () => {
      if (!this.running) {
        this.logger?.warn('[Submitter] Not running, skipping');
        return;
      }

      try {
        // this.logger?.info('[Submitter] Tick...');
        // Check inflight count (MAX 5)
        let stats;
        try {
          stats = this.db.getStats();
        } catch (statsError) {
          this.logger?.error(`[Submitter] Error getting stats: ${statsError.message}`);
          return;
        }

        const inflight = stats.in_progress || 0;
        const queued = stats.queued || 0;

        // this.logger?.info(`[Submitter] Check: queued=${queued}, inflight=${inflight}/${this.MAX_IN_PROGRESS}`);

        if (inflight >= this.MAX_IN_PROGRESS) {
          // Wait for slot to free up
          this.logger?.info(`[Submitter] Waiting for slot (${inflight}/${this.MAX_IN_PROGRESS})`);
          return;
        }

        if (queued === 0) {
          this.logger?.info(`[Submitter] No queued prompts`);
          return;
        }

        // Peek next prompt without marking
        let prompt;
        try {
          prompt = this.db.peekNextQueuedPrompt();
        } catch (promptError) {
          this.logger?.error(`[Submitter] Error peeking next prompt: ${promptError.message}`);
          this.logger?.error(promptError.stack);
          return;
        }

        if (!prompt) {
          this.logger?.warn(`[Submitter] No prompt available despite queued=${queued}`);
          return;
        }

        // Check if already submitting
        if (this.currentSubmittingPrompt) {
          // this.logger?.info(`[Submitter] Already submitting prompt ${this.currentSubmittingPrompt.idx}, waiting...`);
          return;
        }

        // IMPORTANT: Check if this prompt already has operations (prevent duplicate submission)
        const existingOps = this.db.prepare(`
          SELECT COUNT(*) as count FROM operations WHERE prompt_id = ?
        `).get(prompt.id);

        if (existingOps.count > 0) {
          this.logger?.warn(`[Submitter] Prompt ${prompt.idx} already has operations, skipping and resetting to done`);
          // This prompt was already submitted, mark it properly
          const newStatus = this.db.checkAndUpdatePromptStatus(prompt.id);
          if (!newStatus || newStatus === 'in_progress') {
            // Force update to in_progress if not already
            this.db.prepare(`UPDATE prompts SET status = 'in_progress' WHERE id = ?`).run(prompt.id);
          }
          return;
        }

        this.logger?.info(`[Submitter] Got prompt ${prompt.idx}: ${prompt.prompt_text.slice(0, 50)}...`);
        this.logger?.info(`[Submitter] Submitting prompt ${prompt.idx} (${inflight}/${this.MAX_IN_PROGRESS} in progress)`);

        // Mark as submitting NOW (not before)
        this.db.markPromptSubmitting(prompt.id);

        // Store current prompt for CDP callback
        this.currentSubmittingPrompt = prompt;

        try {
          // Submit via UI
          await this.submitPromptViaUI(prompt.prompt_text);
          this.logger?.info(`[Submitter] Prompt ${prompt.idx} UI submission completed, waiting for CDP response...`);

          // Wait for CDP to intercept response (timeout after 10s)
          const startWait = Date.now();
          const promptId = prompt.id;
          while (this.currentSubmittingPrompt && this.currentSubmittingPrompt.id === promptId && Date.now() - startWait < 10000) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }

          // Check if this prompt was processed by CDP
          if (this.currentSubmittingPrompt && this.currentSubmittingPrompt.id === promptId) {
            this.logger?.warn(`[Submitter] No CDP response for prompt ${prompt.idx} after 10s, resetting to queued for retry`);
            this.db.resetPromptToQueued(prompt.id);
            this.currentSubmittingPrompt = null;
          } else {
            this.logger?.info(`[Submitter] Prompt ${prompt.idx} processed by CDP successfully`);
          }
        } catch (submitError) {
          this.logger?.error(`[Submitter] Failed to submit prompt ${prompt.idx}: ${submitError.message}`);

          // Check if browser crashed
          if (submitError.message && submitError.message.includes('invalid session')) {
            this.logger?.error(`[Submitter] Browser session lost! Stopping automation.`);
            this.running = false;
            return;
          }

          this.db.markPromptFailed(prompt.id, submitError.message);
          this.currentSubmittingPrompt = null;
        }

      } catch (error) {
        this.logger?.error(`[Submitter] Error: ${error.message}`);
        if (error.stack) {
          this.logger?.error(error.stack);
        }

        // Check if browser crashed
        if (error.message && error.message.includes('invalid session')) {
          this.logger?.error(`[Submitter] Browser session lost! Stopping automation.`);
          this.running = false;
        }
      }
    }, this.SUBMIT_HEARTBEAT_MS);
  }

  /**
   * Submit prompt via UI automation
   */
  async submitPromptViaUI(promptText) {
    try {
      // Check if browser is still alive
      try {
        await this.driver.getTitle();
      } catch (e) {
        throw new Error('Browser session lost (invalid session id)');
      }

      // Wait for page to be ready
      await this.driver.sleep(1000);

      // Find textarea with multiple strategies
      let textarea;
      try {
        textarea = await this.driver.findElement(By.css('textarea'));
      } catch (e) {
        // Try alternative selectors
        try {
          textarea = await this.driver.findElement(By.css('textarea[placeholder*="prompt" i]'));
        } catch (e2) {
          try {
            textarea = await this.driver.findElement(By.css('textarea[aria-label*="prompt" i]'));
          } catch (e3) {
            // Last resort: find any textarea
            const textareas = await this.driver.findElements(By.css('textarea'));
            if (textareas.length > 0) {
              textarea = textareas[0];
            } else {
              throw new Error('No textarea found on page');
            }
          }
        }
      }

      // Clear textarea first
      await textarea.click();
      await this.driver.sleep(200);
      await textarea.clear();
      await this.driver.sleep(200);

      // Input prompt character by character to trigger proper events
      await textarea.sendKeys(promptText);
      await this.driver.sleep(500);

      // Verify input
      const value = await textarea.getAttribute('value');
      if (!value || value.trim() !== promptText.trim()) {
        // Fallback: use JavaScript
        await this.driver.executeScript(`
          const textarea = arguments[0];
          const prompt = arguments[1];
          
          // Clear
          textarea.value = '';
          textarea.focus();
          
          // Set value
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
          nativeInputValueSetter.call(textarea, prompt);
          
          // Trigger events that React/Vue listens to
          const inputEvent = new Event('input', { bubbles: true });
          const changeEvent = new Event('change', { bubbles: true });
          textarea.dispatchEvent(inputEvent);
          textarea.dispatchEvent(changeEvent);
          
          // Also trigger keyboard events
          textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
          textarea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
          
          textarea.focus();
        `, textarea, promptText);
      }

      // Wait longer for UI to enable button
      await this.driver.sleep(2000);

      // Click Generate button
      const clicked = await this.driver.executeScript(`
        const buttons = Array.from(document.querySelectorAll('button'));
        for (const button of buttons) {
          const text = button.textContent || '';
          const ariaLabel = button.getAttribute('aria-label') || '';
          if ((text.match(/tạo|generate|create/i) || ariaLabel.match(/tạo|generate|create/i)) && !button.disabled) {
            button.click();
            return true;
          }
        }
        return false;
      `);

      if (!clicked) {
        throw new Error('Generate button not found or disabled');
      }

      // Wait for request to be sent and intercepted by CDP
      await this.driver.sleep(2000);

    } catch (error) {
      throw new Error(`Failed to submit via UI: ${error.message}`);
    }
  }

  /**
   * Start polling for a specific prompt
   */
  startPromptPoller(promptId) {
    if (this.pollerIntervals.has(promptId)) {
      return; // Already polling
    }

    const poll = async () => {
      try {
        const prompt = this.db.prepare('SELECT * FROM prompts WHERE id = ?').get(promptId);

        if (!prompt || prompt.status !== 'in_progress') {
          this.stopPromptPoller(promptId);
          return;
        }

        // Check timeout
        const elapsed = Date.now() - new Date(prompt.submit_at).getTime();
        if (elapsed > this.T_TIMEOUT_PROMPT) {
          this.db.prepare('UPDATE prompts SET status = ?, done_at = ? WHERE id = ?')
            .run('timeout', new Date().toISOString(), promptId);
          this.logger?.warn(`⏱️ Prompt ${prompt.idx} timed out`);
          this.stopPromptPoller(promptId);
          return;
        }

        // Trigger poll by clicking a poll button or waiting for auto-poll
        // VEO UI auto-polls, so CDP will intercept the response
        // We just need to keep checking the database

      } catch (error) {
        this.logger?.error(`[Poller-${promptId}] Error: ${error.message}`);
      }
    };

    // Start polling with jitter
    const baseInterval = this.POLL_INTERVAL_MS;
    const jitter = Math.random() * this.POLL_JITTER_MS * 2 - this.POLL_JITTER_MS;
    const interval = setInterval(poll, baseInterval + jitter);

    this.pollerIntervals.set(promptId, interval);
    this.logger?.info(`[Poller] Started polling for prompt ${promptId}`);
  }

  /**
   * Stop polling for a specific prompt
   */
  stopPromptPoller(promptId) {
    const interval = this.pollerIntervals.get(promptId);
    if (interval) {
      clearInterval(interval);
      this.pollerIntervals.delete(promptId);
      this.logger?.info(`[Poller] Stopped polling for prompt ${promptId}`);
    }
  }

  /**
   * Downloader: Download videos from fifeUrl
   */
  startDownloaders() {
    this.logger?.info(`[Downloader] Starting ${this.DOWNLOAD_CONCURRENCY} downloader workers...`);
    for (let i = 0; i < this.DOWNLOAD_CONCURRENCY; i++) {
      this.startDownloaderWorker(i);
    }
    this.logger?.info(`[Downloader] All workers started`);
  }

  /**
   * Single downloader worker
   */
  async startDownloaderWorker(workerId) {
    const https = require('https');
    const http = require('http');

    this.logger?.info(`[Downloader-${workerId}] Worker started`);

    while (this.running) {
      try {
        const download = this.db.getNextQueuedDownload();

        if (!download) {
          // this.logger?.info(`[Downloader-${workerId}] No downloads, waiting...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        this.logger?.info(`[Downloader-${workerId}] Downloading prompt ${download.prompt_idx}, take ${download.take_index}`);

        this.db.markDownloadRunning(download.id);

        const filename = this.generateFilename(
          download.prompt_idx,
          download.tail_slug,
          download.model,
          download.take_index,
          download.duration_sec
        );

        const filePath = path.join(this.OUTPUT_DIR, filename);

        try {
          await this.downloadWithRetry(download.fife_url, filePath);
          this.db.markDownloadDone(download.id, download.operation_id, filePath);
          this.logger?.info(`[Downloader-${workerId}] ✅ ${filename}`);
        } catch (error) {
          this.logger?.error(`[Downloader-${workerId}] ❌ ${error.message}`);
          this.db.markDownloadFailed(download.id, error.message);

          if (!this.db.retryDownload(download.id)) {
            this.logger?.error(`[Downloader-${workerId}] Max retries reached`);
          }
        }
      } catch (error) {
        this.logger?.error(`[Downloader-${workerId}] Worker error: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Download with retry
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
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Generate filename
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
   * Get statistics
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

module.exports = SequentialOrchestrator;
