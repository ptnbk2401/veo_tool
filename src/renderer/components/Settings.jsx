import React, { useState, useEffect } from 'react'
import { useAppStore } from '../store/app-store'

function Settings() {
  const { config, updateConfig } = useAppStore()
  const [videoSettings, setVideoSettings] = useState({
    model: 'veo-3.1-fast',
    aspectRatio: '16:9',
    count: 1,
    duration: '5s',
    quality: 'high'
  })
  const [automationSettings, setAutomationSettings] = useState({
    timeout: 600000,
    parallel: 1,
    retryAttempts: 3,
    headless: false
  })
  const [saving, setSaving] = useState(false)

  // Load current config on mount
  useEffect(() => {
    if (config) {
      setVideoSettings({
        model: config.video?.model || 'veo-3.1-fast',
        aspectRatio: config.video?.aspectRatio || '16:9',
        count: config.video?.count || 1,
        duration: config.video?.duration || '5s',
        quality: config.video?.quality || 'high'
      })
      setAutomationSettings({
        timeout: config.automation?.timeout || 600000,
        parallel: config.automation?.parallel || 1,
        retryAttempts: config.automation?.retryAttempts || 3,
        headless: config.automation?.headless || false
      })
    }
  }, [config])

  const handleVideoSettingChange = (key, value) => {
    setVideoSettings(prev => ({
      ...prev,
      [key]: value
    }))
  }

  const handleAutomationSettingChange = (key, value) => {
    setAutomationSettings(prev => ({
      ...prev,
      [key]: value
    }))
  }

  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      await updateConfig({
        video: videoSettings,
        automation: automationSettings
      })
      alert('Settings saved successfully!')
    } catch (error) {
      alert(`Failed to save settings: ${error.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleResetToDefaults = () => {
    setVideoSettings({
      model: 'veo-3.1-fast',
      aspectRatio: '16:9',
      count: 1,
      duration: '5s',
      quality: 'high'
    })
    setAutomationSettings({
      timeout: 600000,
      parallel: 1,
      retryAttempts: 3,
      headless: false
    })
  }

  return (
    <div className="space-y-6">
      {/* Video Generation Settings */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">🎬 Video Generation Settings</h2>
          <p className="text-sm text-gray-600">Configure VEO3 video generation parameters</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* VEO Model */}
          <div className="form-group">
            <label className="form-label">VEO Model</label>
            <select 
              className="form-select"
              value={videoSettings.model}
              onChange={(e) => handleVideoSettingChange('model', e.target.value)}
            >
              <option value="veo-3.1-fast">VEO 3.1 - Fast (Recommended)</option>
              <option value="veo-3.1-standard">VEO 3.1 - Standard</option>
              <option value="veo-2">VEO 2 (Legacy)</option>
            </select>
            <p className="form-help">VEO 3.1 Fast provides faster generation with good quality</p>
          </div>

          {/* Aspect Ratio */}
          <div className="form-group">
            <label className="form-label">Aspect Ratio</label>
            <select 
              className="form-select"
              value={videoSettings.aspectRatio}
              onChange={(e) => handleVideoSettingChange('aspectRatio', e.target.value)}
            >
              <option value="16:9">16:9 (Landscape)</option>
              <option value="9:16">9:16 (Portrait)</option>
              <option value="1:1">1:1 (Square)</option>
              <option value="4:3">4:3 (Classic)</option>
            </select>
          </div>

          {/* Video Count */}
          <div className="form-group">
            <label className="form-label">Videos per Prompt</label>
            <select 
              className="form-select"
              value={videoSettings.count}
              onChange={(e) => handleVideoSettingChange('count', parseInt(e.target.value))}
            >
              <option value={1}>1 Video</option>
              <option value={2}>2 Videos</option>
              <option value={3}>3 Videos</option>
              <option value={4}>4 Videos</option>
            </select>
            <p className="form-help">More videos = longer processing time</p>
          </div>

          {/* Duration */}
          <div className="form-group">
            <label className="form-label">Video Duration</label>
            <select 
              className="form-select"
              value={videoSettings.duration}
              onChange={(e) => handleVideoSettingChange('duration', e.target.value)}
            >
              <option value="5s">5 seconds</option>
              <option value="10s">10 seconds</option>
              <option value="15s">15 seconds</option>
              <option value="30s">30 seconds</option>
            </select>
          </div>

          {/* Quality */}
          <div className="form-group">
            <label className="form-label">Video Quality</label>
            <select 
              className="form-select"
              value={videoSettings.quality}
              onChange={(e) => handleVideoSettingChange('quality', e.target.value)}
            >
              <option value="high">High Quality</option>
              <option value="medium">Medium Quality</option>
              <option value="low">Low Quality (Faster)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Automation Settings */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">⚙️ Automation Settings</h2>
          <p className="text-sm text-gray-600">Configure automation behavior and performance</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Timeout */}
          <div className="form-group">
            <label className="form-label">Render Timeout (minutes)</label>
            <input 
              type="number"
              className="form-input"
              value={automationSettings.timeout / 60000}
              onChange={(e) => handleAutomationSettingChange('timeout', parseInt(e.target.value) * 60000)}
              min="1"
              max="60"
            />
            <p className="form-help">Maximum time to wait for video rendering</p>
          </div>

          {/* Parallel Processing */}
          <div className="form-group">
            <label className="form-label">Parallel Jobs</label>
            <select 
              className="form-select"
              value={automationSettings.parallel}
              onChange={(e) => handleAutomationSettingChange('parallel', parseInt(e.target.value))}
            >
              <option value={1}>1 (Sequential)</option>
              <option value={2}>2 (Parallel)</option>
              <option value={3}>3 (Parallel)</option>
              <option value={4}>4 (Parallel)</option>
            </select>
            <p className="form-help">Number of videos to process simultaneously</p>
          </div>

          {/* Retry Attempts */}
          <div className="form-group">
            <label className="form-label">Retry Attempts</label>
            <input 
              type="number"
              className="form-input"
              value={automationSettings.retryAttempts}
              onChange={(e) => handleAutomationSettingChange('retryAttempts', parseInt(e.target.value))}
              min="0"
              max="10"
            />
            <p className="form-help">Number of retry attempts for failed renders</p>
          </div>

          {/* Headless Mode */}
          <div className="form-group">
            <label className="form-label">Browser Mode</label>
            <select 
              className="form-select"
              value={automationSettings.headless}
              onChange={(e) => handleAutomationSettingChange('headless', e.target.value === 'true')}
            >
              <option value={false}>Visible (Recommended for debugging)</option>
              <option value={true}>Headless (Faster)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 justify-end">
        <button 
          className="btn btn-outline"
          onClick={handleResetToDefaults}
        >
          Reset to Defaults
        </button>
        <button 
          className="btn btn-primary"
          onClick={handleSaveSettings}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}

export default Settings