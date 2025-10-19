/**
 * orchestrator-with-settings.js
 * Example: How to integrate VEO Settings into the main automation flow
 * 
 * This shows how to modify the existing orchestrator to support settings configuration
 * before prompt submission.
 */

const { configureVEOSettings, validateSettings } = require('../src/main/veo-settings-integration');

/**
 * Enhanced automation function with settings support
 * 
 * @param {string} profilePath - Chrome profile path
 * @param {Array<string>} prompts - Array of prompt texts
 * @param {Object} settings - Automation settings
 * @param {Object} settings.veo - VEO-specific settings
 * @param {string} [settings.veo.mode] - Generation mode
 * @param {string} [settings.veo.aspectRatio] - Aspect ratio
 * @param {number} [settings.veo.outputs] - Outputs per prompt
 * @param {string} [settings.veo.model] - Model selection
 * @param {number} [settings.downloadConcurrency] - Download concurrency
 * @param {string} [settings.outputDir] - Output directory
 */
async function automateWithSettings(profilePath, prompts, settings = {}) {
  const logger = console; // Use your winston logger here
  
  logger.info('=== Starting VEO Automation with Settings ===');
  logger.info(`Profile: ${profilePath}`);
  logger.info(`Prompts: ${prompts.length}`);
  logger.info(`Settings:`, JSON.stringify(settings, null, 2));

  // Validate VEO settings if provided
  if (settings.veo) {
    try {
      validateSettings(settings.veo);
      logger.info('✅ VEO settings validated');
    } catch (error) {
      logger.error(`❌ Invalid VEO settings: ${error.message}`);
      throw error;
    }
  }

  // Initialize database
  const VeoDatabase = require('../src/main/db');
  const db = new VeoDatabase('data/veo-automation.db');
  await db.init();

  // Prepare and insert prompts
  const promptsData = prompts.map((promptText, index) => ({
    index: index + 1,
    promptText,
  }));

  // Clear old data
  db.exec('DELETE FROM downloads');
  db.exec('DELETE FROM operations');
  db.exec('DELETE FROM prompts');
  db.save();
  logger.info('Cleared old data from database');

  // Insert new prompts
  db.insertPrompts(promptsData);
  logger.info(`Inserted ${promptsData.length} prompts into database`);

  // Create driver
  const { Builder } = require('selenium-webdriver');
  const chrome = require('selenium-webdriver/chrome');
  
  const options = new chrome.Options();
  options.addArguments(`--user-data-dir=${profilePath}`);
  options.addArguments('--disable-blink-features=AutomationControlled');
  options.addArguments('--no-sandbox');
  options.addArguments('--disable-dev-shm-usage');

  const driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(options)
    .build();

  try {
    // Navigate to VEO Flow
    logger.info('Opening VEO Flow...');
    await driver.get('https://labs.google/fx/tools/flow');
    await driver.sleep(3000);

    // ========================================
    // NEW: Configure VEO Settings BEFORE starting orchestrator
    // ========================================
    if (settings.veo) {
      logger.info('🎛️ Configuring VEO settings...');
      
      try {
        await configureVEOSettings(driver, settings.veo, logger);
        logger.info('✅ VEO settings configured successfully');
      } catch (error) {
        logger.error(`❌ Failed to configure VEO settings: ${error.message}`);
        throw error;
      }
    } else {
      logger.info('ℹ️ No VEO settings specified, using defaults');
    }

    // Enable CDP
    const CDPInterceptor = require('../src/main/cdp-interceptor-v2');
    const cdpInterceptor = new CDPInterceptor(driver, logger);
    await cdpInterceptor.enable();
    logger.info('CDP enabled');

    // Create orchestrator
    const SequentialOrchestrator = require('../src/main/sequential-orchestrator');
    const orchestrator = new SequentialOrchestrator(
      driver,
      cdpInterceptor,
      db,
      logger,
      {
        downloadConcurrency: settings.downloadConcurrency || 5,
        outputDir: settings.outputDir || 'dist/videos',
      }
    );

    // Start orchestration
    logger.info('Starting orchestrator...');
    orchestrator.start();

    // Log stats periodically
    const statsInterval = setInterval(() => {
      const stats = orchestrator.getStats();
      logger.info(
        `[Stats] Prompts: queued=${stats.queued}, in_progress=${stats.in_progress}, ` +
        `done=${stats.done}, failed=${stats.failed} | Ops: ${stats.total_ops}, ` +
        `downloaded=${stats.downloaded}`
      );
    }, 10000);

    // Wait for completion
    logger.info('Waiting for all jobs to complete...');
    await orchestrator.waitForCompletion();

    clearInterval(statsInterval);

    // Final stats
    const finalStats = orchestrator.getStats();
    logger.info('=== Final Statistics ===');
    logger.info(`Total prompts: ${prompts.length}`);
    logger.info(`Completed: ${finalStats.done}`);
    logger.info(`Failed: ${finalStats.failed}`);
    logger.info(`Timeout: ${finalStats.timeout}`);
    logger.info(`Total operations: ${finalStats.total_ops}`);
    logger.info(`Downloaded: ${finalStats.downloaded}`);

    logger.info('✅ Automation completed successfully');

  } catch (error) {
    logger.error(`❌ Automation failed: ${error.message}`);
    throw error;
  } finally {
    await driver.quit();
    logger.info('Browser closed');
  }
}

/**
 * Example 1: Full configuration
 */
