const fs = require("fs-extra");
const path = require("path");
const csv = require("csv-parser");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;

class CSVProcessor {
  constructor() {
    this.requiredColumns = ["ID", "Prompt", "Flow_URL", "Status"];
    this.validStatuses = ["pending", "rendering", "done", "error"];
    this.backupDir = path.join(process.cwd(), "backups");
  }

  async init() {
    // Ensure backup directory exists
    await fs.ensureDir(this.backupDir);
  }

  async loadCSV(filePath) {
    try {
      if (!(await fs.pathExists(filePath))) {
        throw new Error(`CSV file does not exist: ${filePath}`);
      }

      const results = [];

      return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(csv())
          .on("data", (data) => {
            results.push(data);
          })
          .on("end", () => {
            try {
              const validatedData = this.validateCSVData(results);
              resolve({
                success: true,
                data: validatedData,
                totalRows: validatedData.length,
                filePath,
              });
            } catch (error) {
              reject(error);
            }
          })
          .on("error", (error) => {
            reject(new Error(`Failed to read CSV file: ${error.message}`));
          });
      });
    } catch (error) {
      console.error("Error loading CSV:", error);
      throw error;
    }
  }

  validateCSVData(data) {
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("CSV file is empty or invalid");
    }

    // Check if required columns exist in first row
    const firstRow = data[0];
    const missingColumns = this.requiredColumns.filter(
      (col) => !(col in firstRow)
    );

    if (missingColumns.length > 0) {
      throw new Error(`Missing required columns: ${missingColumns.join(", ")}`);
    }

    // Validate and normalize each row
    const validatedData = data.map((row, index) => {
      const rowNumber = index + 1;

      // Validate required fields
      if (!row.ID || !row.Prompt || !row.Flow_URL) {
        throw new Error(
          `Row ${rowNumber}: Missing required data (ID, Prompt, or Flow_URL)`
        );
      }

      // Validate and normalize status
      let status = row.Status ? row.Status.toLowerCase().trim() : "pending";
      if (!this.validStatuses.includes(status)) {
        console.warn(
          `Row ${rowNumber}: Invalid status '${row.Status}', defaulting to 'pending'`
        );
        status = "pending";
      }

      // Validate Flow_URL format
      if (!this.isValidUrl(row.Flow_URL)) {
        throw new Error(
          `Row ${rowNumber}: Invalid Flow_URL format: ${row.Flow_URL}`
        );
      }

      return {
        ID: row.ID.toString().trim(),
        Prompt: row.Prompt.toString().trim(),
        Flow_URL: row.Flow_URL.toString().trim(),
        Status: status,
        // Additional fields for tracking
        StartTime: row.StartTime || null,
        EndTime: row.EndTime || null,
        VideoPath: row.VideoPath || null,
        Error: row.Error || null,
        Attempts: parseInt(row.Attempts) || 0,
      };
    });

    // Check for duplicate IDs
    const ids = validatedData.map((row) => row.ID);
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicateIds.length > 0) {
      throw new Error(`Duplicate IDs found: ${duplicateIds.join(", ")}`);
    }

    return validatedData;
  }

  isValidUrl(string) {
    try {
      const url = new URL(string);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch (_) {
      return false;
    }
  }

  async saveCSV(filePath, data, options = {}) {
    try {
      // Create backup if file exists
      if ((await fs.pathExists(filePath)) && !options.skipBackup) {
        await this.createBackup(filePath);
      }

      // Prepare CSV writer
      const csvWriter = createCsvWriter({
        path: filePath,
        header: [
          { id: "ID", title: "ID" },
          { id: "Prompt", title: "Prompt" },
          { id: "Flow_URL", title: "Flow_URL" },
          { id: "Status", title: "Status" },
          { id: "StartTime", title: "StartTime" },
          { id: "EndTime", title: "EndTime" },
          { id: "VideoPath", title: "VideoPath" },
          { id: "Error", title: "Error" },
          { id: "Attempts", title: "Attempts" },
        ],
      });

      await csvWriter.writeRecords(data);

      return {
        success: true,
        filePath,
        rowCount: data.length,
      };
    } catch (error) {
      console.error("Error saving CSV:", error);
      throw new Error(`Failed to save CSV file: ${error.message}`);
    }
  }

  async createBackup(filePath) {
    try {
      const fileName = path.basename(filePath, path.extname(filePath));
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupFileName = `${fileName}_backup_${timestamp}.csv`;
      const backupPath = path.join(this.backupDir, backupFileName);

      await fs.copy(filePath, backupPath);

      console.log(`Backup created: ${backupPath}`);
      return backupPath;
    } catch (error) {
      console.error("Failed to create backup:", error);
      // Don't throw error for backup failure, just log it
    }
  }

  async updateRowStatus(data, rowId, status, result = {}) {
    const rowIndex = data.findIndex((row) => row.ID === rowId);

    if (rowIndex === -1) {
      throw new Error(`Row with ID '${rowId}' not found`);
    }

    if (!this.validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    const row = data[rowIndex];

    // Update status
    row.Status = status;

    // Update timestamps
    if (status === "rendering" && !row.StartTime) {
      row.StartTime = new Date().toISOString();
    }

    if ((status === "done" || status === "error") && !row.EndTime) {
      row.EndTime = new Date().toISOString();
    }

    // Update result data
    if (result.videoPath) {
      row.VideoPath = result.videoPath;
    }

    if (result.error) {
      row.Error = result.error;
    }

    // Increment attempts
    if (status === "rendering") {
      row.Attempts = (row.Attempts || 0) + 1;
    }

    return row;
  }

  getProcessingStats(data) {
    const stats = {
      total: data.length,
      pending: 0,
      rendering: 0,
      done: 0,
      error: 0,
      progress: 0,
    };

    data.forEach((row) => {
      stats[row.Status]++;
    });

    stats.progress =
      stats.total > 0 ? ((stats.done + stats.error) / stats.total) * 100 : 0;

    return stats;
  }

  getNextPendingRow(data) {
    return data.find((row) => row.Status === "pending");
  }

  getRenderingRows(data) {
    return data.filter((row) => row.Status === "rendering");
  }

  getFailedRows(data) {
    return data.filter((row) => row.Status === "error");
  }

  async cleanupOldBackups(daysToKeep = 7) {
    try {
      const files = await fs.readdir(this.backupDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      for (const file of files) {
        if (file.endsWith(".csv") && file.includes("_backup_")) {
          const filePath = path.join(this.backupDir, file);
          const stats = await fs.stat(filePath);

          if (stats.mtime < cutoffDate) {
            await fs.remove(filePath);
            console.log(`Removed old backup: ${file}`);
          }
        }
      }
    } catch (error) {
      console.error("Error cleaning up old backups:", error);
    }
  }

  exportProcessingReport(data, outputPath) {
    const stats = this.getProcessingStats(data);
    const failedRows = this.getFailedRows(data);

    const report = {
      timestamp: new Date().toISOString(),
      summary: stats,
      failedItems: failedRows.map((row) => ({
        ID: row.ID,
        Prompt: row.Prompt.substring(0, 100) + "...",
        Error: row.Error,
        Attempts: row.Attempts,
      })),
    };

    return fs.writeJson(outputPath, report, { spaces: 2 });
  }
}

module.exports = CSVProcessor;
