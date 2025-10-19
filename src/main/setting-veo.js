/**
 * setting-veo.js
 * Implements Settings Popover configuration for VEO3
 * Per: settingveo-unified-spec-with-diagram.md & settingveo-impl-spec.md
 */

const { By, Key, until } = require('selenium-webdriver');

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Scroll element to center of viewport
 */
async function scrollCenter(driver, el) {
  await driver.executeScript(
    "arguments[0].scrollIntoView({block:'center'});",
    el
  );
}

/**
 * Count visible listboxes in DOM
 */
async function countVisibleListboxes(driver) {
  return await driver.executeScript(() => {
    const els = Array.from(document.querySelectorAll("[role='listbox']"));
    return els.filter(el => {
      const s = getComputedStyle(el);
      return s.display !== 'none' &&
        s.visibility !== 'hidden' &&
        el.offsetParent !== null &&
        el.getAttribute('aria-hidden') !== 'true';
    }).length;
  });
}

/**
 * Wait for listbox portal to appear
 */
async function waitListbox(driver, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const list = await driver.findElements(
      By.xpath("//*[(@role='listbox') and not(@aria-hidden='true')]")
    );
    if (list.length && await list[0].isDisplayed()) {
      return list[0];
    }
    await driver.sleep(80);
  }
  throw new Error('[Settings] No visible listbox found');
}

/**
 * Get Settings Dialog (always refetch)
 */
async function getSettingsDialog(driver) {
  return await driver.wait(
    until.elementLocated(By.xpath("//*[(@role='dialog') and not(@aria-hidden='true')]")),
    5000,
    '[Settings] Dialog not found'
  );
}

/**
 * Get combobox by label (always refetch)
 */
async function getComboboxByLabel(driver, labelText) {
  const dialog = await getSettingsDialog(driver);
  const by = By.xpath(`.//button[@role='combobox' and .//span[normalize-space()='${labelText}']]`);
  const els = await dialog.findElements(by);
  if (!els.length) {
    throw new Error(`[Settings] Combobox "${labelText}" not found`);
  }
  return els[0];
}

/**
 * Ensure Settings Popover is open
 */
async function ensureSettingsOpen(driver, logger) {
  // Check if dialog already exists
  const dialogs = await driver.findElements(
    By.xpath("//*[(@role='dialog') and not(@aria-hidden='true')]")
  );
  if (dialogs.length) {
    logger?.info?.('[Settings] Popover already open');
    return dialogs[0];
  }

  logger?.info?.('[Settings] Opening popover...');
  const btn = await driver.wait(
    until.elementLocated(
      By.xpath("//button[@aria-haspopup='dialog' and .//span[normalize-space()='Settings']]")
    ),
    8000,
    '[Settings] Settings button not found'
  );
  await driver.wait(until.elementIsVisible(btn), 8000);
  await scrollCenter(driver, btn);
  await driver.sleep(300);

  // Use JavaScript click to avoid intercept
  await driver.executeScript("arguments[0].click();", btn);

  const dialog = await driver.wait(
    until.elementLocated(By.xpath("//*[(@role='dialog') and not(@aria-hidden='true')]")),
    5000,
    '[Settings] Dialog did not appear'
  );
  await driver.wait(until.elementIsVisible(dialog), 5000);
  logger?.info?.('[Settings] Popover opened');
  return dialog;
}

/**
 * Open combobox (refetch each time)
 */
async function openCombobox(driver, labelText, logger) {
  const comboBtn = await getComboboxByLabel(driver, labelText);
  await scrollCenter(driver, comboBtn);

  const before = await countVisibleListboxes(driver);

  logger?.info?.(`[Settings] Opening combobox "${labelText}"...`);
  // Use JavaScript click to avoid intercept
  await driver.executeScript("arguments[0].click();", comboBtn);

  await driver.wait(async () => {
    try {
      const expanded = await comboBtn.getAttribute('aria-expanded');
      if (expanded === 'true') return true;
    } catch (e) {
      // Ignore stale element
    }
    const now = await countVisibleListboxes(driver);
    return now > before;
  }, 3000, `[Settings] Timeout opening combobox "${labelText}"`);

  logger?.info?.(`[Settings] Combobox "${labelText}" opened`);
}

/**
 * Pick option by text in active listbox
 */
async function pickOptionByTextInActiveListbox(driver, valueText, logger) {
  const listbox = await waitListbox(driver);
  const lbRef = listbox; // Save ref for staleness check

  // Try exact match first
  const exact = await listbox.findElements(
    By.xpath(`.//*[@role='option' and .//span[normalize-space()="${valueText}"]]`)
  );
  let opt = exact[0];

  // Fallback to contains
  if (!opt) {
    const contains = await listbox.findElements(
      By.xpath(`.//*[@role='option' and .//span[contains(normalize-space(),"${valueText}")]]`)
    );
    opt = contains[0];
  }

  if (!opt) {
    // Last resort: type and Enter
    logger?.info?.(`[Settings] Fallback: typing "${valueText}" and Enter...`);
    try {
      const active = await driver.switchTo().activeElement();
      await active.sendKeys(valueText, Key.ENTER);
    } catch (e) {
      throw new Error(`[Settings] Option "${valueText}" not found`);
    }
  } else {
    await scrollCenter(driver, opt);
    await opt.click();
  }

  // Wait for listbox to disappear (re-render)
  try {
    await driver.wait(until.stalenessOf(lbRef), 2000);
  } catch (e) {
    // If not stale, that's ok
  }

  logger?.info?.(`[Settings] Picked "${valueText}"`);
}

