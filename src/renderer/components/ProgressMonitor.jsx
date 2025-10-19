import React, { useState, useEffect } from "react";
import { useAppStore } from "../store/app-store";

function ProgressMonitor() {
  const {
    activeJobs,
    currentProgress,
    logs,
    pauseJob,
    resumeJob,
    stopJob,
    clearLogs,
  } = useAppStore();
  const [selectedJob, setSelectedJob] = useState(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (activeJobs.length > 0 && !selectedJob) {
      setSelectedJob(activeJobs[0]);
    }
  }, [activeJobs, selectedJob]);

  const handleJobAction = async (action, jobId) => {
    try {
      switch (action) {
        case "pause":
          await pauseJob(jobId);
          break;
        case "resume":
          await resumeJob(jobId);
          break;
        case "stop":
          if (confirm("Are you sure you want to stop this job?")) {
            await stopJob(jobId);
          }
          break;
      }
    } catch (error) {
      alert(`Failed to ${action} job: ${error.message}`);
    }
  };

  const getProgressPercentage = (job) => {
    if (!job.progress) return 0;
    return Math.round(
      ((job.progress.completed + job.progress.failed) / job.progress.total) *
        100,
    );
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "running":
        return "status-info";
      case "paused":
        return "status-warning";
      case "completed":
        return "status-success";
      case "stopped":
        return "status-error";
      default:
        return "status-info";
    }
  };

  const formatDuration = (startTime) => {
    const duration = Date.now() - new Date(startTime).getTime();
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  return (
    <div>
      {activeJobs.length === 0 ? (
        <div className="card">
          <div className="text-center text-gray-500">
            <h3 className="text-lg font-medium mb-2">No Active Jobs</h3>
            <p>Start a batch processing job to see progress here.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Active Jobs</h2>
              <div className="flex gap-2">
                <select
                  className="form-select"
                  value={selectedJob?.id || ""}
                  onChange={(e) => {
                    const job = activeJobs.find((j) => j.id === e.target.value);
                    setSelectedJob(job);
                  }}
                >
                  {activeJobs.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.name} ({job.status})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {selectedJob && (
              <div>
                <div className="mb-4">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="font-medium">{selectedJob.name}</h3>
                    <span
                      className={`status ${getStatusColor(selectedJob.status)}`}
                    >
                      {selectedJob.status}
                    </span>
                  </div>

                  <div className="progress mb-2">
                    <div
                      className="progress-bar"
                      style={{
                        width: `${getProgressPercentage(selectedJob)}%`,
                      }}
                    ></div>
                  </div>

                  <div className="flex justify-between text-sm text-gray-600">
                    <span>
                      {selectedJob.progress?.completed || 0} completed,
                      {selectedJob.progress?.failed || 0} failed,
                      {selectedJob.progress?.pending || 0} pending
                    </span>
                    <span>{getProgressPercentage(selectedJob)}%</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <div className="text-sm text-gray-500">Profile</div>
                    <div className="font-medium">{selectedJob.profileId}</div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Duration</div>
                    <div className="font-medium">
                      {selectedJob.startedAt
                        ? formatDuration(selectedJob.startedAt)
                        : "Not started"}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Total Items</div>
                    <div className="font-medium">
                      {selectedJob.progress?.total || 0}
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500">Current Item</div>
                    <div className="font-medium text-sm">
                      {selectedJob.progress?.current?.Prompt?.substring(
                        0,
                        30,
                      ) || "None"}
                      ...
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  {selectedJob.status === "running" && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleJobAction("pause", selectedJob.id)}
                    >
                      Pause
                    </button>
                  )}

                  {selectedJob.status === "paused" && (
                    <button
                      className="btn btn-primary"
                      onClick={() => handleJobAction("resume", selectedJob.id)}
                    >
                      Resume
                    </button>
                  )}

                  <button
                    className="btn btn-danger"
                    onClick={() => handleJobAction("stop", selectedJob.id)}
                  >
                    Stop
                  </button>
                </div>
              </div>
            )}
          </div>

          {currentProgress && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Current Item Progress</h3>
              </div>

              <div className="mb-2">
                <div className="text-sm text-gray-500">
                  Item ID: {currentProgress.itemId}
                </div>
                <div className="font-medium mb-2">
                  {currentProgress.progress?.message || "Processing..."}
                </div>

                {currentProgress.progress?.progress && (
                  <div className="progress">
                    <div
                      className="progress-bar"
                      style={{ width: `${currentProgress.progress.progress}%` }}
                    ></div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">Activity Logs</h3>
          <div className="flex gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              Auto-scroll
            </label>
            <button className="btn btn-outline btn-sm" onClick={clearLogs}>
              Clear
            </button>
          </div>
        </div>

        <div
          className="bg-gray-900 text-green-400 p-3 rounded font-mono text-sm max-h-64 overflow-y-auto"
          style={{ scrollBehavior: autoScroll ? "smooth" : "auto" }}
        >
          {logs.length === 0 ? (
            <div className="text-gray-500">No logs yet...</div>
          ) : (
            logs.map((log, index) => (
              <div key={index} className="mb-1">
                <span className="text-gray-400">
                  [{new Date(log.timestamp).toLocaleTimeString()}]
                </span>
                <span
                  className={`ml-2 ${
                    log.level === "error"
                      ? "text-red-400"
                      : log.level === "warn"
                        ? "text-yellow-400"
                        : "text-green-400"
                  }`}
                >
                  {log.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default ProgressMonitor;
