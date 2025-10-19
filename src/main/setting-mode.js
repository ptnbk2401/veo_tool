/**
 * setting-mode.js
 * Implements Generation Mode selection for VEO3
 * Per: settingveo-unified-spec-with-diagram.md
 */

const { By, Key, until } = require('selenium-webdriver');

/**
 * Normalize text for comparison
 */
function norm(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
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
  throw new Error('[Mode] No visible listbox (portal) found');
}

/**
 * Open generation mode portal
 */
async function openModePortal(driver, comboBtn, logger) {
  await scrollCenter(driver, comboBtn);
  const before = await countVisibleListboxes(driver);

  logger?.info?.('[Mode] Opening portal...');
  await comboBtn.click();

  await driver.wait(async () => {
    const expanded = await comboBtn.getAttribute('aria-expanded');
    if (expanded === 'true') return true;
    const now = await countVisibleListboxes(driver);
    return now > before;
  }, 3000, '[Mode] Timeout opening generation-mode portal');

  logger?.info?.('[Mode] Portal opened');
}

/**
 * Find option in listbox by condition
 */
async function findOption(listboxEl, cond) {
  const by = By.xpath(`.//*[@role='option' and ${cond}]`);
  const els = await listboxEl.findElements(by);
  return els.length ? els[0] : null;
}

/**
 * Set Generation Mode
 * @param {WebDriver} driver - Selenium WebDriver instance
 * @param {string} modeText - Target mode: "Text to Video" | "Frames to Video" | "Ingredients to Video"
 * @param {Object} logger - Logger instance (optional)
 * @throws {Error} If mode selection fails
 */
async function setGenerationMode(driver, modeText, logger = console) {
  const target = norm(modeText);
  logger?.info?.(`[Mode] Setting Generation Mode: "${modeText}"`);

  // 1) Find combobox button
  const comboBtn = await driver.wait(
    until.elementLocated(By.xpath("//button[@role='combobox']")),
    8000,
    '[Mode] Combobox button not found'
  );
  await driver.wait(until.elementIsVisible(comboBtn), 8000);

  const currentText = await comboBtn.getText();
  logger?.info?.(`[Mode] Current mode: "${currentText}"`);

  // If already set, skip
  if (norm(currentText).includes(target)) {
    logger?.info?.(`[Mode] Already set to "${modeText}", skipping`);
    return;
  }

  // 2) Open portal
  await openModePortal(driver, comboBtn, logger);

  // 3) Select option
  logger?.info?.(`[Mode] Selecting option: "${modeText}"`);
  const listbox = await waitListbox(driver, 3000);

  // Try exact match first
  let option = await findOption(listbox, `normalize-space()="${modeText}"`);

  // Fallback to contains
  if (!option) {
    logger?.info?.('[Mode] Exact match not found, trying contains...');
    option = await findOption(listbox, `contains(normalize-space(),"${modeText}")`);
  }

  if (!option) {
    // Last resort: type and Enter
    logger?.info?.('[Mode] Fallback: typing text and Enter...');
    const active = await driver.switchTo().activeElement();
    await active.sendKeys(modeText, Key.ENTER);
  } else {
    await scrollCenter(driver, option);
    await option.click();
  }

  // 4) Verify
  logger?.info?.('[Mode] Verifying selection...');
  await driver.sleep(500);

  const textOnButton = await comboBtn.getText();
  const ok1 = norm(textOnButton).includes(target);

  if (ok1) {
    logger?.info?.(`[Mode] Verified "${modeText}"`);
    return;
  }

  // Reopen to check aria-selected
  logger?.warn?.(`[Mode] Button text mismatch: "${textOnButton}", reopening to verify...`);
  await openModePortal(driver, comboBtn, logger);
  const lb2 = await waitListbox(driver, 1500);
  const checked = await lb2.findElements(
    By.xpath(`.//*[@role='option' and @aria-selected='true']//span`)
  );

  if (checked.length) {
    const chosen = norm(await checked[0].getText());
    logger?.info?.(`[Mode] Selected option: "${chosen}"`);

    if (!chosen.includes(target)) {
      throw new Error(`[Mode] Verify failed: expected "${modeText}" but got "${chosen}"`);
    }
    logger?.info?.(`[Mode] Verified "${modeText}" via aria-selected`);
  } else {
    throw new Error(`[Mode] Verify failed: no selected option found`);
  }

  // Close portal
  try {
    await driver.actions().sendKeys(Key.ESCAPE).perform();
  } catch (e) {
    // Ignore
  }

  logger?.info?.(`[Mode] Picked "${modeText}"`);
}

module.exports = {
  setGenerationMode,
  // Helpers (exported for testing)
  norm,
  scrollCenter,
  countVisibleListboxes,
  waitListbox,
  openModePortal,
  findOption
};
