import React from "react";
import "./VeoSettings.css";

/**
 * VeoSettings Component - Simplified
 * UI for configuring VEO3 generation settings
 */
function VeoSettings({ settings, onChange, disabled = false }) {
  const handleChange = (field, value) => {
    onChange({
      ...settings,
      [field]: value,
    });
  };

  const handleSelectOutputFolder = async () => {
    try {
      const folderPath = await window.electronAPI.selectFolder();
      if (folderPath) {
        handleChange("outputDir", folderPath);
      }
    } catch (error) {
      console.error("Failed to select folder:", error);
    }
  };

  return (
    <div className="veo-settings">
      <div className="veo-settings-grid">
        {/* Generation Mode - Readonly */}
        <div className="veo-setting-item">
          <label htmlFor="veo-mode">Generation Mode:</label>
          <select
            id="veo-mode"
            value="Text to Video"
            disabled={true}
            className="readonly-select"
          >
            <option value="Text to Video">🎬 Text to Video</option>
          </select>
        </div>

        {/* Aspect Ratio */}
        <div className="veo-setting-item">
          <label htmlFor="veo-aspect-ratio">Aspect Ratio:</label>
          <select
            id="veo-aspect-ratio"
            value={settings.aspectRatio || "Landscape (16:9)"}
            onChange={(e) => handleChange("aspectRatio", e.target.value)}
            disabled={disabled}
          >
            <option value="Landscape (16:9)">📺 Landscape (16:9)</option>
            <option value="Portrait (9:16)">📱 Portrait (9:16)</option>
          </select>
        </div>

        {/* Outputs per Prompt */}
        <div className="veo-setting-item">
          <label htmlFor="veo-outputs">Outputs per Prompt:</label>
          <input
            id="veo-outputs"
            type="number"
            min="1"
            max="4"
            value={settings.outputs || 1}
            onChange={(e) =>
              handleChange("outputs", parseInt(e.target.value))
            }
            disabled={disabled}
          />
        </div>

        {/* Model Selection */}
        <div className="veo-setting-item">
          <label htmlFor="veo-model">Model:</label>
          <select
            id="veo-model"
            value={settings.model || "Veo 3.1 - Fast"}
            onChange={(e) => handleChange("model", e.target.value)}
            disabled={disabled}
          >
            <option value="Veo 3.1 - Fast">⚡ Veo 3.1 - Fast</option>
            <option value="Veo 3.1 - Quality">✨ Veo 3.1 - Quality</option>
            <option value="Veo 2 - Fast">⚡ Veo 2 - Fast</option>
            <option value="Veo 2 - Quality">✨ Veo 2 - Quality</option>
          </select>
        </div>
      </div>

      {/* Output Folder */}
      <div className="veo-output-folder">
        <label htmlFor="veo-output-dir">Output Folder:</label>
        <div className="veo-folder-input">
          <input
            id="veo-output-dir"
            type="text"
            value={settings.outputDir || "outputs"}
            onChange={(e) => handleChange("outputDir", e.target.value)}
            disabled={disabled}
            placeholder="outputs"
          />
          <button
            type="button"
            onClick={handleSelectOutputFolder}
            disabled={disabled}
            className="veo-browse-btn"
          >
            Browse
          </button>
        </div>
      </div>
    </div>
  );
}

export default VeoSettings;
