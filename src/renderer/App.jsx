import React, { useState, useRef, useEffect } from "react";
import useStore from "./store";
import ProfileManager from "./components/ProfileManager";
import VeoSettings from "./components/VeoSettings";
import "./index.css";

function App() {
  const {
    prompts,
    setPrompts,
    settings,
    setSettings,
    isRunning,
    setIsRunning,
    results,
    addResult,
    clearResults,
  } = useStore();

  const [csvFileName, setCsvFileName] = useState("");
  const [logs, setLogs] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [progress, setProgress] = useState({ current: 0, total: 0, status: "" });
  const fileInputRef = useRef(null);

  // Listen for progress updates from backend
  useEffect(() => {
    if (window.electronAPI && window.electronAPI.onProgress) {
      console.log('[Progress] Setting up listener...');
      
      const unsubscribe = window.electronAPI.onProgress((progressData) => {
        console.log('[Progress] Received:', progressData);
        setProgress(progressData);
      });

      return () => {
        console.log('[Progress] Cleaning up listener...');
        if (unsubscribe) unsubscribe();
      };
    } else {
      console.warn('[Progress] onProgress API not available');
    }
  }, []);

  // Handle CSV file upload
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setCsvFileName(file.name);
    const fileExt = file.name.split('.').pop().toLowerCase();
    addLog(`Loading file: ${file.name}`);

    try {
      const text = await file.text();
      const lines = text.split("\n").filter((line) => line.trim());

      const parsedPrompts = [];

      if (fileExt === 'txt') {
        // TXT: Each line is a prompt (simple)
        lines.forEach((line) => {
          const prompt = line.trim();
          if (prompt) {
            parsedPrompts.push(prompt);
          }
        });
      } else if (fileExt === 'csv') {
        // CSV: Each line is a prompt (no header, simple format)
        lines.forEach((line) => {
          const prompt = line.trim();
          // Remove quotes if present
          const cleanPrompt = prompt.replace(/^["'](.*)["']$/, "$1").trim();
          if (cleanPrompt) {
            parsedPrompts.push(cleanPrompt);
          }
        });
      }

      setPrompts(parsedPrompts);
      addLog(`✅ Loaded ${parsedPrompts.length} prompts from ${fileExt.toUpperCase()}`);
    } catch (error) {
      addLog(`Error loading file: ${error.message}`, "error");
    }
  };

  // Handle start automation
  const handleStartAutomation = async () => {
    if (!selectedProfile) {
      addLog("Please select a Chrome profile first", "error");
      alert(
        "Please create and select a Chrome profile before running automation.",
      );
      return;
    }

    if (prompts.length === 0) {
      addLog("No prompts to process", "error");
      return;
    }

    setIsRunning(true);
    clearResults();
    setProgress({ current: 0, total: prompts.length, status: "Initializing..." });
    addLog(`Starting automation with profile: ${selectedProfile.name}`);

    try {
      // Simulate progress updates (in real implementation, this would come from backend)
      setProgress({ current: 0, total: prompts.length, status: "Configuring VEO settings..." });

      // Call backend automation
      const result = await window.electronAPI.startAutomation({
        prompts,
        settings,
        profileId: selectedProfile.id,
      });

      setProgress({ current: prompts.length, total: prompts.length, status: "Completed!" });

      addLog(
        `✅ Automation completed: ${result.success} successful, ${result.failed} failed`,
        "success"
      );

      result.results.forEach((r, index) => {
        addResult(r);
        if (r.status === "success") {
          addLog(`✅ Generated: ${r.prompt.substring(0, 50)}...`, "success");
        } else {
          addLog(
            `❌ Failed: ${r.prompt.substring(0, 50)}... - ${r.status}`,
            "error",
          );
        }
      });
    } catch (error) {
      addLog(`Automation failed: ${error.message}`, "error");
      setProgress({ current: 0, total: 0, status: "Failed" });
    } finally {
      setIsRunning(false);
    }
  };

  // Add log entry with smart type detection
  const addLog = (message, type = "info") => {
    const timestamp = new Date().toLocaleTimeString();

    // Auto-detect type from message if not specified
    let logType = type;
    if (type === "info") {
      if (message.includes("✓") || message.includes("completed") || message.includes("successful")) {
        logType = "success";
      } else if (message.includes("✗") || message.includes("failed") || message.includes("error")) {
        logType = "error";
      }
    }

    setLogs((prev) => [...prev, { timestamp, message, type: logType }]);
  };

  // Open output folder
  const handleOpenOutputFolder = async () => {
    try {
      const outputDir = settings.outputDir || "dist/videos";
      await window.electronAPI.openFolder(outputDir);
    } catch (error) {
      addLog(`Failed to open folder: ${error.message}`, "error");
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>VEO3 Automation Tool</h1>
      </header>

      <main className="app-main">
        {/* Profile Manager */}
        <ProfileManager onProfileSelected={setSelectedProfile} />

        {/* Upload Section */}
        <section className="section">
          <h2>1. Upload Prompts</h2>
          <div className="upload-area">
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.csv"
              onChange={handleFileUpload}
              style={{ display: "none" }}
            />
            <button
              className="btn btn-primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={isRunning}
            >
              📁 Choose File (TXT or CSV)
            </button>
            {csvFileName && <span className="file-name">📄 {csvFileName}</span>}
          </div>
          <small className="upload-help">
            💡 Each line = 1 prompt. Supports .txt and .csv files.
          </small>
        </section>

        {/* Settings Section */}
        <section className="section">
          <h2>2. Settings</h2>
          <VeoSettings
            settings={{
              aspectRatio: settings.aspectRatio || "Landscape (16:9)",
              outputs: settings.outputs || 1,
              model: settings.model || "Veo 3.1 - Fast",
              outputDir: settings.outputDir || "dist/videos",
            }}
            onChange={(veoSettings) => {
              setSettings({
                ...settings,
                mode: "Text to Video", // Always Text to Video
                aspectRatio: veoSettings.aspectRatio,
                outputs: veoSettings.outputs,
                model: veoSettings.model,
                outputDir: veoSettings.outputDir,
              });
            }}
            disabled={isRunning}
          />

          <div className="setting-item" style={{ marginTop: '16px' }}>
            <label htmlFor="useSemaphore">
              <input
                id="useSemaphore"
                type="checkbox"
                checked={settings.useSemaphore || false}
                onChange={(e) =>
                  setSettings({ useSemaphore: e.target.checked })
                }
                disabled={isRunning}
              />
              Use Semaphore Mode (Max 5 concurrent jobs)
            </label>
          </div>
        </section>

        {/* Prompts List */}
        {prompts.length > 0 && (
          <section className="section">
            <h2>3. Prompts ({prompts.length})</h2>
            <div className="prompts-list">
              {prompts.slice(0, 5).map((prompt, index) => (
                <div key={index} className="prompt-item">
                  <span className="prompt-number">{index + 1}.</span>
                  <span className="prompt-text">{prompt}</span>
                </div>
              ))}
              {prompts.length > 5 && (
                <div className="prompt-item more">
                  ... and {prompts.length - 5} more
                </div>
              )}
            </div>
          </section>
        )}

        {/* Action Button */}
        <section className="section">
          <button
            className={`btn btn-large ${isRunning ? "btn-disabled" : "btn-success"}`}
            onClick={handleStartAutomation}
            disabled={isRunning || prompts.length === 0 || !selectedProfile}
          >
            {isRunning ? "⏳ Running..." : "▶️ Start Automation"}
          </button>
          {!selectedProfile && prompts.length > 0 && (
            <p className="warning-text">
              ⚠️ Please select a Chrome profile to continue
            </p>
          )}
        </section>

        {/* Progress Bar - Debug */}
        {isRunning && (
          <section className="section">
            <div className="progress-container">
              <div className="progress-header">
                <h3>⚡ Progress</h3>
                <span className="progress-stats">
                  {progress.current || 0} / {progress.total || prompts.length} prompts
                </span>
              </div>
              <div className="progress-bar-wrapper">
                <div
                  className="progress-bar"
                  style={{
                    width: `${((progress.current || 0) / (progress.total || prompts.length || 1)) * 100}%`
                  }}
                >
                  <span className="progress-percentage">
                    {Math.round(((progress.current || 0) / (progress.total || prompts.length || 1)) * 100)}%
                  </span>
                </div>
              </div>
              <div className="progress-status">
                <span className="status-icon">🔄</span>
                <span className="status-text">{progress.status || "Processing..."}</span>
              </div>
            </div>
          </section>
        )}

        {/* Logs */}
        {logs.length > 0 && (
          <section className="section">
            <div className="section-header">
              <h2>📋 Activity Log</h2>
              <button
                className="btn-clear-logs"
                onClick={() => setLogs([])}
                disabled={isRunning}
              >
                Clear
              </button>
            </div>
            <div className="logs-container">
              {logs.map((log, index) => (
                <div key={index} className={`log-entry log-${log.type}`}>
                  <span className="log-icon">
                    {log.type === "error" && "❌"}
                    {log.type === "info" && "ℹ️"}
                    {log.type === "success" && "✅"}
                  </span>
                  <span className="log-time">{log.timestamp}</span>
                  <span className="log-message">{log.message}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Results */}
        {results.length > 0 && (
          <section className="section">
            <div className="section-header">
              <h2>🎬 Results</h2>
              <div className="results-header-actions">
                <div className="results-stats">
                  <span className="stat-success">
                    ✅ {results.filter(r => r.status === "success").length} Success
                  </span>
                  <span className="stat-failed">
                    ❌ {results.filter(r => r.status !== "success").length} Failed
                  </span>
                </div>
                <button
                  className="btn-open-folder"
                  onClick={handleOpenOutputFolder}
                  title="Open output folder"
                >
                  📁 Open Folder
                </button>
              </div>
            </div>
            <div className="results-grid">
              {results.map((result, index) => (
                <div
                  key={index}
                  className={`result-card ${result.status === "success" ? "success" : "failed"}`}
                >
                  <div className="result-header">
                    <span className="result-number">#{index + 1}</span>
                    <span className={`result-badge ${result.status === "success" ? "badge-success" : "badge-failed"}`}>
                      {result.status === "success" ? "✓ Success" : "✗ Failed"}
                    </span>
                  </div>
                  <div className="result-prompt">
                    {result.prompt.length > 100
                      ? result.prompt.substring(0, 100) + "..."
                      : result.prompt}
                  </div>
                  {result.status === "success" ? (
                    <div className="result-path">
                      <span className="path-icon">📁</span>
                      <span className="path-text">{result.filePath}</span>
                    </div>
                  ) : (
                    <div className="result-error">
                      <span className="error-icon">⚠️</span>
                      <span className="error-text">{result.status}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
