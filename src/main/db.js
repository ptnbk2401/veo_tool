const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');

// Operation status constants
const OPERATION_STATUS = {
  SUCCESSFUL: 'MEDIA_GENERATION_STATUS_SUCCESSFUL',
  FAILED: 'MEDIA_GENERATION_STATUS_FAILED',
  CANCELLED: 'MEDIA_GENERATION_STATUS_CANCELLED',
};

class VeoDatabase {
  constructor(dbPath = 'data/veo-automation.db') {
    this.dbPath = dbPath;
    this.db = null;
    this.SQL = null;
  }

  /**
   * Initialize database with schema and pragmas
   */
  async init() {
    // Ensure data directory exists
    fs.ensureDirSync(path.dirname(this.dbPath));

    // Initialize sql.js
    this.SQL = await initSqlJs();

    // Load existing database or create new
    if (fs.existsSync(this.dbPath)) {
      const buffer = fs.readFileSync(this.dbPath);
      this.db = new this.SQL.Database(buffer);
    } else {
      this.db = new this.SQL.Database();
    }

    // Set pragmas for performance and safety
    this.exec('PRAGMA journal_mode = WAL');
    this.exec('PRAGMA synchronous = NORMAL');
    this.exec('PRAGMA foreign_keys = ON');

    // Create tables
    this.createTables();

    // Run migrations for existing databases
    this.runMigrations();

    // DON'T run resume cleanup here - it will be called manually if needed
    // this.resumeCleanup();

    // Save initial state
    this.save();
  }

  /**
   * Run database migrations
   */
  runMigrations() {
    // Check if retry columns exist
    const tableInfo = this.prepare(`PRAGMA table_info(prompts)`).all();
    const hasRetryCount = tableInfo.some(col => col.name === 'retry_count');

    if (!hasRetryCount) {
      console.log('Running migration: Adding retry columns to prompts table...');
      this.exec(`
        ALTER TABLE prompts ADD COLUMN retry_count INTEGER DEFAULT 0;
        ALTER TABLE prompts ADD COLUMN max_retries INTEGER DEFAULT 3;
      `);
      console.log('Migration completed: retry columns added');
      this.save();
    }
  }

  /**
   * Create database schema
   */
  createTables() {
    // Prompts table
    this.exec(`
      CREATE TABLE IF NOT EXISTS prompts (
        id INTEGER PRIMARY KEY,
        idx INTEGER NOT NULL,
        prompt_text TEXT,
        tail50 TEXT,
        tail_slug TEXT,
        text_hash TEXT UNIQUE,
        status TEXT CHECK(status IN ('queued','submitting','in_progress','done','failed','timeout')),
        submit_at TEXT,
        done_at TEXT,
        error TEXT,
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3
      );
      CREATE INDEX IF NOT EXISTS ix_prompts_status ON prompts(status);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_prompts_idx ON prompts(idx);
    `);

    // Operations table
    this.exec(`
      CREATE TABLE IF NOT EXISTS operations (
        id INTEGER PRIMARY KEY,
        prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
        take_index INTEGER NOT NULL,
        op_name TEXT NOT NULL,
        scene_id TEXT,
        status TEXT,
        fife_url TEXT,
        model TEXT,
        duration_sec INTEGER,
        last_poll_at TEXT,
        downloaded INTEGER DEFAULT 0,
        file_path TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_ops_prompt ON operations(prompt_id);
      CREATE INDEX IF NOT EXISTS ix_ops_status ON operations(status);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_ops_name ON operations(op_name);
    `);

    // Downloads table
    this.exec(`
      CREATE TABLE IF NOT EXISTS downloads (
        id INTEGER PRIMARY KEY,
        prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
        operation_id INTEGER NOT NULL REFERENCES operations(id) ON DELETE CASCADE,
        state TEXT CHECK(state IN ('queued','running','done','failed')),
        retries INTEGER DEFAULT 0,
        last_error TEXT,
        enqueued_at TEXT,
        started_at TEXT,
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS ix_dl_state ON downloads(state);
    `);
  }