/**
 * Verify combobox text (always refetch)
 */
async function verifyComboboxText(driver, labelText, expected, logger) {
  // Wait for UI to settle
  await driver.sleep(120);

  // Always refetch combobox
  const comboBtn = await getComboboxByLabel(driver, labelText);

  // Try reading text/innerText
  const shown = (await comboBtn.getText().catch(() => '')) || '';
  const inner = (await driver.executeScript(
    "return arguments[0].innerText || '';",
    comboBtn
  ).catch(() => '')) || '';

  if (shown.includes(expected) || inner.includes(expected)) {
    logger?.info?.(`[Settings][${labelText}] Verified "${expected}"`);
    return;
  }

  // Reopen listbox and check selected option
  logger?.warn?.(`[Settings][${labelText}] Text mismatch, reopening to verify...`);
  await openCombobox(driver, labelText, logger);
  const listbox = await waitListbox(driver);
  const selected = await listbox.findElements(
    By.xpath(`.//*[@role='option' and (@aria-selected='true' or @data-state='checked')]//span`)
  );

  if (selected.length) {
    const txt = (await selected[0].getText())?.trim() || '';

    // Close listbox
    try {
      await driver.actions().sendKeys(Key.ESCAPE).perform();
    } catch (e) {
      // Ignore
    }

    if (txt.includes(expected)) {
      logger?.info?.(`[Settings][${labelText}] Verified "${expected}" via aria-selected`);
      return;
    }
    throw new Error(
      `[Settings][${labelText}] Verify failed: expect "${expected}", got "${txt}"`
    );
  }
  throw new Error(
    `[Settings][${labelText}] Verify failed: combobox does not reflect "${expected}"`
  );
}

/**
 * Retry wrapper for stale element errors
 */
async function retryOnStale(fn, attempts = 2, delay = 200) {
  let err;
  for (let i = 0; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      if ((e && String(e).includes('stale element reference')) && i < attempts) {
        await sleep(delay);
        err = e;
        continue;
      }
      throw e;
    }
  }
  throw err;
}

/**
 * Set combobox by label
 */
async function setComboboxByLabel(driver, labelText, valueText, logger) {
  // 1) Open combobox
  await openCombobox(driver, labelText, logger);

  // 2) Pick option
  await pickOptionByTextInActiveListbox(driver, valueText, logger);

  // 3) Verify
  await verifyComboboxText(driver, labelText, valueText, logger);

  logger?.info?.(`[Settings] ${labelText} -> "${valueText}"`);
}

/**
 * SettingVEO - Main public API
 * Configure VEO3 Settings Popover (Aspect Ratio, Outputs per prompt, Model)
 * 
 * @param {WebDriver} driver - Selenium WebDriver instance
 * @param {Object} options - Settings to configure
 * @param {string} [options.aspectRatio] - "Landscape (16:9)" | "Portrait (9:16)"
 * @param {number} [options.outputs] - 1 | 2 | 3 | 4
 * @param {string} [options.model] - "Veo 3.1 - Fast" | "Veo 3.1 - Quality" | "Veo 2 - Fast" | "Veo 2 - Quality"
 * @param {Object} logger - Logger instance (optional)
 * @throws {Error} If any setting fails
 * 
 * @example
 * await SettingVEO(driver, {
 *   aspectRatio: 'Portrait (9:16)',
 *   outputs: 3,
 *   model: 'Veo 3.1 - Quality'
 * });
 */
async function SettingVEO(driver, { aspectRatio, outputs, model } = {}, logger = console) {
  logger?.info?.('[SettingVEO] Starting...');

  // Ensure popover is open
  await ensureSettingsOpen(driver, logger);

  // Set Aspect Ratio
  if (aspectRatio) {
    logger?.info?.(`[SettingVEO] Setting Aspect Ratio: "${aspectRatio}"`);
    await retryOnStale(() => setComboboxByLabel(driver, 'Aspect Ratio', aspectRatio, logger));
  }

  // Set Outputs per prompt
  if (typeof outputs !== 'undefined' && outputs !== null) {
    logger?.info?.(`[SettingVEO] Setting Outputs per prompt: ${outputs}`);
    await retryOnStale(() => setComboboxByLabel(driver, 'Outputs per prompt', String(outputs), logger));
  }

  // Set Model
  if (model) {
    logger?.info?.(`[SettingVEO] Setting Model: "${model}"`);
    await retryOnStale(() => setComboboxByLabel(driver, 'Model', model, logger));
  }

  logger?.info?.('[SettingVEO] Done');
}

/**
 * Backward compatibility functions
 */
async function setAspectRatio(driver, valueText, logger) {
  return await SettingVEO(driver, { aspectRatio: valueText }, logger);
}

async function setOutputsPerPrompt(driver, count, logger) {
  return await SettingVEO(driver, { outputs: count }, logger);
}

async function setModel(driver, modelText, logger) {
  return await SettingVEO(driver, { model: modelText }, logger);
}

module.exports = {
  // Main API
  SettingVEO,

  // Backward compatibility
  setAspectRatio,
  setOutputsPerPrompt,
  setModel,

  // Helpers (exported for testing)
  getSettingsDialog,
  getComboboxByLabel,
  ensureSettingsOpen,
  openCombobox,
  pickOptionByTextInActiveListbox,
  verifyComboboxText,
  retryOnStale,
  setComboboxByLabel
};
