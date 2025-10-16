# VEO3 Automation Tool

Desktop automation tool for VEO3 Flow video generation using Chrome profiles.

## Features

- **Chrome Profile Integration**: Use existing Chrome profiles with saved VEO3 login sessions
- **Batch Processing**: Process multiple video generation requests from CSV files
- **Real-time Monitoring**: Track progress and view logs in real-time
- **Cross-platform**: Windows support with future macOS and Linux compatibility

## Quick Start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Run in development mode:

   ```bash
   npm run dev
   ```

3. Build for production:
   ```bash
   npm run build
   ```

## Project Structure

```
src/
├── main/           # Electron main process
│   ├── main.js     # Application entry point
│   └── preload.js  # IPC bridge
├── renderer/       # Electron renderer process (UI)
│   └── index.html  # Main UI
└── automation/     # Automation modules
    ├── chrome-profile-manager.js
    ├── csv-processor.js
    ├── video-renderer.js
    └── logger.js
```

## Development Status

This project is currently under development following a structured implementation plan:

- [x] Task 1: Project structure and dependencies
- [x] Task 2: Chrome Profile Management
- [x] Task 3: CSV Processing
- [x] Task 4: Video Rendering
- [x] Task 5: Configuration and Logging
- [x] Task 6: Main Process Orchestration
- [ ] Task 7: UI Components
- [ ] Task 8: Error Handling
- [ ] Task 9: Parallel Processing
- [ ] Task 10: Packaging and Deployment

## Requirements

- Node.js 18+
- Chrome browser installed
- Windows 10+ (primary target)

## License

MIT
