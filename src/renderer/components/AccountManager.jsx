import React, { useState } from 'react'
import { useAppStore } from '../store/app-store'

function AccountManager() {
  const { profiles, addProfile, removeProfile, testProfile } = useAppStore()
  const [isAddingProfile, setIsAddingProfile] = useState(false)
  const [newProfile, setNewProfile] = useState({ name: '', path: '' })
  const [testingProfiles, setTestingProfiles] = useState(new Set())
  const [availableProfiles, setAvailableProfiles] = useState([])
  const [loadingProfiles, setLoadingProfiles] = useState(false)
  const [editingProfile, setEditingProfile] = useState(null)
  const [editName, setEditName] = useState('')

  const handleAddProfile = async () => {
    if (!newProfile.name) {
      alert('Please enter a profile name')
      return
    }

    try {
      // Create a new Chrome profile by opening browser for login
      const profileData = {
        name: newProfile.name,
        // Let the backend handle profile creation and path
        createNew: true
      }
      
      await addProfile(profileData)
      setNewProfile({ name: '', path: '' })
      setIsAddingProfile(false)
    } catch (error) {
      alert(`Failed to add profile: ${error.message}`)
    }
  }

  const handleQuickLogin = async () => {
    if (!newProfile.name) {
      alert('Please enter a profile name first')
      return
    }

    try {
      // Open browser for login and create profile automatically
      const result = await window.electronAPI.profiles.createWithLogin({
        name: newProfile.name
      })
      
      if (result.success) {
        console.log('Profile created successfully:', result.profile)
        
        // Refresh the profiles list by calling initialize or manually adding to store
        const { initialize } = useAppStore.getState()
        await initialize() // This will reload all profiles from backend
        
        // Double check - get current profiles from store
        const { profiles: currentProfiles } = useAppStore.getState()
        console.log('Current profiles after initialize:', currentProfiles)
        
        setNewProfile({ name: '', path: '' })
        setIsAddingProfile(false)
        alert('Profile created successfully! You can now use it for automation.')
      }
    } catch (error) {
      alert(`Failed to create profile: ${error.message}`)
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

  const handleEditProfile = (profile) => {
    setEditingProfile(profile.id)
    setEditName(profile.name)
  }

  const handleSaveEdit = async (profileId) => {
    if (!editName.trim()) {
      alert('Profile name cannot be empty')
      return
    }

    try {
      // Call the backend to update profile name
      await window.electronAPI.profiles.update(profileId, { name: editName.trim() })
      
      // Refresh profiles list
      const { initialize } = useAppStore.getState()
      await initialize()
      
      // Reset editing state
      setEditingProfile(null)
      setEditName('')
    } catch (error) {
      alert(`Failed to update profile: ${error.message}`)
    }
  }

  const handleCancelEdit = () => {
    setEditingProfile(null)
    setEditName('')
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

  const handleDetectProfiles = async () => {
    setLoadingProfiles(true)
    try {
      const detected = await window.electronAPI.profiles.detectSystem()
      setAvailableProfiles(detected)
      setIsAddingProfile(true)
    } catch (error) {
      alert(`Failed to detect profiles: ${error.message}`)
    } finally {
      setLoadingProfiles(false)
    }
  }

  const handleSelectDetectedProfile = (detectedProfile) => {
    setNewProfile({
      name: detectedProfile.displayName || detectedProfile.name,
      path: detectedProfile.path
    })
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
          <div className="flex gap-2">
            <button 
              className="btn btn-primary"
              onClick={handleDetectProfiles}
              disabled={loadingProfiles}
            >
              {loadingProfiles ? 'Detecting...' : 'Detect Profiles'}
            </button>
            <button 
              className="btn btn-outline"
              onClick={() => setIsAddingProfile(true)}
            >
              Manual Add
            </button>
          </div>
        </div>

        {profiles.length === 0 ? (
          <div className="text-center text-gray-500">
            <p>No Chrome profiles added yet.</p>
            <p className="text-sm">Click "Detect Profiles" to automatically find Chrome profiles on your system.</p>
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
                    <td className="font-medium">
                      {editingProfile === profile.id ? (
                        <div className="flex gap-2 items-center">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="input input-sm"
                            placeholder="Profile name"
                            autoFocus
                          />
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => handleSaveEdit(profile.id)}
                          >
                            Save
                          </button>
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={handleCancelEdit}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        profile.name
                      )}
                    </td>
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
                          disabled={testingProfiles.has(profile.id) || editingProfile === profile.id}
                        >
                          {testingProfiles.has(profile.id) ? 'Testing...' : 'Test'}
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleEditProfile(profile)}
                          disabled={editingProfile !== null}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleRemoveProfile(profile.id)}
                          disabled={editingProfile === profile.id}
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
            <div className="text-sm text-gray-500 mt-2">
              Give your profile a memorable name
            </div>
          </div>

          <div className="bg-blue-50 p-4 rounded-lg mb-4">
            <h4 className="font-medium text-blue-900 mb-2">🚀 Quick Setup (Recommended)</h4>
            <p className="text-sm text-blue-700 mb-3">
              We'll open a browser window for you to login to VEO3, then automatically save your profile.
            </p>
            <button 
              className="btn btn-primary"
              onClick={handleQuickLogin}
              disabled={!newProfile.name}
            >
              Open Browser & Login
            </button>
          </div>

          <div className="text-center text-gray-400 mb-4">
            <span className="bg-white px-3">or</span>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <h4 className="font-medium text-gray-700 mb-2">📁 Manual Setup</h4>
            <p className="text-sm text-gray-600 mb-3">
              If you already have a Chrome profile with VEO3 login, you can browse to select it.
            </p>
            
            <div className="form-group mb-3">
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
            </div>

            <button 
              className="btn btn-secondary"
              onClick={handleAddProfile}
              disabled={!newProfile.name || !newProfile.path}
            >
              Add Existing Profile
            </button>
          </div>

          {availableProfiles.length > 0 && (
            <div className="bg-green-50 p-4 rounded-lg mt-4">
              <h4 className="font-medium text-green-900 mb-3">🔍 Detected Chrome Profiles</h4>
              <div className="space-y-2">
                {availableProfiles.map((profile, index) => (
                  <div 
                    key={index}
                    className="flex items-center justify-between p-3 bg-white rounded border cursor-pointer hover:bg-gray-50"
                    onClick={() => handleSelectDetectedProfile(profile)}
                  >
                    <div>
                      <div className="font-medium">{profile.displayName || profile.name}</div>
                      <div className="text-sm text-gray-500">{profile.path}</div>
                      {profile.hasAccounts && (
                        <div className="text-xs text-green-600">
                          {profile.accountCount} account(s) found
                        </div>
                      )}
                    </div>
                    <button 
                      className="btn btn-sm btn-primary"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleSelectDetectedProfile(profile)
                      }}
                    >
                      Select
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 mt-4">
            <button 
              className="btn btn-outline"
              onClick={() => {
                setIsAddingProfile(false)
                setAvailableProfiles([])
              }}
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