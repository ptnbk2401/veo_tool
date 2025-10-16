const fs = require("fs-extra");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const CSVProcessor = require("./csv-processor");

class BatchProcessor {
  constructor() {
    this.csvProcessor = new CSVProcessor();
    this.jobsFile = path.join(process.cwd(), "config", "jobs.json");
    this.activeJobs = new Map();
    this.jobHistory = new Map();
    this.init();
  }

  async init() {
    await this.csvProcessor.init();
    await fs.ensureDir(path.dirname(this.jobsFile));
    await this.loadJobs();
  }

  async loadJobs() {
    try {
      if (await fs.pathExists(this.jobsFile)) {
        const data = await fs.readJson(this.jobsFile);

        // Load active jobs
        if (data.activeJobs) {
          this.activeJobs = new Map(Object.entries(data.activeJobs));
        }

        // Load job history
        if (data.jobHistory) {
          this.jobHistory = new Map(Object.entries(data.jobHistory));
        }
      }
    } catch (error) {
      console.error("Failed to load jobs:", error);
      this.activeJobs = new Map();
      this.jobHistory = new Map();
    }
  }

  async saveJobs() {
    try {
      const data = {
        activeJobs: Object.fromEntries(this.activeJobs),
        jobHistory: Object.fromEntries(this.jobHistory),
        lastUpdated: new Date().toISOString(),
      };

      await fs.writeJson(this.jobsFile, data, { spaces: 2 });
    } catch (error) {
      console.error("Failed to save jobs:", error);
    }
  }

  async createJob(jobConfig) {
    const { csvPath, profileId, config, name } = jobConfig;

    // Validate inputs
    if (!csvPath || !profileId) {
      throw new Error("CSV path and profile ID are required");
    }

    if (!(await fs.pathExists(csvPath))) {
      throw new Error(`CSV file does not exist: ${csvPath}`);
    }

    // Load and validate CSV data
    const csvResult = await this.csvProcessor.loadCSV(csvPath);

    const jobId = uuidv4();
    const job = {
      id: jobId,
      name: name || `Job ${new Date().toLocaleString()}`,
      csvPath,
      profileId,
      config: {
        pollInterval: 5000,
        timeout: 600000,
        parallel: 1,
        outputFolder: "./output",
        retryAttempts: 3,
        ...config,
      },
      status: "created",
      data: csvResult.data,
      progress: {
        total: csvResult.data.length,
        completed: 0,
        failed: 0,
        current: null,
        percentage: 0,
      },
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      pausedAt: null,
      error: null,
    };

    this.activeJobs.set(jobId, job);
    await this.saveJobs();

    return job;
  }

  async startJob(jobId) {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      throw new Error("Job not found");
    }

    if (job.status !== "created" && job.status !== "paused") {
      throw new Error(`Cannot start job with status: ${job.status}`);
    }

    job.status = "running";
    job.startedAt = new Date().toISOString();
    job.pausedAt = null;

    // Update progress based on current data state
    this.updateJobProgress(job);

    this.activeJobs.set(jobId, job);
    await this.saveJobs();