async function example1_FullConfiguration() {
  await automateWithSettings(
    'C:\\Users\\Admin\\.veo3-automation\\profiles\\my-profile',
    [
      'A cat playing piano',
      'A dog dancing in the rain',
      'A bird flying over mountains'
    ],
    {
      veo: {
        mode: 'Text to Video',
        aspectRatio: 'Landscape (16:9)',
        outputs: 2,
        model: 'Veo 3.1 - Fast'
      },
      downloadConcurrency: 5,
      outputDir: 'dist/videos'
    }
  );
}

/**
 * Example 2: Partial settings (only change what you need)
 */
async function example2_PartialSettings() {
  await automateWithSettings(
    'C:\\Users\\Admin\\.veo3-automation\\profiles\\my-profile',
    ['A sunset over the ocean'],
    {
      veo: {
        aspectRatio: 'Portrait (9:16)',
        outputs: 4
        // mode and model will use current/default values
      }
    }
  );
}

/**
 * Example 3: No settings (use defaults)
 */
async function example3_NoSettings() {
  await automateWithSettings(
    'C:\\Users\\Admin\\.veo3-automation\\profiles\\my-profile',
    ['A simple video prompt'],
    {
      // No veo settings, will use whatever is currently set in UI
      downloadConcurrency: 3
    }
  );
}

/**
 * Example 4: High quality portrait videos
 */
async function example4_HighQualityPortrait() {
  await automateWithSettings(
    'C:\\Users\\Admin\\.veo3-automation\\profiles\\my-profile',
    [
      'A person walking down a street',
      'A close-up of a flower blooming',
      'A waterfall in slow motion'
    ],
    {
      veo: {
        mode: 'Text to Video',
        aspectRatio: 'Portrait (9:16)',
        outputs: 1,
        model: 'Veo 3.1 - Quality'
      },
      outputDir: 'dist/high-quality-portraits'
    }
  );
}

/**
 * Example 5: Batch processing with different settings per batch
 */
async function example5_BatchProcessing() {
  // Batch 1: Landscape videos
  console.log('=== Processing Batch 1: Landscape ===');
  await automateWithSettings(
    'C:\\Users\\Admin\\.veo3-automation\\profiles\\my-profile',
    ['Landscape prompt 1', 'Landscape prompt 2'],
    {
      veo: {
        aspectRatio: 'Landscape (16:9)',
        outputs: 2,
        model: 'Veo 3.1 - Fast'
      },
      outputDir: 'dist/batch1-landscape'
    }
  );

  // Batch 2: Portrait videos
  console.log('=== Processing Batch 2: Portrait ===');
  await automateWithSettings(
    'C:\\Users\\Admin\\.veo3-automation\\profiles\\my-profile',
    ['Portrait prompt 1', 'Portrait prompt 2'],
    {
      veo: {
        aspectRatio: 'Portrait (9:16)',
        outputs: 2,
        model: 'Veo 3.1 - Fast'
      },
      outputDir: 'dist/batch2-portrait'
    }
  );
}

/**
 * Example 6: Using with CSV file
 */
async function example6_FromCSV() {
  const fs = require('fs-extra');
  const csvParser = require('csv-parser');

  // Read prompts from CSV
  const prompts = [];
  await new Promise((resolve, reject) => {
    fs.createReadStream('prompts/my-prompts.csv')
      .pipe(csvParser())
      .on('data', (row) => {
        if (row.prompt) {
          prompts.push(row.prompt);
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });

  // Run automation with settings
  await automateWithSettings(
    'C:\\Users\\Admin\\.veo3-automation\\profiles\\my-profile',
    prompts,
    {
      veo: {
        mode: 'Text to Video',
        aspectRatio: 'Landscape (16:9)',
        outputs: 3,
        model: 'Veo 3.1 - Quality'
      }
    }
  );
}

/**
 * Example 7: Error handling
 */
async function example7_ErrorHandling() {
  try {
    await automateWithSettings(
      'C:\\Users\\Admin\\.veo3-automation\\profiles\\my-profile',
      ['Test prompt'],
      {
        veo: {
          mode: 'Invalid Mode', // This will fail validation
          outputs: 5 // This will also fail (max is 4)
        }
      }
    );
  } catch (error) {
    console.error('Caught validation error:', error.message);
    // Handle error appropriately
  }
}

// Export for use in other modules
module.exports = {
  automateWithSettings,
  example1_FullConfiguration,
  example2_PartialSettings,
  example3_NoSettings,
  example4_HighQualityPortrait,
  example5_BatchProcessing,
  example6_FromCSV,
  example7_ErrorHandling
};

// Run example if called directly
if (require.main === module) {
  const exampleNumber = process.argv[2] || '1';
  
  const examples = {
    '1': example1_FullConfiguration,
    '2': example2_PartialSettings,
    '3': example3_NoSettings,
    '4': example4_HighQualityPortrait,
    '5': example5_BatchProcessing,
    '6': example6_FromCSV,
    '7': example7_ErrorHandling
  };

  const exampleFn = examples[exampleNumber];
  
  if (exampleFn) {
    console.log(`\n🚀 Running Example ${exampleNumber}\n`);
    exampleFn().catch(console.error);
  } else {
    console.log('Usage: node orchestrator-with-settings.js [1-7]');
    console.log('Examples:');
    console.log('  1 - Full configuration');
    console.log('  2 - Partial settings');
    console.log('  3 - No settings (use defaults)');
    console.log('  4 - High quality portrait videos');
    console.log('  5 - Batch processing');
    console.log('  6 - From CSV file');
    console.log('  7 - Error handling');
  }
}
