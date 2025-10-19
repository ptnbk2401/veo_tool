/**
 * veo-settings-integration.js
 * Integration example for VEO3 Settings + Mode selection
 * Per: settingveo-unified-spec-with-diagram.md
 */

const { setGenerationMode } = require('./setting-mode');
const { SettingVEO } = require('./setting-veo');

/**
 * Configure VEO3 before prompt submission
 * This function should be called BEFORE fillPrompt() and submitPrompt()
 * 
 * @param {WebDriver} driver - Selenium WebDriver instance
 * @param {Object} settings - Configuration object
 * @param {string} [settings.mode] - Generation mode: "Text to Video" | "Frames to Video" | "Ingredients to Video"
 * @param {string} [settings.aspectRatio] - "Landscape (16:9)" | "Portrait (9:16)"
 * @param {number} [settings.outputs] - 1 | 2 | 3 | 4
 * @param {string} [settings.model] - "Veo 3.1 - Fast" | "Veo 3.1 - Quality" | "Veo 2 - Fast" | "Veo 2 - Quality"
 * @param {Object} logger - Logger instance
 * 
 * @example
 * await configureVEOSettings(driver, {
 *   mode: 'Frames to Video',
 *   aspectRatio: 'Portrait (9:16)',
 *   outputs: 3,
 *   model: 'Veo 3.1 - Quality'
 * }, logger);
 */
async function configureVEOSettings(driver, settings = {}, logger = console) {
  logger?.info?.('[VEO Config] Starting configuration...');

  // Step 1: Set Generation Mode (if specified)
  // This must be done FIRST as changing mode can reset the form
  if (settings.mode) {
    logger?.info?.(`[VEO Config] Setting mode: "${settings.mode}"`);
    await setGenerationMode(driver, settings.mode, logger);
  }

  // Step 2: Configure Settings Popover (Aspect Ratio, Outputs, Model)
  const hasSettings = settings.aspectRatio || settings.outputs || settings.model;
  if (hasSettings) {
    logger?.info?.('[VEO Config] Configuring settings popover...');
    await SettingVEO(driver, {
      aspectRatio: settings.aspectRatio,
      outputs: settings.outputs,
      model: settings.model
    }, logger);
  }

  logger?.info?.('[VEO Config] Configuration complete');
}

/**
 * Example: Full job execution with settings
 * This shows how to integrate settings into the main automation flow
 */
async function runJobWithSettings(driver, prompt, settings, logger = console) {
  try {
    logger?.info?.(`[Job] Starting job with prompt: "${prompt}"`);

    // Step 1: Ensure app is ready (existing function)
    // await ensureAppReady(driver);

    // Step 2: Configure VEO Settings (NEW - before prompt)
    await configureVEOSettings(driver, settings, logger);

    // Step 3: Fill prompt (existing function)
    // await fillPrompt(driver, prompt);

    // Step 4: Submit prompt (existing function)
    // await submitPrompt(driver);

    // Step 5: CDP intercept + DB tracking (existing function)
    // await monitorAndTrackWithCDP(driver);

    logger?.info?.('[Job] Job completed successfully');
  } catch (error) {
    logger?.error?.(`[Job] Job failed: ${error.message}`);
    throw error;
  }
}

/**
 * Validate settings object
 */
function validateSettings(settings) {
  const errors = [];

  // Validate mode
  if (settings.mode) {
    const validModes = ['Text to Video', 'Frames to Video', 'Ingredients to Video'];
    if (!validModes.includes(settings.mode)) {
      errors.push(`Invalid mode: "${settings.mode}". Must be one of: ${validModes.join(', ')}`);
    }
  }

  // Validate aspectRatio
  if (settings.aspectRatio) {
    const validRatios = ['Landscape (16:9)', 'Portrait (9:16)'];
    if (!validRatios.includes(settings.aspectRatio)) {
      errors.push(`Invalid aspectRatio: "${settings.aspectRatio}". Must be one of: ${validRatios.join(', ')}`);
    }
  }

  // Validate outputs
  if (settings.outputs !== undefined) {
    if (![1, 2, 3, 4].includes(settings.outputs)) {
      errors.push(`Invalid outputs: ${settings.outputs}. Must be 1, 2, 3, or 4`);
    }
  }

  // Validate model
  if (settings.model) {
    const validModels = [
      'Veo 3.1 - Fast',
      'Veo 3.1 - Quality',
      'Veo 2 - Fast',
      'Veo 2 - Quality'
    ];
    if (!validModels.includes(settings.model)) {
      errors.push(`Invalid model: "${settings.model}". Must be one of: ${validModels.join(', ')}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Settings validation failed:\n${errors.join('\n')}`);
  }

  return true;
}

/**
 * Get default settings
 */
function getDefaultSettings() {
  return {
    mode: 'Text to Video',
    aspectRatio: 'Landscape (16:9)',
    outputs: 1,
    model: 'Veo 3.1 - Fast'
  };
}

/**
 * Merge settings with defaults
 */
function mergeWithDefaults(settings = {}) {
  return {
    ...getDefaultSettings(),
    ...settings
  };
}

module.exports = {
  configureVEOSettings,
  runJobWithSettings,
  validateSettings,
  getDefaultSettings,
  mergeWithDefaults
};
