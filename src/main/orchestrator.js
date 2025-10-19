const path = require("path");
const fs = require("fs-extra");

class VeoOrchestrator {
  constructor(db, apiClient, logger, settings = {}) {
    this.db = db;
    this.apiClient = apiClient;
    this.logger = logger;
    this.settings = settings;

    // State
    this.running = false;
    this.feederInterval = null;
    this.pollerInterval = null;
    this.downloaderWorkers = [];

    // Configuration
    this.FEEDER_INTERVAL_MS = 400; // 300-500ms
    this.POLLER_INTERVAL_MS = 2000; // 1.5-2.5s base
    this.POLLER_JITTER_MS = 250;
    this.DOWNLOAD_CONCURRENCY = settings.downloadConcurrency || 5;
    this.OUTPUT_DIR = settings.outputDir || "dist/videos";

    // Ensure output directory exists
    fs.ensureDirSync(this.OUTPUT_DIR);
  }

  /**
   * Start orchestration
   */
  start() {
    if (this.running) {
      this.logger?.warn("Orchestrator already running");
      return;
    }

    this.running = true;
    this.logger?.info("Starting orchestrator...");

    // Start feeder
    this.startFeeder();

    // Start poller
    this.startPoller();

    // Start downloader workers
    this.startDownloaders();
  }