  /**
   * Resume cleanup: reset stale states on startup
   */
  resumeCleanup() {
    const now = new Date().toISOString();
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Reset submitting → queued (important for retries)
    const submittingCount = this.prepare(`SELECT COUNT(*) as count FROM prompts WHERE status = 'submitting'`).get();
    if (submittingCount && submittingCount.count > 0) {
      this.prepare(`UPDATE prompts SET status = 'queued' WHERE status = 'submitting'`).run();
      console.log(`Reset ${submittingCount.count} submitting prompts to queued`);
    }

    // Timeout old in_progress prompts
    this.prepare(`
      UPDATE prompts SET status = 'timeout', done_at = ? 
      WHERE status = 'in_progress' AND submit_at < ?
    `).run(now, oneDayAgo);

    // Reset running downloads → queued
    this.prepare(`
      UPDATE downloads SET state = 'queued', started_at = NULL 
      WHERE state = 'running'
    `).run();
  }

  /**
   * Insert prompts from array
   */
  insertPrompts(prompts) {
    const stmt = this.prepare(`
      INSERT INTO prompts (idx, prompt_text, tail50, tail_slug, text_hash, status)
      VALUES (?, ?, ?, ?, ?, 'queued')
    `);

    let inserted = 0;
    let skipped = 0;
    let errors = [];

    // Don't use transaction - sql.js has issues
    for (const p of prompts) {
      const tail50 = p.promptText.slice(-50);
      const tailSlug = this.createTailSlug(p.promptText);
      const textHash = crypto.createHash('sha256').update(p.promptText).digest('hex');

      try {
        stmt.run(p.index, p.promptText, tail50, tailSlug, textHash);
        inserted++;
        console.log(`✓ Inserted prompt #${p.index}`);
      } catch (err) {
        // Skip duplicates
        if (err.message && err.message.includes('UNIQUE constraint')) {
          console.log(`⊘ Skipped duplicate prompt #${p.index}`);
          skipped++;
        } else {
          console.error(`✗ Error inserting prompt #${p.index}: ${err.message}`);
          errors.push({ index: p.index, error: err.message });
        }
      }
    }

    this.save();
    console.log(`Inserted ${inserted} prompts, skipped ${skipped} duplicates, errors: ${errors.length}`);

    if (errors.length > 0) {
      console.error('Insert errors:', errors);
    }
  }

