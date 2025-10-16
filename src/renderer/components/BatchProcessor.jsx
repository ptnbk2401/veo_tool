import React, { useState } from 'react'
import { useAppStore } from '../store/app-store'

function BatchProcessor() {
  const { profiles, selectedProfile, setSelectedProfile, startJob } = useAppStore()
  const [csvFile, setCsvFile] = useState(null)
  const [csvData, setCsvData] = useState(null)
  const [jobName, setJobName] = useState('')
  const [outputFolder, setOutputFolder] = useState('./output')
  const [isProcessing, setIsProcessing] = useState(false)

  const handleFileSelect = async () => {
    try {
      const filePath = await window.electronAPI.fs.selectFile([
        { name: 'CSV Files', extensions: ['csv'] }
      ])
      
      if (filePath) {
        setCsvFile(filePath)
        
        // Load and validate CSV
        const result = await window.electronAPI.csv.load(filePath)
        setCsvData(result.data)
        
        // Auto-generate job name
        const fileName = filePath.split('/').pop().replace('.csv', '')
        setJobName(`Job - ${fileName} - ${new Date().toLocaleString()}`)
      }
    } catch (error) {
      alert(`Failed to load CSV: ${error.message}`)
    }
  }

  const handleSelectOutputFolder = async () => {
    try {
      const folderPath = await window.electronAPI.fs.selectFolder()
      if (folderPath) {
        setOutputFolder(folderPath)
      }
    } catch (error) {
      alert(`Failed to select folder: ${error.message}`)
    }
  }

  const handleStartJob = async () => {
    if (!csvFile || !selectedProfile) {
      alert('Please select a CSV file and Chrome profile')
      return
    }

    setIsProcessing(true)
    
    try {
      const jobConfig = {
        csvPath: csvFile,
        profileId: selectedProfile.id,
        jobName,
        automationConfig: {
          outputFolder,
          timeout: 600000,
          retryAttempts: 3
        }
      }

      await startJob(jobConfig)
      
      // Reset form
      setCsvFile(null)
      setCsvData(null)
      setJobName('')
      
      alert('Job started successfully!')
    } catch (error) {
      alert(`Failed to start job: ${error.message}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const getStatusCounts = () => {
    if (!csvData) return null
    
    const counts = {
      pending: 0,
      rendering: 0,
      done: 0,
      error: 0
    }
    
    csvData.forEach(row => {
      counts[row.Status] = (counts[row.Status] || 0) + 1
    })
    
    return counts
  }

  const statusCounts = getStatusCounts()

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Batch Processing</h2>
        </div>

        <div className="form-group">
          <label className="form-label">Chrome Profile</label>
          <select 
            className="form-select"
            value={selectedProfile?.id || ''}
            onChange={(e) => {
              const profile = profiles.find(p => p.id === e.target.value)
              setSelectedProfile(profile)
            }}
          >
            <option value="">Select a Chrome profile...</option>
            {profiles.map(profile => (
              <option key={profile.id} value={profile.id}>
                {profile.name} ({profile.sessionStatus})
              </option>
            ))}
          </select>
          {profiles.length === 0 && (
            <div className="text-sm text-gray-500 mt-2">
              No profiles available. Please add a Chrome profile first.
            </div>
          )}
        </div>

        <div className="form-group">
          <label className="form-label">CSV File</label>
          <div className="flex gap-2">
            <input
              type="text"
              className="form-input"
              placeholder="Select CSV file..."
              value={csvFile || ''}
              readOnly
            />
            <button 
              className="btn btn-outline"
              onClick={handleFileSelect}
            >
              Browse
            </button>
          </div>
          <div className="text-sm text-gray-500 mt-2">
            CSV should contain columns: ID, Prompt, Flow_URL, Status
          </div>
        </div>

        {csvData && (
          <div className="mb-4">
            <h4 className="font-medium mb-2">CSV Preview</h4>
            <div className="bg-gray-50 p-3 rounded border">
              <div className="flex gap-4 mb-2">
                <span className="text-sm">Total: {csvData.length}</span>
                {statusCounts && (
                  <>
                    <span className="text-sm">Pending: {statusCounts.pending}</span>
                    <span className="text-sm">Done: {statusCounts.done}</span>
                    <span className="text-sm">Error: {statusCounts.error}</span>
                  </>
                )}
              </div>
              <div className="text-sm text-gray-600">
                Sample: {csvData[0]?.Prompt?.substring(0, 100)}...
              </div>
            </div>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Job Name</label>
          <input
            type="text"
            className="form-input"
            placeholder="Enter job name..."
            value={jobName}
            onChange={(e) => setJobName(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Output Folder</label>
          <div className="flex gap-2">
            <input
              type="text"
              className="form-input"
              value={outputFolder}
              onChange={(e) => setOutputFolder(e.target.value)}
            />
            <button 
              className="btn btn-outline"
              onClick={handleSelectOutputFolder}
            >
              Browse
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            className="btn btn-primary"
            onClick={handleStartJob}
            disabled={!csvFile || !selectedProfile || isProcessing}
          >
            {isProcessing ? 'Starting...' : 'Start Job'}
          </button>
          
          {csvFile && (
            <button
              className="btn btn-outline"
              onClick={() => {
                setCsvFile(null)
                setCsvData(null)
                setJobName('')
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <h3 className="card-title">CSV Format Guide</h3>
        </div>
        
        <div className="text-sm">
          <p className="mb-2">Your CSV file should have these columns:</p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li><strong>ID</strong>: Unique identifier for each video</li>
            <li><strong>Prompt</strong>: Description for video generation</li>
            <li><strong>Flow_URL</strong>: VEO Flow project URL</li>
            <li><strong>Status</strong>: pending, rendering, done, or error</li>
          </ul>
          
          <div className="mt-3 p-3 bg-gray-50 rounded">
            <p className="font-medium mb-1">Example CSV:</p>
            <pre className="text-xs">
{`ID,Prompt,Flow_URL,Status
1,"A cat playing with a ball","https://labs.google/fx/tools/flow","pending"
2,"Sunset over mountains","https://labs.google/fx/tools/flow","pending"`}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BatchProcessor