    return job;
  }

  async pauseJob(jobId) {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      throw new Error("Job not found");
    }

    if (job.status !== "running") {
      throw new Error(`Cannot pause job with status: ${job.status}`);
    }

    job.status = "paused";
    job.pausedAt = new Date().toISOString();

    this.activeJobs.set(jobId, job);
    await this.saveJobs();

    return job;
  }

  async resumeJob(jobId) {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      throw new Error("Job not found");
    }

    if (job.status !== "paused") {
      throw new Error(`Cannot resume job with status: ${job.status}`);
    }

    return await this.startJob(jobId);
  }

  async stopJob(jobId) {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      throw new Error("Job not found");
    }

    job.status = "stopped";
    job.completedAt = new Date().toISOString();

    // Move to history
    this.jobHistory.set(jobId, { ...job });
    this.activeJobs.delete(jobId);

    await this.saveJobs();

    return job;
  }

  async completeJob(jobId) {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      throw new Error("Job not found");
    }

    job.status = "completed";
    job.completedAt = new Date().toISOString();

    // Final progress update
    this.updateJobProgress(job);

    // Save final CSV state
    await this.csvProcessor.saveCSV(job.csvPath, job.data);

    // Move to history
    this.jobHistory.set(jobId, { ...job });
    this.activeJobs.delete(jobId);

    await this.saveJobs();

    return job;
  }

  async updateJobItemStatus(jobId, itemId, status, result = {}) {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      throw new Error("Job not found");
    }

    // Update the item in job data
    const updatedRow = await this.csvProcessor.updateRowStatus(
      job.data,
      itemId,
      status,
      result
    );

    // Update job progress
    this.updateJobProgress(job);

    // Set current item if rendering
    if (status === "rendering") {
      job.progress.current = updatedRow;
    } else if (job.progress.current && job.progress.current.ID === itemId) {
      job.progress.current = null;
    }

    this.activeJobs.set(jobId, job);

    // Save periodically (not on every update to avoid performance issues)
    if (status === "done" || status === "error") {
      await this.saveJobs();

      // Also save CSV with current progress
      await this.csvProcessor.saveCSV(job.csvPath, job.data, {
        skipBackup: true,
      });
    }

    return updatedRow;
  }

  updateJobProgress(job) {
    const stats = this.csvProcessor.getProcessingStats(job.data);

    job.progress = {
      total: stats.total,
      completed: stats.done,
      failed: stats.error,
      rendering: stats.rendering,
      pending: stats.pending,
      percentage: stats.progress,
      current: job.progress.current,
    };

    // Check if job is complete
    if (
      stats.pending === 0 &&
      stats.rendering === 0 &&
      job.status === "running"
    ) {
      job.status = "ready_to_complete";
    }
  }

  getJob(jobId) {
    return this.activeJobs.get(jobId) || this.jobHistory.get(jobId);
  }

  listActiveJobs() {
    return Array.from(this.activeJobs.values());
  }

  listJobHistory(limit = 50) {
    const history = Array.from(this.jobHistory.values());
    return history
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
      .slice(0, limit);
  }

  getNextPendingItem(jobId) {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      return null;
    }

    return this.csvProcessor.getNextPendingRow(job.data);
  }

  getRenderingItems(jobId) {
    const job = this.activeJobs.get(jobId);
    if (!job) {
      return [];
    }

    return this.csvProcessor.getRenderingRows(job.data);
  }

  async recoverInterruptedJobs() {
    const recoveredJobs = [];

    for (const [jobId, job] of this.activeJobs) {
      if (job.status === "running") {
        // Reset any items that were marked as 'rendering' back to 'pending'
        // since they were likely interrupted
        let hasRecoveredItems = false;

        job.data.forEach((row) => {
          if (row.Status === "rendering") {
            row.Status = "pending";
            row.EndTime = null;
            hasRecoveredItems = true;
          }
        });

        if (hasRecoveredItems) {
          job.status = "paused";
          job.pausedAt = new Date().toISOString();
          this.updateJobProgress(job);
          recoveredJobs.push(job);
        }
      }
    }

    if (recoveredJobs.length > 0) {
      await this.saveJobs();
      console.log(`Recovered ${recoveredJobs.length} interrupted jobs`);
    }

    return recoveredJobs;
  }

  async cleanupOldJobs(daysToKeep = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    let cleanedCount = 0;

    for (const [jobId, job] of this.jobHistory) {
      const completedDate = new Date(job.completedAt);
      if (completedDate < cutoffDate) {
        this.jobHistory.delete(jobId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      await this.saveJobs();
      console.log(`Cleaned up ${cleanedCount} old jobs`);
    }

    return cleanedCount;
  }

  getJobStatistics() {
    const activeJobs = this.listActiveJobs();
    const historyJobs = this.listJobHistory();

    const stats = {
      active: {
        total: activeJobs.length,
        running: activeJobs.filter((j) => j.status === "running").length,
        paused: activeJobs.filter((j) => j.status === "paused").length,
        created: activeJobs.filter((j) => j.status === "created").length,
      },
      history: {
        total: historyJobs.length,
        completed: historyJobs.filter((j) => j.status === "completed").length,
        stopped: historyJobs.filter((j) => j.status === "stopped").length,
      },
      totalItemsProcessed: historyJobs.reduce(
        (sum, job) => sum + (job.progress.completed || 0),
        0
      ),
      totalItemsFailed: historyJobs.reduce(
        (sum, job) => sum + (job.progress.failed || 0),
        0
      ),
    };

    return stats;
  }
}

module.exports = BatchProcessor;
