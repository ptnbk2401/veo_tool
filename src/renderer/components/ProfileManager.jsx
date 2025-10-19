import React, { useState, useEffect } from "react";
import "./ProfileManager.css";

function ProfileManager({ onProfileSelected }) {
  const [profiles, setProfiles] = useState([]);
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Load profiles on mount
  useEffect(() => {
    loadProfiles();
  }, []);

  const loadProfiles = async () => {
    try {
      const profilesList = await window.electronAPI.listProfiles();
      setProfiles(profilesList);

      // Auto-select first profile if available
      if (profilesList.length > 0 && !selectedProfile) {
        setSelectedProfile(profilesList[0]);
        onProfileSelected(profilesList[0]);
      }
    } catch (error) {
      console.error("Failed to load profiles:", error);
    }
  };

  const handleCreateProfile = async () => {
    if (!newProfileName.trim()) {
      alert("Please enter a profile name");
      return;
    }

    setIsCreating(true);
    try {
      const profile = await window.electronAPI.createProfile({
        name: newProfileName.trim(),
      });

      setProfiles([...profiles, profile]);
      setNewProfileName("");
      setShowCreateModal(false);
      alert(
        `Profile "${profile.name}" created successfully!\n\nNext step: Login to Google Flow`,
      );
    } catch (error) {
      alert(`Failed to create profile: ${error.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleLoginProfile = async (profile) => {
    setIsLoggingIn(true);
    try {
      await window.electronAPI.openProfileForLogin(profile.id);
      alert(
        `Chrome opened with profile "${profile.name}".\n\n` +
          `Please:\n` +
          `1. Login to Google Flow (https://labs.google/fx/tools/flow)\n` +
          `2. Verify you can access Veo 3\n` +
          `3. Close Chrome when done\n\n` +
          `The session will be saved automatically.`,
      );
    } catch (error) {
      alert(`Failed to open profile: ${error.message}`);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSelectProfile = (profile) => {
    setSelectedProfile(profile);
    onProfileSelected(profile);
  };

  const handleDeleteProfile = async (profile) => {
    if (
      !confirm(`Delete profile "${profile.name}"?\n\nThis cannot be undone.`)
    ) {
      return;
    }

    try {
      await window.electronAPI.deleteProfile(profile.id);
      setProfiles(profiles.filter((p) => p.id !== profile.id));

      if (selectedProfile?.id === profile.id) {
        const newSelected = profiles.find((p) => p.id !== profile.id);
        setSelectedProfile(newSelected || null);
        onProfileSelected(newSelected || null);
      }
    } catch (error) {
      alert(`Failed to delete profile: ${error.message}`);
    }
  };

  const handleTestProfile = async (profile) => {
    try {
      const result = await window.electronAPI.testProfile(profile.id);

      if (result.isValid) {
        alert(
          `Profile "${profile.name}" is valid!\n\n` +
            `Status: ${result.status}\n` +
            `Session: ${result.hasSession ? "Active" : "Not logged in"}`,
        );
      } else {
        alert(
          `Profile "${profile.name}" has issues:\n\n` +
            `${result.error || "Please login again"}`,
        );
      }
    } catch (error) {
      alert(`Failed to test profile: ${error.message}`);
    }
  };

  return (
    <div className="profile-manager">
      <div className="profile-header">
        <h2>Chrome Profiles</h2>
        <button
          className="btn btn-primary"
          onClick={() => setShowCreateModal(true)}
        >
          + New Profile
        </button>
      </div>

      {profiles.length === 0 ? (
        <div className="empty-state">
          <p>No profiles yet. Create one to get started.</p>
          <button
            className="btn btn-primary"
            onClick={() => setShowCreateModal(true)}
          >
            Create First Profile
          </button>
        </div>
      ) : (
        <div className="profiles-list">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className={`profile-card ${selectedProfile?.id === profile.id ? "selected" : ""}`}
              onClick={() => handleSelectProfile(profile)}
            >
              <div className="profile-info">
                <div className="profile-name">
                  {profile.name}
                  {selectedProfile?.id === profile.id && (
                    <span className="badge-selected">Selected</span>
                  )}
                </div>
                <div className="profile-path">{profile.path}</div>
                <div className="profile-meta">
                  Created: {new Date(profile.createdAt).toLocaleDateString()}
                </div>
              </div>

              <div className="profile-actions">
                <button
                  className="btn btn-small btn-secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleLoginProfile(profile);
                  }}
                  disabled={isLoggingIn}
                >
                  🔐 Login
                </button>
                <button
                  className="btn btn-small btn-secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTestProfile(profile);
                  }}
                >
                  🧪 Test
                </button>
                <button
                  className="btn btn-small btn-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteProfile(profile);
                  }}
                >
                  🗑️ Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Profile Modal */}
      {showCreateModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowCreateModal(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create New Profile</h3>
            <p className="modal-description">
              This will create a new isolated Chrome profile for VEO3
              automation. Your personal Chrome data will not be affected.
            </p>

            <div className="form-group">
              <label htmlFor="profileName">Profile Name:</label>
              <input
                id="profileName"
                type="text"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="e.g., My VEO3 Profile"
                autoFocus
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    handleCreateProfile();
                  }
                }}
              />
            </div>

            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowCreateModal(false)}
                disabled={isCreating}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateProfile}
                disabled={isCreating || !newProfileName.trim()}
              >
                {isCreating ? "Creating..." : "Create Profile"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProfileManager;
