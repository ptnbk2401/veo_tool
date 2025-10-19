/**
 * Script chuyên dụng để lấy DOM HTML từ Google Labs Flow
 * URL: https://labs.google/fx/tools/flow/project/4e776dda-aaa1-4101-9f04-dda63deee299
 */

const { Builder, By, until, Key } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const fs = require('fs-extra');
const path = require('path');

class GoogleFlowExtractor {
  constructor(config = {}) {
    this.config = {
      url: config.url || 'https://labs.google/fx/tools/flow/project/4e776dda-aaa1-4101-9f04-dda63deee299',
      outputDir: config.outputDir || './output/google-flow-dom',
      timeout: config.timeout || 60000,
      headless: config.headless || false,
      profilePath: config.profilePath || null,
      ...config
    };
    this.driver = null;
  }

  /**
   * Khởi tạo driver
   */
  async init() {
    const options = new chrome.Options();

    if (this.config.headless) {
      options.addArguments('--headless=new');
    }

    if (this.config.profilePath) {
      options.addArguments(`--user-data-dir=${this.config.profilePath}`);
    }

    options.addArguments('--disable-blink-features=AutomationControlled');
    options.addArguments('--no-sandbox');
    options.addArguments('--disable-dev-shm-usage');
    options.addArguments('--window-size=1920,1080');

    this.driver = await new Builder()
      .forBrowser('chrome')
      .setChromeOptions(options)
      .build();

    console.log('✓ Driver đã khởi tạo');
  }

  /**
   * Truy cập URL
   */
  async navigate(url = null) {
    const targetUrl = url || this.config.url;
    await this.driver.get(targetUrl);
    console.log(`✓ Đã truy cập: ${targetUrl}`);
  }