  /**
   * Create tail slug from prompt text
   */
  createTailSlug(promptText) {
    const tail50 = promptText.slice(-50);
    return tail50
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * Get inflight count (transactional)
   */
  getInflightCount() {
    const result = this.prepare(`
      SELECT COUNT(*) as count FROM prompts WHERE status = 'in_progress'
    `).get();
    return result.count || 0;
  }

  /**
   * Get next queued prompt WITHOUT marking (just peek)
   */
  peekNextQueuedPrompt() {
    try {
      const inflight = this.getInflightCount();
      if (inflight >= 5) {
        return null;
      }

      const prompt = this.prepare(`
        SELECT * FROM prompts WHERE status = 'queued' ORDER BY idx LIMIT 1
      `).get();

      return prompt;
    } catch (error) {
      console.error('Error in peekNextQueuedPrompt:', error);
      return null;
    }
  }

  /**
   * Mark prompt as submitting
   */
  markPromptSubmitting(promptId) {
    this.prepare(`
      UPDATE prompts SET status = 'submitting' WHERE id = ?
    `).run(promptId);
  }

  /**
   * Get next queued prompt and mark as submitting (atomic)
   */
  getNextQueuedPrompt() {
    try {
      const prompt = this.peekNextQueuedPrompt();

      if (!prompt) {
        return null;
      }

      console.log(`Selected prompt #${prompt.idx} for submission`);

      // Mark as submitting
      this.markPromptSubmitting(prompt.id);

      return prompt;
    } catch (error) {
      console.error('Error in getNextQueuedPrompt:', error);
      return null;
    }
  }

  /**
   * Mark prompt as in_progress and insert operations
   */
  markPromptInProgress(promptId, operations) {
    const now = new Date().toISOString();

    // Update prompt
    this.prepare(`
      UPDATE prompts SET status = 'in_progress', submit_at = ? WHERE id = ?
    `).run(now, promptId);

    // Insert operations
    const stmt = this.prepare(`
      INSERT INTO operations (prompt_id, take_index, op_name, scene_id, status)
      VALUES (?, ?, ?, ?, ?)
    `);

    operations.forEach((op, index) => {
      stmt.run(promptId, index, op.operation.name, op.sceneId, op.status);
    });

    // Explicit save
    this.save();
  }

  /**
   * Mark prompt as failed
   */
  markPromptFailed(promptId, error) {
    const now = new Date().toISOString();
    this.prepare(`
      UPDATE prompts SET status = 'failed', done_at = ?, error = ? WHERE id = ?
    `).run(now, error, promptId);
  }

  /**
   * Reset prompt back to queued (for retry)
   */
  resetPromptToQueued(promptId) {
    this.prepare(`
      UPDATE prompts SET status = 'queued' WHERE id = ?
    `).run(promptId);
  }

  /**
   * Retry failed/timeout operations for a prompt
   * Returns: { canRetry: boolean, retriedCount: number, reason: string }
   */
  retryFailedOperations(promptId) {
    const prompt = this.prepare(`SELECT * FROM prompts WHERE id = ?`).get(promptId);

    if (!prompt) {
      return { canRetry: false, retriedCount: 0, reason: 'Prompt not found' };
    }

    // Check if already at max retries
    if (prompt.retry_count >= prompt.max_retries) {
      return {
        canRetry: false,
        retriedCount: 0,
        reason: `Max retries reached (${prompt.retry_count}/${prompt.max_retries})`,
      };
    }

    // Get operations that need retry (failed or cancelled)
    const failedOps = this.prepare(`
      SELECT * FROM operations 
      WHERE prompt_id = ? 
      AND (status = ? OR status = ?)
    `).all(promptId, OPERATION_STATUS.FAILED, OPERATION_STATUS.CANCELLED);

    // Get successful operations count
    const successfulOps = this.prepare(`
      SELECT COUNT(*) as count FROM operations 
      WHERE prompt_id = ? AND status = ?
    `).get(promptId, OPERATION_STATUS.SUCCESSFUL);

    if (failedOps.length === 0) {
      return {
        canRetry: false,
        retriedCount: 0,
        reason: 'No failed operations to retry',
      };
    }

    // IMPORTANT: Delete ONLY failed/cancelled operations
    // Keep successful ones to avoid re-submission
    this.prepare(`
      DELETE FROM operations 
      WHERE prompt_id = ? 
      AND (status = ? OR status = ?)
    `).run(promptId, OPERATION_STATUS.FAILED, OPERATION_STATUS.CANCELLED);

    // Reset prompt to queued and increment retry count
    const now = new Date().toISOString();
    this.prepare(`
      UPDATE prompts 
      SET status = 'queued',
          retry_count = retry_count + 1,
          done_at = NULL,
          error = NULL,
          submit_at = ?
      WHERE id = ?
    `).run(now, promptId);

    this.save();

    return {
      canRetry: true,
      retriedCount: failedOps.length,
      reason: `Retrying ${failedOps.length} failed operations (${successfulOps.count} successful kept)`,
    };
  }

  /**
   * Get all in-progress prompts with their operations
   */
  getInProgressPrompts() {
    const prompts = this.prepare(`
      SELECT * FROM prompts WHERE status = 'in_progress'
    `).all();

    return prompts.map(prompt => {
      const operations = this.prepare(`
        SELECT * FROM operations WHERE prompt_id = ? ORDER BY take_index
      `).all(prompt.id);

      return { ...prompt, operations };
    });
  }

  /**
   * Update operations from poll response
   */
  updateOperations(promptId, operations) {
    const now = new Date().toISOString();

    const stmt = this.prepare(`
      UPDATE operations 
      SET status = ?, fife_url = ?, model = ?, duration_sec = ?, last_poll_at = ?
      WHERE prompt_id = ? AND op_name = ?
    `);

    operations.forEach(op => {
      const fifeUrl = op.operation?.metadata?.video?.fifeUrl || null;
      const model = op.operation?.metadata?.video?.model || null;
      const durationSec = 8; // Default, can parse from metadata if available

      stmt.run(op.status, fifeUrl, model, durationSec, now, promptId, op.operation.name);
    });
  }

  /**
   * Check if prompt is complete and update status
   */
  checkAndUpdatePromptStatus(promptId) {
    const prompt = this.prepare(`SELECT * FROM prompts WHERE id = ?`).get(promptId);

    if (!prompt || prompt.status !== 'in_progress') {
      return null;
    }

    const operations = this.prepare(`
      SELECT * FROM operations WHERE prompt_id = ?
    `).all(promptId);

    const now = new Date().toISOString();

    // Check if ALL operations are failed/cancelled
    const allFailed = operations.every(op =>
      op.status === OPERATION_STATUS.FAILED ||
      op.status === OPERATION_STATUS.CANCELLED
    );

    if (allFailed && operations.length > 0) {
      this.prepare(`
        UPDATE prompts SET status = 'failed', done_at = ? WHERE id = ?
      `).run(now, promptId);
      this.save();
      return 'failed';
    }

    // Check if all operations have final status (successful, failed, or cancelled)
    const allCompleted = operations.every(op =>
      op.status === OPERATION_STATUS.SUCCESSFUL ||
      op.status === OPERATION_STATUS.FAILED ||
      op.status === OPERATION_STATUS.CANCELLED
    );

    if (allCompleted && operations.length > 0) {
      this.prepare(`
        UPDATE prompts SET status = 'done', done_at = ? WHERE id = ?
      `).run(now, promptId);
      this.save();

      // Enqueue downloads for successful operations only
      this.enqueueDownloads(promptId, operations);
      return 'done';
    }

    // Check timeout LAST (only if not done/failed)
    const submitTime = new Date(prompt.submit_at).getTime();
    const elapsed = Date.now() - submitTime;

    if (elapsed > 210000) {
      this.prepare(`
        UPDATE prompts SET status = 'timeout', done_at = ? WHERE id = ?
      `).run(now, promptId);
      this.save();
      return 'timeout';
    }

    return 'in_progress';
  }

  /**
   * Enqueue download tasks for successful operations
   */
  enqueueDownloads(promptId, operations) {
    const now = new Date().toISOString();
    const stmt = this.prepare(`
      INSERT INTO downloads (prompt_id, operation_id, state, enqueued_at)
      VALUES (?, ?, 'queued', ?)
    `);

    operations.forEach(op => {
      if (op.fife_url && op.status === OPERATION_STATUS.SUCCESSFUL) {
        stmt.run(promptId, op.id, now);
      }
    });
  }

  /**
   * Get next queued download
   */
  getNextQueuedDownload() {
    return this.prepare(`
      SELECT d.*, o.fife_url, o.file_path, o.model, o.duration_sec, o.take_index,
             p.idx as prompt_idx, p.tail_slug
      FROM downloads d
      JOIN operations o ON d.operation_id = o.id
      JOIN prompts p ON d.prompt_id = p.id
      WHERE d.state = 'queued'
      ORDER BY d.id
      LIMIT 1
    `).get();
  }

  /**
   * Mark download as running
   */
  markDownloadRunning(downloadId) {
    const now = new Date().toISOString();
    this.prepare(`
      UPDATE downloads SET state = 'running', started_at = ? WHERE id = ?
    `).run(now, downloadId);
  }

  /**
   * Mark download as done
   */
  markDownloadDone(downloadId, operationId, filePath) {
    const now = new Date().toISOString();

    this.prepare(`
      UPDATE downloads SET state = 'done', finished_at = ? WHERE id = ?
    `).run(now, downloadId);

    this.prepare(`
      UPDATE operations SET downloaded = 1, file_path = ? WHERE id = ?
    `).run(filePath, operationId);

    this.save();
  }

  /**
   * Mark download as failed and increment retries
   */
  markDownloadFailed(downloadId, error) {
    const now = new Date().toISOString();
    this.prepare(`
      UPDATE downloads 
      SET state = 'failed', finished_at = ?, last_error = ?, retries = retries + 1
      WHERE id = ?
    `).run(now, error, downloadId);
  }

  /**
   * Retry download (reset to queued if retries < 3)
   */
  retryDownload(downloadId) {
    const download = this.prepare(`SELECT retries FROM downloads WHERE id = ?`).get(downloadId);

    if (download && download.retries < 3) {
      this.prepare(`
        UPDATE downloads SET state = 'queued', started_at = NULL WHERE id = ?
      `).run(downloadId);
      return true;
    }
    return false;
  }

  /**
   * Get manifest for export
   */
  getManifest() {
    return this.prepare(`
      SELECT 
        p.idx, 
        p.prompt_text,
        p.tail_slug, 
        p.status as prompt_status,
        p.submit_at,
        p.done_at,
        o.take_index, 
        o.model, 
        o.file_path, 
        o.status as op_status, 
        o.downloaded,
        o.fife_url
      FROM prompts p
      LEFT JOIN operations o ON o.prompt_id = p.id
      ORDER BY p.idx, o.take_index
    `).all();
  }

  /**
   * Get statistics
   */
  getStats() {
    const stats = this.prepare(`
      SELECT 
        COUNT(*) as total_prompts,
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) as queued,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'timeout' THEN 1 ELSE 0 END) as timeout,
        SUM(CASE WHEN retry_count > 0 THEN 1 ELSE 0 END) as retried,
        AVG(retry_count) as avg_retry_count
      FROM prompts
    `).get();

    const opStats = this.prepare(`
      SELECT 
        COUNT(*) as total_ops,
        SUM(CASE WHEN downloaded = 1 THEN 1 ELSE 0 END) as downloaded
      FROM operations
    `).get();

    return { ...stats, ...opStats };
  }

  /**
   * Save database to file
   */
  save() {
    if (this.db && this.dbPath !== ':memory:') {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    }
  }

  /**
   * Execute SQL (helper for sql.js)
   */
  exec(sql) {
    this.db.run(sql);
  }

  /**
   * Prepare statement (wrapper for sql.js compatibility)
   */
  prepare(sql) {
    const self = this;
    return {
      run(...params) {
        self.db.run(sql, params);
        self.save();
        return { changes: self.db.getRowsModified() };
      },
      get(...params) {
        const stmt = self.db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          return row;
        }
        stmt.free();
        return null;
      },
      all(...params) {
        const stmt = self.db.prepare(sql);
        stmt.bind(params);
        const rows = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
        }
        stmt.free();
        return rows;
      }
    };
  }

  /**
   * Transaction wrapper for sql.js
   */
  transaction(fn) {
    return (...args) => {
      try {
        this.exec('BEGIN TRANSACTION');
      } catch (e) {
        // Already in transaction, continue
      }
      try {
        const result = fn(...args);
        try {
          this.exec('COMMIT');
        } catch (e) {
          // No transaction to commit
        }
        this.save();
        return result;
      } catch (error) {
        try {
          this.exec('ROLLBACK');
        } catch (e) {
          // No transaction to rollback
        }
        throw error;
      }
    };
  }

  /**
   * Close database
   */
  close() {
    if (this.db) {
      this.save();
      this.db.close();
    }
  }
}

module.exports = VeoDatabase;
