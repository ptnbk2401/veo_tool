import React, { useState } from 'react'
import { useAppStore } from '../store/app-store'

function AccountManager() {
  const { profiles, addProfile, removeProfile, testProfile } = useAppStore()
  const [isAddingProfile, setIsAddingProfile] = useState(false)
  const [newProfile, setNewProfile] = useState({ name: '', path: '' })
  const [testingProfiles, setTestingProfiles] = useState(new Set())

  const handleAddProfile = async () => {
    if (!newProfile.name || !newProfile.path) {
      alert('Please fill in both name and path')
      return
    }

    try {
      await addProfile(newProfile)
      setNewProfile({ name: '', path: '' })
      setIsAddingProfile(false)
    } catch (error) {
      alert(`Failed to add profile: ${error.message}`)
    }
  }

  const handleRemoveProfile = async (profileId) => {
    if (confirm('Are you sure you want to remove this profile?')) {
      try {
        await removeProfile(profileId)
      } catch (error) {
        alert(`Failed to remove profile: ${error.message}`)
      }
    }
  }

  const handleTestProfile = async (profileId) => {
    setTestingProfiles(prev => new Set([...prev, profileId]))
    
    try {
      const result = await testProfile(profileId)
      alert(`Test result: ${result.isLoggedIn ? 'Logged in' : 'Not logged in'}\nStatus: ${result.sessionStatus}`)
    } catch (error) {
      alert(`Test failed: ${error.message}`)
    } finally {
      setTestingProfiles(prev => {
        const newSet = new Set(prev)
        newSet.delete(profileId)
        return newSet
      })
    }
  }

  const handleSelectFolder = async () => {
    try {
      const folderPath = await window.electronAPI.fs.selectFolder()
      if (folderPath) {
        setNewProfile(prev => ({ ...prev, path: folderPath }))
      }
    } catch (error) {
      alert(`Failed to select folder: ${error.message}`)
    }
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'valid': return 'status-success'
      case 'expired': return 'status-warning'
      case 'error': return 'status-error'
      default: return 'status-info'
    }
  }

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Chrome Profiles</h2>
          <button 
            className="btn btn-primary"
            onClick={() => setIsAddingProfile(true)}
          >
            Add Profile
          </button>
        </div>

        {profiles.length === 0 ? (
          <div className="text-center text-gray-500">
            <p>No Chrome profiles added yet.</p>
            <p className="text-sm">Add a Chrome profile to get started with automation.</p>
          </div>
        ) : (
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Path</th>
                  <th>Status</th>
                  <th>Last Check</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map(profile => (
                  <tr key={profile.id}>
                    <td className="font-medium">{profile.name}</td>
                    <td className="text-sm text-gray-500" title={profile.path}>
                      {profile.path.length > 50 
                        ? `...${profile.path.slice(-50)}` 
                        : profile.path
                      }
                    </td>
                    <td>
                      <span className={`status ${getStatusColor(profile.sessionStatus)}`}>
                        {profile.sessionStatus || 'unknown'}
                      </span>
                    </td>
                    <td className="text-sm text-gray-500">
                      {profile.lastSessionCheck 
                        ? new Date(profile.lastSessionCheck).toLocaleString()
                        : 'Never'
                      }
                    </td>
                    <td>
                      <div className="flex gap-2">
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => handleTestProfile(profile.id)}
                          disabled={testingProfiles.has(profile.id)}
                        >
                          {testingProfiles.has(profile.id) ? 'Testing...' : 'Test'}
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleRemoveProfile(profile.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isAddingProfile && (
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Add New Profile</h3>
            <button 
              className="btn btn-outline"
              onClick={() => setIsAddingProfile(false)}
            >
              Cancel
            </button>
          </div>

          <div className="form-group">
            <label className="form-label">Profile Name</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g., My VEO Profile"
              value={newProfile.name}
              onChange={(e) => setNewProfile(prev => ({ ...prev, name: e.target.value }))}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Chrome Profile Path</label>
            <div className="flex gap-2">
              <input
                type="text"
                className="form-input"
                placeholder="Select Chrome profile folder..."
                value={newProfile.path}
                onChange={(e) => setNewProfile(prev => ({ ...prev, path: e.target.value }))}
              />
              <button 
                className="btn btn-outline"
                onClick={handleSelectFolder}
              >
                Browse
              </button>
            </div>
            <div className="text-sm text-gray-500 mt-2">
              <p>Common Chrome profile locations:</p>
              <p>• macOS: ~/Library/Application Support/Google/Chrome/Default</p>
              <p>• Windows: %LOCALAPPDATA%\Google\Chrome\User Data\Default</p>
              <p>• Linux: ~/.config/google-chrome/Default</p>
            </div>
          </div>

          <div className="flex gap-2">
            <button 
              className="btn btn-primary"
              onClick={handleAddProfile}
            >
              Add Profile
            </button>
            <button 
              className="btn btn-outline"
              onClick={() => setIsAddingProfile(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default AccountManager