  /**
   * Chờ element xuất hiện
   */
  async waitForElement(selector, type = 'css', timeout = null) {
    const waitTime = timeout || this.config.timeout;
    try {
      let locator;
      switch (type) {
        case 'css':
          locator = By.css(selector);
          break;
        case 'xpath':
          locator = By.xpath(selector);
          break;
        case 'id':
          locator = By.id(selector);
          break;
        default:
          locator = By.css(selector);
      }

      await this.driver.wait(until.elementLocated(locator), waitTime);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Lưu kết quả vào file
   */
  async saveResults(data, filename) {
    try {
      await fs.ensureDir(this.config.outputDir);
      const filepath = path.join(this.config.outputDir, filename);

      if (typeof data === 'string') {
        await fs.writeFile(filepath, data, 'utf-8');
      } else {
        await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf-8');
      }

      console.log(`✓ Đã lưu: ${filepath}`);
      return filepath;
    } catch (error) {
      console.error(`❌ Lỗi khi lưu file:`, error.message);
      return null;
    }
  }

  /**
   * Đóng driver
   */
  async close() {
    if (this.driver) {
      await this.driver.quit();
      console.log('✓ Đã đóng browser');
    }
  }

  /**
   * Lấy tất cả Shadow DOM
   */
  async extractAllShadowDOM() {
    try {
      const shadowDOMs = await this.driver.executeScript(`
        const results = [];
        const allElements = document.querySelectorAll('*');
        
        allElements.forEach((element, index) => {
          if (element.shadowRoot) {
            results.push({
              hostSelector: element.tagName.toLowerCase() + 
                           (element.id ? '#' + element.id : '') +
                           (element.className ? '.' + element.className.split(' ').join('.') : ''),
              shadowHTML: element.shadowRoot.innerHTML,
              index: index
            });
          }
        });
        
        return results;
      `);

      return shadowDOMs;
    } catch (error) {
      console.error('❌ Lỗi khi lấy Shadow DOM:', error.message);
      return [];
    }
  }

  /**
   * Lấy Portal HTML
   */
  async extractPortalHTML(portalSelector = '[data-portal], [role="dialog"], .portal') {
    try {
      const portalHTML = await this.driver.executeScript(`
        const portals = document.querySelectorAll('${portalSelector}');
        const results = [];
        
        portals.forEach((portal, index) => {
          results.push({
            index: index,
            html: portal.outerHTML,
            selector: portal.tagName.toLowerCase() + 
                     (portal.id ? '#' + portal.id : '') +
                     (portal.className ? '.' + portal.className.split(' ').join('.') : ''),
            attributes: Array.from(portal.attributes).map(attr => ({
              name: attr.name,
              value: attr.value
            }))
          });
        });
        
        return results;
      `);

      return portalHTML;
    } catch (error) {
      console.error('❌ Lỗi khi lấy Portal HTML:', error.message);
      return [];
    }
  }

  /**
   * Lấy Modal/Dialog HTML
   */
  async extractModalHTML() {
    const modalSelectors = [
      '[role="dialog"]',
      '[role="alertdialog"]',
      '.modal',
      '.dialog',
      '[data-modal]',
      '[aria-modal="true"]'
    ];

    const results = [];

    for (const selector of modalSelectors) {
      try {
        const elements = await this.driver.findElements(By.css(selector));
        for (const element of elements) {
          const html = await this.driver.executeScript(
            'return arguments[0].outerHTML;',
            element
          );
          const isVisible = await element.isDisplayed();

          results.push({
            selector,
            html,
            isVisible
          });
        }
      } catch (error) {
        // Bỏ qua
      }
    }

    return results;
  }

  /**
   * Chờ Google Flow app load xong
   */
  async waitForFlowApp() {
    console.log('⏳ Đợi Google Flow app load...');

    // Chờ các selectors có thể có của Google Flow
    const possibleSelectors = [
      'body',
      '[role="main"]',
      '[data-flow]',
      '.flow-container',
      '#root',
      '[class*="flow"]',
      '[class*="project"]'
    ];

    for (const selector of possibleSelectors) {
      try {
        const found = await this.waitForElement(selector, 'css', 5000);
        if (found) {
          console.log(`✓ Tìm thấy element: ${selector}`);
        }
      } catch (error) {
        // Tiếp tục thử selector khác
      }
    }

    // Chờ thêm để đảm bảo dynamic content load
    await this.driver.sleep(5000);
    console.log('✓ App đã load xong');
  }

  /**
   * Lấy tất cả Web Components (Google thường dùng Web Components)
   */
  async extractWebComponents() {
    try {
      console.log('🔍 Tìm Web Components...');

      const components = await this.driver.executeScript(`
        const results = [];
        const allElements = document.querySelectorAll('*');
        
        allElements.forEach((element, index) => {
          const tagName = element.tagName.toLowerCase();
          
          // Tìm custom elements (có dấu gạch ngang)
          if (tagName.includes('-')) {
            results.push({
              tagName: tagName,
              html: element.outerHTML,
              hasShadowRoot: !!element.shadowRoot,
              shadowHTML: element.shadowRoot ? element.shadowRoot.innerHTML : null,
              attributes: Array.from(element.attributes).map(attr => ({
                name: attr.name,
                value: attr.value
              })),
              index: index
            });
          }
        });
        
        return results;
      `);

      console.log(`✓ Tìm thấy ${components.length} Web Components`);
      return components;
    } catch (error) {
      console.error('❌ Lỗi khi lấy Web Components:', error.message);
      return [];
    }
  }

  /**
   * Lấy tất cả elements có data attributes (Google thường dùng)
   */
  async extractDataElements() {
    try {
      console.log('🔍 Tìm elements với data attributes...');

      const dataElements = await this.driver.executeScript(`
        const results = [];
        const allElements = document.querySelectorAll('[data-*]');
        
        // Tìm tất cả elements có data-* attributes
        document.querySelectorAll('*').forEach((element, index) => {
          const dataAttrs = Array.from(element.attributes)
            .filter(attr => attr.name.startsWith('data-'));
          
          if (dataAttrs.length > 0) {
            results.push({
              tagName: element.tagName.toLowerCase(),
              html: element.outerHTML.substring(0, 1000), // Giới hạn để tránh quá lớn
              dataAttributes: dataAttrs.map(attr => ({
                name: attr.name,
                value: attr.value
              })),
              id: element.id,
              className: element.className,
              index: index
            });
          }
        });
        
        return results;
      `);

      console.log(`✓ Tìm thấy ${dataElements.length} elements với data attributes`);
      return dataElements;
    } catch (error) {
      console.error('❌ Lỗi khi lấy data elements:', error.message);
      return [];
    }
  }

  /**
   * Lấy React/Vue component structure
   */
  async extractComponentStructure() {
    try {
      console.log('🔍 Phân tích component structure...');

      const structure = await this.driver.executeScript(`
        const results = {
          hasReact: false,
          hasVue: false,
          hasAngular: false,
          rootElements: [],
          componentCount: 0
        };
        
        // Check React
        const rootElement = document.querySelector('#root, [data-reactroot]');
        if (rootElement || window.React) {
          results.hasReact = true;
        }
        
        // Check Vue
        if (window.Vue || document.querySelector('[data-v-]')) {
          results.hasVue = true;
        }
        
        // Check Angular
        if (window.ng || document.querySelector('[ng-version]')) {
          results.hasAngular = true;
        }
        
        // Đếm components
        results.componentCount = document.querySelectorAll('[class*="component"], [class*="Component"]').length;
        
        // Lấy root elements
        const roots = document.querySelectorAll('#root, #app, [data-app], main, [role="main"]');
        roots.forEach(root => {
          results.rootElements.push({
            tagName: root.tagName.toLowerCase(),
            id: root.id,
            className: root.className
          });
        });
        
        return results;
      `);

      console.log('✓ Component structure:', structure);
      return structure;
    } catch (error) {
      console.error('❌ Lỗi khi phân tích structure:', error.message);
      return null;
    }
  }

  /**
   * Lấy tất cả interactive elements (buttons, inputs, etc.)
   */
  async extractInteractiveElements() {
    try {
      console.log('🔍 Tìm interactive elements...');

      const interactive = await this.driver.executeScript(`
        const results = {
          buttons: [],
          inputs: [],
          selects: [],
          textareas: [],
          links: []
        };
        
        // Buttons
        document.querySelectorAll('button, [role="button"]').forEach((btn, i) => {
          results.buttons.push({
            index: i,
            text: btn.textContent.trim().substring(0, 100),
            html: btn.outerHTML.substring(0, 500),
            attributes: Array.from(btn.attributes).map(a => ({name: a.name, value: a.value}))
          });
        });
        
        // Inputs
        document.querySelectorAll('input').forEach((input, i) => {
          results.inputs.push({
            index: i,
            type: input.type,
            name: input.name,
            placeholder: input.placeholder,
            html: input.outerHTML
          });
        });
        
        // Selects
        document.querySelectorAll('select').forEach((select, i) => {
          results.selects.push({
            index: i,
            name: select.name,
            options: Array.from(select.options).map(o => o.text),
            html: select.outerHTML
          });
        });
        
        // Textareas
        document.querySelectorAll('textarea').forEach((ta, i) => {
          results.textareas.push({
            index: i,
            name: ta.name,
            placeholder: ta.placeholder,
            html: ta.outerHTML
          });
        });
        
        // Links
        document.querySelectorAll('a[href]').forEach((link, i) => {
          if (i < 50) { // Giới hạn 50 links
            results.links.push({
              index: i,
              text: link.textContent.trim().substring(0, 100),
              href: link.href,
              html: link.outerHTML.substring(0, 300)
            });
          }
        });
        
        return results;
      `);

      console.log(`✓ Tìm thấy: ${interactive.buttons.length} buttons, ${interactive.inputs.length} inputs`);
      return interactive;
    } catch (error) {
      console.error('❌ Lỗi khi lấy interactive elements:', error.message);
      return null;
    }
  }

  /**
   * Chụp screenshot
   */
  async takeScreenshot(filename = 'screenshot.png') {
    try {
      const screenshot = await this.driver.takeScreenshot();
      const filepath = path.join(this.config.outputDir, filename);
      await fs.ensureDir(this.config.outputDir);
      await fs.writeFile(filepath, screenshot, 'base64');
      console.log(`✓ Đã chụp screenshot: ${filepath}`);
      return filepath;
    } catch (error) {
      console.error('❌ Lỗi khi chụp screenshot:', error.message);
      return null;
    }
  }

  // ===== Settings Popover BASE =====

  /**
   * Mở Settings Popover
   */
  async openSettingsPopover() {
    try {
      console.log('🔍 Tìm button Settings...');

      // Nút "tune" có sr-only "Settings"
      const btn = await this.driver.wait(
        until.elementLocated(
          By.xpath("//button[@aria-haspopup='dialog' and .//span[normalize-space()='Settings']]")
        ),
        8000
      );
      await this.driver.wait(until.elementIsVisible(btn), 8000);

      console.log('✓ Tìm thấy button Settings, đang click...');
      await this.driver.executeScript("arguments[0].scrollIntoView({block:'center'});", btn);

      // Chờ một chút để scroll hoàn thành
      await this.driver.sleep(500);

      // Dùng JavaScript click để tránh bị intercept
      await this.driver.executeScript("arguments[0].click();", btn);

      // Đợi role=dialog (popover) xuất hiện
      const dialog = await this.driver.wait(
        until.elementLocated(By.xpath("//*[(@role='dialog') and not(@aria-hidden='true')]")),
        5000
      );
      await this.driver.wait(until.elementIsVisible(dialog), 5000);

      console.log('✓ Settings popover đã mở');
      return dialog;
    } catch (error) {
      console.error('❌ Lỗi khi mở Settings popover:', error.message);
      throw error;
    }
  }

  /**
   * Đảm bảo Settings đã mở
   */
  async ensureSettingsOpen() {
    const exists = await this.driver.findElements(
      By.xpath("//*[(@role='dialog') and not(@aria-hidden='true')]")
    );
    if (exists.length) return exists[0];
    return await this.openSettingsPopover();
  }

  /**
   * Tìm combobox theo nhãn hiển thị trong dialog Settings
   */
  async findLabeledCombobox(dialog, labelText) {
    const by = By.xpath(
      `.//button[@role='combobox' and .//span[normalize-space()='${labelText}']]`
    );
    const els = await dialog.findElements(by);
    if (!els.length) throw new Error(`Không thấy combobox "${labelText}"`);
    return els[0];
  }

  /**
   * Đếm số listbox đang hiển thị
   */
  async countVisibleListboxes() {
    return await this.driver.executeScript(function () {
      return Array.from(document.querySelectorAll("[role='listbox']")).filter(el => {
        const s = getComputedStyle(el);
        return s.display !== 'none' &&
          s.visibility !== 'hidden' &&
          el.offsetParent !== null &&
          el.getAttribute('aria-hidden') !== 'true';
      }).length;
    });
  }

  /**
   * Mở combobox và dump nội dung listbox
   */
  async openComboboxAndDump(labelText, fileName) {
    try {
      console.log(`🔍 Dump combobox: "${labelText}"...`);

      const dialog = await this.ensureSettingsOpen();

      // 1) Mở combobox theo nhãn
      const combo = await this.findLabeledCombobox(dialog, labelText);
      await this.driver.executeScript("arguments[0].scrollIntoView({block:'center'});", combo);
      await this.driver.sleep(300);

      const before = await this.countVisibleListboxes();

      // Dùng JavaScript click để tránh bị intercept
      await this.driver.executeScript("arguments[0].click();", combo);

      // 2) Chờ listbox (portal) xuất hiện
      await this.driver.wait(async () => {
        const expanded = await combo.getAttribute('aria-expanded');
        if (expanded === 'true') return true;
        const now = await this.countVisibleListboxes();
        return now > before;
      }, 3000);

      // 3) Dump nội dung listbox lớn nhất đang hiển thị
      const dump = await this.driver.executeScript(function (labelText) {
        const boxes = Array.from(
          document.querySelectorAll("[role='listbox']:not([aria-hidden='true'])")
        ).filter(el => {
          const s = getComputedStyle(el);
          return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetParent !== null;
        });

        if (!boxes.length) return null;

        // Lấy listbox lớn nhất
        const lb = boxes.sort((a, b) => {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          return (rb.width * rb.height) - (ra.width * ra.height);
        })[0];

        const items = Array.from(lb.querySelectorAll('[role="option"]')).map(opt => ({
          text: (opt.innerText || '').trim(),
          selected: opt.getAttribute('aria-selected') === 'true' ||
            opt.getAttribute('data-state') === 'checked'
        }));

        return {
          label: labelText,
          items,
          html: lb.outerHTML
        };
      }, labelText);

      if (!dump) throw new Error('Không tìm thấy listbox hiển thị sau khi mở combobox.');

      console.log(`  ✓ Tìm thấy ${dump.items.length} options`);

      // 4) Lưu file (JSON để dễ đọc)
      await this.saveResults(dump, fileName);

      // 5) Đóng portal (ESC) cho sạch state
      try {
        await this.driver.actions().sendKeys(Key.ESCAPE).perform();
        await this.driver.sleep(300);
      } catch (e) { }

      return dump;
    } catch (error) {
      console.error(`❌ Lỗi khi dump combobox "${labelText}":`, error.message);
      return null;
    }
  }

  // ====== 3 hàm BASE cho từng setting ======

  /**
   * Dump Aspect Ratio portal
   */
  async dumpAspectRatioPortal() {
    return await this.openComboboxAndDump('Aspect Ratio', 'aspect-portal.json');
  }

  /**
   * Dump Outputs per prompt portal
   */
  async dumpOutputsPerPromptPortal() {
    return await this.openComboboxAndDump('Outputs per prompt', 'outputs-portal.json');
  }

  /**
   * Dump Model portal
   */
  async dumpModelPortal() {
    return await this.openComboboxAndDump('Model', 'model-portal.json');
  }

  /**
   * Click button "Text to Video" và lấy popup HTML
   */
  async extractTextToVideoPopup() {
    try {
      console.log('🔍 Tìm button "Text to Video"...');

      // Tìm button theo text content
      const button = await this.driver.findElement(
        By.xpath('//button[contains(text(), "Text to Video")]')
      );

      console.log('✓ Tìm thấy button, đang click...');
      await button.click();

      // Chờ popup xuất hiện
      await this.driver.sleep(1000);

      console.log('🔍 Lấy HTML của popup...');

      // Lấy HTML của popup Radix
      const popupHTML = await this.driver.executeScript(`
        const popup = document.querySelector('[data-radix-popper-content-wrapper]');
        if (popup) {
          return {
            found: true,
            html: popup.outerHTML,
            innerHTML: popup.innerHTML
          };
        }
        return { found: false };
      `);

      if (popupHTML.found) {
        console.log('✓ Đã lấy popup HTML');
        return popupHTML;
      } else {
        console.log('⚠ Không tìm thấy popup');
        return null;
      }

    } catch (error) {
      console.error('❌ Lỗi khi lấy popup:', error.message);
      return null;
    }
  }

  /**
   * Chạy extraction đầy đủ cho Google Flow
   */
  async runGoogleFlowExtraction() {
    try {
      console.log('\n🚀 Bắt đầu extraction Google Flow...\n');

      // Chờ app load
      await this.waitForFlowApp();

      // Chụp screenshot
      console.log('📸 Chụp screenshot...');
      await this.takeScreenshot('google-flow-page.png');

      // // Lấy popup "Text to Video"
      // console.log('\n📦 Lấy popup "Text to Video"...');
      // const popup = await this.extractTextToVideoPopup();
      // if (popup && popup.found) {
      //   await this.saveResults(popup.html, 'text-to-video-popup.html');
      //   await this.saveResults(popup, 'text-to-video-popup.json');

      //   // Chụp screenshot popup
      //   await this.driver.sleep(500);
      //   await this.takeScreenshot('text-to-video-popup.png');
      // }

      // Dump Settings Portals
      console.log('\n📦 Dump Settings Portals...');
      await this.openSettingsPopover();
      await this.driver.sleep(500);
      await this.takeScreenshot('settings-popover.png');

      await this.dumpAspectRatioPortal();
      await this.dumpOutputsPerPromptPortal();
      await this.dumpModelPortal();

      // Đóng settings popover
      try {
        await this.driver.actions().sendKeys(Key.ESCAPE).perform();
        await this.driver.sleep(300);
      } catch (e) { }

      // 1. Lấy component structure
      console.log('\n📦 Phân tích component structure...');
      const structure = await this.extractComponentStructure();
      if (structure) {
        await this.saveResults(structure, 'component-structure.json');
      }

      // 2. Lấy Web Components
      console.log('\n📦 Lấy Web Components...');
      const webComponents = await this.extractWebComponents();
      if (webComponents.length > 0) {
        await this.saveResults(webComponents, 'web-components.json');

        // Lưu từng component riêng
        for (let i = 0; i < Math.min(webComponents.length, 20); i++) {
          await this.saveResults(webComponents[i].html, `web-component-${i}.html`);
          if (webComponents[i].shadowHTML) {
            await this.saveResults(webComponents[i].shadowHTML, `shadow-component-${i}.html`);
          }
        }
      }

      // 3. Lấy data elements
      console.log('\n📦 Lấy data elements...');
      const dataElements = await this.extractDataElements();
      if (dataElements.length > 0) {
        await this.saveResults(dataElements, 'data-elements.json');
      }

      // 4. Lấy interactive elements
      console.log('\n📦 Lấy interactive elements...');
      const interactive = await this.extractInteractiveElements();
      if (interactive) {
        await this.saveResults(interactive, 'interactive-elements.json');
      }

      // 5. Lấy tất cả Shadow DOM
      console.log('\n📦 Lấy tất cả Shadow DOM...');
      const shadowDOMs = await this.extractAllShadowDOM();
      if (shadowDOMs.length > 0) {
        await this.saveResults(shadowDOMs, 'all-shadow-doms.json');
      }

      // 6. Lấy Portal HTML
      console.log('\n📦 Lấy Portal HTML...');
      const portals = await this.extractPortalHTML();
      if (portals.length > 0) {
        await this.saveResults(portals, 'portals.json');
      }

      // 7. Lấy Modal/Dialog
      console.log('\n📦 Lấy Modal/Dialog...');
      const modals = await this.extractModalHTML();
      if (modals.length > 0) {
        await this.saveResults(modals, 'modals.json');
      }

      // 8. Lấy toàn bộ page HTML
      console.log('\n📦 Lấy toàn bộ page HTML...');
      const fullPage = await this.driver.getPageSource();
      await this.saveResults(fullPage, 'full-page.html');

      // 9. Lấy page info
      console.log('\n📦 Lấy page info...');
      const pageInfo = await this.driver.executeScript(`
        return {
          title: document.title,
          url: window.location.href,
          readyState: document.readyState,
          bodyClasses: document.body.className,
          bodyId: document.body.id,
          scripts: Array.from(document.scripts).map(s => s.src).filter(s => s),
          stylesheets: Array.from(document.styleSheets).map(s => s.href).filter(s => s)
        };
      `);
      await this.saveResults(pageInfo, 'page-info.json');

      console.log('\n✅ Hoàn thành extraction Google Flow!');
      console.log(`📁 Kết quả được lưu tại: ${this.config.outputDir}`);

    } catch (error) {
      console.error('❌ Lỗi trong quá trình extraction:', error);
      throw error;
    }
  }
}

// Main function
async function main() {
  const extractor = new GoogleFlowExtractor({
    url: 'https://labs.google/fx/tools/flow/project/4e776dda-aaa1-4101-9f04-dda63deee299',
    outputDir: './output/google-flow-dom',
    headless: false,
    timeout: 60000,
    profilePath: 'C:\\Users\\Admin\\.veo3-automation\\profiles\\9e4e8582-a488-4dbb-913f-ef3a0bb44431'
  });

  try {
    await extractor.init();
    await extractor.navigate();

    // Chạy extraction
    await extractor.runGoogleFlowExtraction();

  } catch (error) {
    console.error('❌ Lỗi:', error);
  } finally {
    await extractor.close();
  }
}

// Chạy script
if (require.main === module) {
  main().catch(console.error);
}

module.exports = GoogleFlowExtractor;
