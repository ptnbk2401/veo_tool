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
      alert("Vui lòng nhập tên profile");
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
        `Profile "${profile.name}" đã được tạo thành công!\n\nBước tiếp theo: Đăng nhập Google Flow`,
      );
    } catch (error) {
      alert(`Không thể tạo profile: ${error.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleLoginProfile = async (profile) => {
    setIsLoggingIn(true);
    try {
      await window.electronAPI.openProfileForLogin(profile.id);
      alert(
        `Chrome đã mở với profile "${profile.name}".\n\n` +
          `Vui lòng:\n` +
          `1. Đăng nhập Google Flow (https://labs.google/fx/tools/flow)\n` +
          `2. Xác nhận bạn có thể truy cập Veo 3\n` +
          `3. Đóng Chrome khi hoàn tất\n\n` +
          `Session sẽ được lưu tự động.`,
      );
    } catch (error) {
      alert(`Không thể mở profile: ${error.message}`);
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
      !confirm(`Xóa profile "${profile.name}"?\n\nHành động này không thể hoàn tác.`)
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
      alert(`Không thể xóa profile: ${error.message}`);
    }
  };

  const handleTestProfile = async (profile) => {
    try {
      const result = await window.electronAPI.testProfile(profile.id);

      if (result.isValid) {
        alert(
          `Profile "${profile.name}" hợp lệ!\n\n` +
            `Trạng thái: ${result.status}\n` +
            `Session: ${result.hasSession ? "Đang hoạt động" : "Chưa đăng nhập"}`,
        );
      } else {
        alert(
          `Profile "${profile.name}" có vấn đề:\n\n` +
            `${result.error || "Vui lòng đăng nhập lại"}`,
        );
      }
    } catch (error) {
      alert(`Không thể kiểm tra profile: ${error.message}`);
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
          + Tạo Profile
        </button>
      </div>

      {profiles.length === 0 ? (
        <div className="empty-state">
          <p>Chưa có profile nào. Tạo profile để bắt đầu.</p>
          <button
            className="btn btn-primary"
            onClick={() => setShowCreateModal(true)}
          >
            Tạo Profile Đầu Tiên
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
                    <span className="badge-selected">✓ Đã chọn</span>
                  )}
                </div>
                <div className="profile-meta">
                  Tạo lúc: {new Date(profile.createdAt).toLocaleDateString('vi-VN')}
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
                  title="Đăng nhập vào profile này"
                >
                  🔐 Login
                </button>
                <button
                  className="btn btn-small btn-secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTestProfile(profile);
                  }}
                  title="Kiểm tra trạng thái profile"
                >
                  🧪 Test
                </button>
                <button
                  className="btn btn-small btn-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteProfile(profile);
                  }}
                  title="Xóa profile này"
                >
                  🗑️
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
            <h3>Tạo Profile Mới</h3>
            <p className="modal-description">
              Tạo một Chrome profile riêng biệt cho VEO3 automation. 
              Dữ liệu Chrome cá nhân của bạn sẽ không bị ảnh hưởng.
            </p>

            <div className="form-group">
              <label htmlFor="profileName">Tên Profile:</label>
              <input
                id="profileName"
                type="text"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="VD: Profile VEO3 của tôi"
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
                Hủy
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateProfile}
                disabled={isCreating || !newProfileName.trim()}
              >
                {isCreating ? "Đang tạo..." : "Tạo Profile"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProfileManager;
