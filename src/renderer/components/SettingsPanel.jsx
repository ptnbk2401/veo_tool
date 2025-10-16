import React, { useState, useEffect } from 'react'
import { useAppStore } from '../store/app-store'

function SettingsPanel() {
  const { config, updateConfig } = useAppStore()
  const [settings, setSettings] = useState({
    automation: {
      pollInterval: 5000,
      timeout: 600000,
      parallel: 1,
      retryAttempts: 3,
      headless: false
    },
    paths: {
      outputFolder: './output',
      logsFolder: './logs'
    },
    ui: {
      theme: 'light',
      autoSave: true,
      notifications: true,
      logLevel: 'info'
    }
  })
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    if (config) {
      setSettings(config)
    }
  }, [config])

  const handleSettingChange = (section, key, value) => {
    setSettings(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value
      }
    }))
    setHasChanges(true)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateConfig(settings)
      setHasChanges(false)
      alert('Settings saved successfully!')
    } catch (error) {
      alert(`Failed to save settings: ${error.message}`)
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    if (confirm('Reset all settings to default values?')) {
      setSettings({
        automation: {
          pollInterval: 5000,
          timeout: 600000,
          parallel: 1,
          retryAttempts: 3,
          headless: false
        },
        paths: {
          outputFolder: './output',
          logsFolder: './logs'
        },
        ui: {
          theme: 'light',
          autoSave: true,
          notifications: true,
          logLevel: 'info'
        }
      })
      setHasChanges(true)
    }
  }

  const handleSelectFolder = async (section, key) => {
    try {
      const folderPath = await window.electronAPI.fs.selectFolder()
      if (folderPath) {
        handleSettingChange(section, key, folderPath)
      }
    } catch (error) {
      alert(`Failed to select folder: ${error.message}`)
    }
  }

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Settings</h2>
          <div className="flex gap-2">
            {hasChanges && (
              <span className="text-sm text-yellow-600 flex items-center">
                Unsaved changes
              </span>
            )}
            <button
              className="btn btn-outline"
              onClick={handleReset}
            >
              Reset
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        <div className="space-y-6">
          {/* Automation Settings */}
          <div>
            <h3 className="text-lg font-medium mb-4">Automation</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group">
                <label className="form-label">Poll Interval (ms)</label>
                <input
                  type="number"
                  className="form-input"
                  value={settings.automation?.pollInterval || 5000}
                  onChange={(e) => handleSettingChange('automation', 'pollInterval', parseInt(e.target.value))}
                  min="1000"
                  step="1000"
                />
                <div className="text-sm text-gray-500">How often to check render progress</div>
              </div>

              <div className="form-group">
                <label className="form-label">Timeout (ms)</label>
                <input
                  type="number"
                  className="form-input"
                  value={settings.automation?.timeout || 600000}
                  onChange={(e) => handleSettingChange('automation', 'timeout', parseInt(e.target.value))}
                  min="30000"
                  step="30000"
                />
                <div className="text-sm text-gray-500">Maximum time to wait for render</div>
              </div>

              <div className="form-group">
                <label className="form-label">Parallel Jobs</label>
                <input
                  type="number"
                  className="form-input"
                  value={settings.automation?.parallel || 1}
                  onChange={(e) => handleSettingChange('automation', 'parallel', parseInt(e.target.value))}
                  min="1"
                  max="5"
                />
                <div className="text-sm text-gray-500">Number of concurrent jobs</div>
              </div>

              <div className="form-group">
                <label className="form-label">Retry Attempts</label>
                <input
                  type="number"
                  className="form-input"
                  value={settings.automation?.retryAttempts || 3}
                  onChange={(e) => handleSettingChange('automation', 'retryAttempts', parseInt(e.target.value))}
                  min="0"
                  max="10"
                />
                <div className="text-sm text-gray-500">Number of retry attempts on failure</div>
              </div>
            </div>

            <div className="form-group">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.automation?.headless || false}
                  onChange={(e) => handleSettingChange('automation', 'headless', e.target.checked)}
                />
                <span className="form-label mb-0">Headless Mode</span>
              </label>
              <div className="text-sm text-gray-500">Run browser in background (not recommended for debugging)</div>
            </div>
          </div>

          {/* Path Settings */}
          <div>
            <h3 className="text-lg font-medium mb-4">Paths</h3>
            
            <div className="form-group">
              <label className="form-label">Output Folder</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="form-input"
                  value={settings.paths?.outputFolder || './output'}
                  onChange={(e) => handleSettingChange('paths', 'outputFolder', e.target.value)}
                />
                <button
                  className="btn btn-outline"
                  onClick={() => handleSelectFolder('paths', 'outputFolder')}
                >
                  Browse
                </button>
              </div>
              <div className="text-sm text-gray-500">Where generated videos will be saved</div>
            </div>

            <div className="form-group">
              <label className="form-label">Logs Folder</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="form-input"
                  value={settings.paths?.logsFolder || './logs'}
                  onChange={(e) => handleSettingChange('paths', 'logsFolder', e.target.value)}
                />
                <button
                  className="btn btn-outline"
                  onClick={() => handleSelectFolder('paths', 'logsFolder')}
                >
                  Browse
                </button>
              </div>
              <div className="text-sm text-gray-500">Where application logs will be stored</div>
            </div>
          </div>

          {/* UI Settings */}
          <div>
            <h3 className="text-lg font-medium mb-4">Interface</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="form-group">
                <label className="form-label">Theme</label>
                <select
                  className="form-select"
                  value={settings.ui?.theme || 'light'}
                  onChange={(e) => handleSettingChange('ui', 'theme', e.target.value)}
                >
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="auto">Auto</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Log Level</label>
                <select
                  className="form-select"
                  value={settings.ui?.logLevel || 'info'}
                  onChange={(e) => handleSettingChange('ui', 'logLevel', e.target.value)}
                >
                  <option value="error">Error</option>
                  <option value="warn">Warning</option>
                  <option value="info">Info</option>
                  <option value="debug">Debug</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.ui?.autoSave || false}
                  onChange={(e) => handleSettingChange('ui', 'autoSave', e.target.checked)}
                />
                <span className="form-label mb-0">Auto-save progress</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.ui?.notifications || false}
                  onChange={(e) => handleSettingChange('ui', 'notifications', e.target.checked)}
                />
                <span className="form-label mb-0">Show notifications</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">About</h3>
        </div>
        
        <div className="text-sm space-y-2">
          <div className="flex justify-between">
            <span>Application:</span>
            <span className="font-medium">VEO3 Automation Tool</span>
          </div>
          <div className="flex justify-between">
            <span>Version:</span>
            <span className="font-medium">1.0.0</span>
          </div>
          <div className="flex justify-between">
            <span>Platform:</span>
            <span className="font-medium">{navigator.platform}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsPanel