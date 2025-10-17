import React, { useState, useRef } from 'react';
import useStore from './store';
import ProfileManager from './components/ProfileManager';
import './index.css';

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

  const [csvFileName, setCsvFileName] = useState('');
  const [logs, setLogs] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const fileInputRef = useRef(null);

  // Handle CSV file upload
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setCsvFileName(file.name);
    addLog(`Loading CSV file: ${file.name}`);

    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      
      // Skip header and parse prompts
      const parsedPrompts = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line) {
          // Handle CSV with quotes
          const prompt = line.replace(/^"(.*)"$/, '$1').trim();
          if (prompt) {
            parsedPrompts.push(prompt);
          }
        }
      }

      setPrompts(parsedPrompts);
      addLog(`Loaded ${parsedPrompts.length} prompts`);
    } catch (error) {
      addLog(`Error loading CSV: ${error.message}`, 'error');
    }
  };

  // Handle start automation
  const handleStartAutomation = async () => {
    if (!selectedProfile) {
      addLog('Please select a Chrome profile first', 'error');
      alert('Please create and select a Chrome profile before running automation.');
      return;
    }

    if (prompts.length === 0) {
      addLog('No prompts to process', 'error');
      return;
    }

    setIsRunning(true);
    clearResults();
    addLog(`Starting automation with profile: ${selectedProfile.name}`);

    try {
      // Call backend automation
      const result = await window.electronAPI.startAutomation({
        prompts,
        settings,
        profileId: selectedProfile.id,
      });

      addLog(`Automation completed: ${result.success} successful, ${result.failed} failed`);
      
      result.results.forEach(r => {
        addResult(r);
        if (r.status === 'success') {
          addLog(`✓ Generated: ${r.prompt.substring(0, 50)}...`);
        } else {
          addLog(`✗ Failed: ${r.prompt.substring(0, 50)}... - ${r.status}`, 'error');
        }
      });
    } catch (error) {
      addLog(`Automation failed: ${error.message}`, 'error');
    } finally {
      setIsRunning(false);
    }
  };

  // Add log entry
  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { timestamp, message, type }]);
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
          <h2>1. Upload CSV</h2>
          <div className="upload-area">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              style={{ display: 'none' }}
            />
            <button 
              className="btn btn-primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={isRunning}
            >
              Choose CSV File
            </button>
            {csvFileName && (
              <span className="file-name">📄 {csvFileName}</span>
            )}
          </div>
        </section>

        {/* Settings Section */}
        <section className="section">
          <h2>2. Settings</h2>
          <div className="settings-grid">
            <div className="setting-item">
              <label htmlFor="aspectRatio">Aspect Ratio:</label>
              <select
                id="aspectRatio"
                value={settings.aspectRatio}
                onChange={(e) => setSettings({ aspectRatio: e.target.value })}
                disabled={isRunning}
              >
                <option value="16:9">16:9 (Landscape)</option>
                <option value="9:16">9:16 (Portrait)</option>
                <option value="1:1">1:1 (Square)</option>
              </select>
            </div>

            <div className="setting-item">
              <label htmlFor="outputCount">Output Count:</label>
              <input
                id="outputCount"
                type="number"
                min="1"
                max="4"
                value={settings.outputCount}
                onChange={(e) => setSettings({ outputCount: parseInt(e.target.value) })}
                disabled={isRunning}
              />
            </div>
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
            className={`btn btn-large ${isRunning ? 'btn-disabled' : 'btn-success'}`}
            onClick={handleStartAutomation}
            disabled={isRunning || prompts.length === 0 || !selectedProfile}
          >
            {isRunning ? '⏳ Running...' : '▶️ Start Automation'}
          </button>
          {!selectedProfile && prompts.length > 0 && (
            <p className="warning-text">⚠️ Please select a Chrome profile to continue</p>
          )}
        </section>

        {/* Logs */}
        {logs.length > 0 && (
          <section className="section">
            <h2>Logs</h2>
            <div className="logs-container">
              {logs.map((log, index) => (
                <div key={index} className={`log-entry log-${log.type}`}>
                  <span className="log-time">[{log.timestamp}]</span>
                  <span className="log-message">{log.message}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Results */}
        {results.length > 0 && (
          <section className="section">
            <h2>Results ({results.length})</h2>
            <div className="results-list">
              {results.map((result, index) => (
                <div key={index} className={`result-item result-${result.status === 'success' ? 'success' : 'error'}`}>
                  <div className="result-prompt">{result.prompt.substring(0, 80)}...</div>
                  {result.status === 'success' ? (
                    <div className="result-path">✓ {result.filePath}</div>
                  ) : (
                    <div className="result-error">✗ {result.status}</div>
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
