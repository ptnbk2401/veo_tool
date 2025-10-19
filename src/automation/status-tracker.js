class StatusTracker {
  constructor() {
    this.currentStatus = {
      step: "idle",
      message: "Ready to start",
      progress: 0,
      timestamp: new Date(),
    };
    this.statusHistory = [];
  }

  updateStatus(step, message, progress = 0) {
    this.currentStatus = {
      step,
      message,
      progress,
      timestamp: new Date(),
    };

    this.statusHistory.push({ ...this.currentStatus });

    // Keep only last 50 status updates
    if (this.statusHistory.length > 50) {
      this.statusHistory = this.statusHistory.slice(-50);
    }

    // Log with emoji for better visibility
    const emoji = this.getStepEmoji(step);
    console.log(`${emoji} [${step.toUpperCase()}] ${message} (${progress}%)`);
  }

  getStepEmoji(step) {
    const emojiMap = {
      idle: "⏸️",
      starting: "🚀",
      creating_project: "🎬",
      project_created: "✅",
      navigating: "🧭",
      inputting_prompt: "✍️",
      configuring_settings: "⚙️",
      rendering: "🎥",
      monitoring_progress: "⏳",
      downloading: "⬇️",
      completed: "🎉",
      error: "❌",
    };
    return emojiMap[step] || "📋";
  }

  getCurrentStatus() {
    return this.currentStatus;
  }

  getStatusHistory() {
    return this.statusHistory;
  }

  reset() {
    this.currentStatus = {
      step: "idle",
      message: "Ready to start",
      progress: 0,
      timestamp: new Date(),
    };
    this.statusHistory = [];
  }
}

module.exports = StatusTracker;