  /**
   * Stop orchestration
   */
  stop() {
    this.running = false;
    this.logger?.info("Stopping orchestrator...");

    if (this.feederInterval) {
      clearInterval(this.feederInterval);
      this.feederInterval = null;
    }

    if (this.pollerInterval) {
      clearInterval(this.pollerInterval);
      this.pollerInterval = null;
    }

    // Downloader workers will stop on next iteration
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
          const pendingDownloads = this.db.db
            .prepare(
              `
            SELECT COUNT(*) as count FROM downloads WHERE state IN ('queued', 'running')
          `,
            )
            .get();

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
   * Feeder: Submit prompts when inflight < 5
   */
  startFeeder() {
    this.feederInterval = setInterval(async () => {
      if (!this.running) return;

      try {
        const prompt = this.db.getNextQueuedPrompt();

        if (!prompt) {
          // No more queued prompts
          return;
        }

        this.logger?.info(
          `[Feeder] Submitting prompt ${prompt.idx}: ${prompt.tail_slug}`,
        );

        try {
          const response = await this.apiClient.submitPrompt(
            prompt.prompt_text,
            this.settings,
          );

          if (response.operations && response.operations.length > 0) {
            // Success: mark in_progress and insert operations
            this.db.markPromptInProgress(prompt.id, response.operations);
            this.logger?.info(
              `[Feeder] Prompt ${prompt.idx} submitted successfully with ${response.operations.length} operations`,
            );
          } else {
            // No operations returned
            this.db.markPromptFailed(
              prompt.id,
              "No operations returned from API",
            );
            this.logger?.error(
              `[Feeder] Prompt ${prompt.idx} failed: no operations`,
            );
          }
        } catch (error) {
          // API error
          this.db.markPromptFailed(prompt.id, error.message);
          this.logger?.error(
            `[Feeder] Prompt ${prompt.idx} failed: ${error.message}`,
          );
        }
      } catch (error) {
        this.logger?.error(`[Feeder] Error: ${error.message}`);
      }
    }, this.FEEDER_INTERVAL_MS);
  }

  /**
   * Poller: Check status of in-progress prompts
   */
  startPoller() {
    const poll = async () => {
      if (!this.running) return;

      try {
        const prompts = this.db.getInProgressPrompts();

        if (prompts.length === 0) {
          // No prompts to poll
          return;
        }

        this.logger?.info(
          `[Poller] Polling ${prompts.length} in-progress prompts`,
        );

        // Poll each prompt
        for (const prompt of prompts) {
          try {
            const response = await this.apiClient.pollStatus(prompt.operations);

            if (response.operations && response.operations.length > 0) {
              // Update operations
              this.db.updateOperations(prompt.id, response.operations);

              // Check if prompt is complete
              const newStatus = this.db.checkAndUpdatePromptStatus(prompt.id);

              if (newStatus === "done") {
                this.logger?.info(
                  `[Poller] Prompt ${prompt.idx} completed successfully`,
                );
              } else if (newStatus === "failed") {
                this.logger?.warn(`[Poller] Prompt ${prompt.idx} failed`);
              } else if (newStatus === "timeout") {
                this.logger?.warn(`[Poller] Prompt ${prompt.idx} timed out`);
              }
            }
          } catch (error) {
            this.logger?.error(
              `[Poller] Error polling prompt ${prompt.idx}: ${error.message}`,
            );
          }
        }
      } catch (error) {
        this.logger?.error(`[Poller] Error: ${error.message}`);
      }

      // Schedule next poll with jitter
      if (this.running) {
        const jitter =
          Math.random() * this.POLLER_JITTER_MS * 2 - this.POLLER_JITTER_MS;
        const nextInterval = this.POLLER_INTERVAL_MS + jitter;
        setTimeout(poll, nextInterval);
      }
    };

    // Start first poll
    setTimeout(poll, this.POLLER_INTERVAL_MS);
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
    while (this.running) {
      try {
        const download = this.db.getNextQueuedDownload();

        if (!download) {
          // No downloads queued, wait a bit
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }

        this.logger?.info(
          `[Downloader-${workerId}] Starting download for prompt ${download.prompt_idx}, take ${download.take_index}`,
        );

        // Mark as running
        this.db.markDownloadRunning(download.id);

        // Generate filename
        const filename = this.generateFilename(
          download.prompt_idx,
          download.tail_slug,
          download.model,
          download.take_index,
          download.duration_sec,
        );

        const filePath = path.join(this.OUTPUT_DIR, filename);

        try {
          // Download with retry
          await this.downloadWithRetry(download, filePath);

          // Mark as done
          this.db.markDownloadDone(
            download.id,
            download.operation_id,
            filePath,
          );
          this.logger?.info(`[Downloader-${workerId}] Downloaded: ${filename}`);
        } catch (error) {
          this.logger?.error(
            `[Downloader-${workerId}] Download failed: ${error.message}`,
          );

          // Check if URL expired
          if (
            error.message.includes("expired") ||
            error.message.includes("403")
          ) {
            this.logger?.info(
              `[Downloader-${workerId}] URL expired, will re-poll`,
            );
            // TODO: Implement re-poll logic
          }

          // Mark as failed and retry if possible
          this.db.markDownloadFailed(download.id, error.message);

          if (!this.db.retryDownload(download.id)) {
            this.logger?.error(
              `[Downloader-${workerId}] Max retries reached for download ${download.id}`,
            );
          }
        }
      } catch (error) {
        this.logger?.error(
          `[Downloader-${workerId}] Worker error: ${error.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Download with retry logic
   */
  async downloadWithRetry(download, filePath, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.apiClient.downloadVideo(download.fife_url, filePath);
        return; // Success
      } catch (error) {
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
          this.logger?.warn(
            `Download attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          throw error; // Max retries reached
        }
      }
    }
  }

  /**
   * Generate filename according to spec
   * Format: YYYY-MM-DD_{pIdx3}_{tailSlug}_{modelShort}_{takeIdx2}_{dur}s.mp4
   */
  generateFilename(promptIdx, tailSlug, model, takeIndex, durationSec) {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const pIdx3 = String(promptIdx).padStart(3, "0");
    const takeIdx2 = String(takeIndex).padStart(2, "0");
    const modelShort = this.extractModelShort(model);
    const dur = durationSec || 8;

    return `${date}_${pIdx3}_${tailSlug}_${modelShort}_${takeIdx2}_${dur}s.mp4`;
  }

  /**
   * Extract short model name
   */
  extractModelShort(model) {
    if (!model) return "veo3";

    // veo_3_1_t2v_fast_ultra → veo3.1-fast
    if (model.includes("veo_3_1")) {
      if (model.includes("fast")) {
        return "veo3.1-fast";
      }
      return "veo3.1";
    }

    return "veo3";
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
  exportManifest(outputPath = "dist/manifest.json") {
    const manifest = this.db.getManifest();
    fs.ensureDirSync(path.dirname(outputPath));
    fs.writeJsonSync(outputPath, manifest, { spaces: 2 });
    this.logger?.info(`Manifest exported to: ${outputPath}`);
    return manifest;
  }
}

module.exports = VeoOrchestrator;
