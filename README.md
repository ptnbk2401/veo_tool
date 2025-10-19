# VEO3 Automation Tool

Desktop automation tool for Google Labs Flow (Veo 3) video generation using **API-driven architecture** with Chrome profiles and Selenium WebDriver.

## 🚀 Tính năng mới (v2.0 - API-Driven)

- ✨ **API-driven architecture**: Gọi trực tiếp VEO APIs thay vì DOM scraping
- ✨ **SQLite persistence**: Lưu trữ state bền vững, resume được sau crash
- ✨ **Strict concurrency control**: Tự động giữ tối đa 5 prompts đang xử lý
- ✨ **Direct video download**: Tải video trực tiếp từ `fifeUrl` (nhanh & ổn định)
- ✨ **Crash-safe resume**: Khôi phục tự động sau lỗi hoặc restart
- ✨ **Standardized filenames**: Tên file theo chuẩn với prompt index và metadata

## Tính năng cơ bản

- ✅ Tự động hóa quy trình tạo video Text to Video trên Google Flow
- ✅ Upload CSV chứa danh sách prompts
- ✅ Cấu hình aspect ratio (16:9, 9:16, 1:1) và output count
- ✅ **Quản lý Chrome profiles riêng** - Không dùng profile của máy
- ✅ Giao diện tạo và quản lý profiles
- ✅ Login thủ công với Chrome profile riêng
- ✅ Logging chi tiết với Winston
- ✅ Lưu output video với tên chuẩn
- ✅ Ghi kết quả vào manifest.json
- ✅ Chạy standalone (không cần Electron) để bypass Gatekeeper trên macOS

## Quick Start

```bash
# 1. Cài đặt
npm install

# 2. Kiểm tra Chrome
npm run test-setup

# 3. Tạo profile và login (QUAN TRỌNG!)
npm run setup
# Nhập tên profile → Chọn y để login → Đăng nhập Google Flow

# 4. Chạy automation
npm run standalone
```

**⚠️ Lưu ý quan trọng**:

- Phải login vào Google Flow trước khi chạy automation
- Sau khi login, **đợi 5-10 giây** trước khi đóng Chrome (để lưu session)
- Verify bạn thấy giao diện Veo 3 trước khi đóng Chrome

## Chi tiết

### 1. Chạy Standalone (CLI)

Chạy automation trực tiếp bằng Node.js mà không cần Electron:

```bash
# Chạy và chọn profile interactively
npm run standalone
# → Hiển thị danh sách profiles để chọn

# Chỉ định profile cụ thể (skip prompt)
npm run standalone -- --profile-name="My Production Profile"

# Chạy headless (không hiển thị Chrome)
npm run standalone -- --headless

# Tùy chỉnh settings
npm run standalone -- --csv=my-prompts.csv --aspect-ratio=9:16
```

**⚠️ Lưu ý**:

- Chrome sẽ hiển thị mặc định để debug
- **Không đóng Chrome thủ công** khi automation đang chạy!
- Nếu có nhiều profiles, bạn sẽ được hỏi chọn profile nào

**Quản lý profiles** (CLI):

```bash
npm run setup          # Tạo profile mới + login
npm run profiles       # Xem danh sách profiles
npm run login          # Login lại nếu cần
```

```bash
npm run login
# Chrome sẽ mở → Login Google Flow → Đóng Chrome
```

**Hoặc dùng GUI** (khuyến nghị - xem phần 2): 5. Chạy automation

### 2. Chạy với Electron (Giao diện GUI - Khuyến nghị)

```bash
# Build giao diện React
npm run build-renderer

# Chạy Electron
npm run dev
```

**Ưu điểm của GUI:**

- Quản lý Chrome profiles trực quan
- Tạo profile riêng cho tool (không dùng profile máy)
- Login thủ công dễ dàng
- Theo dõi tiến trình real-time
- Xem logs và results ngay trong app

### 3. Test giao diện độc lập

```bash
npm run build-renderer
npx vite preview
```

Mở http://localhost:4173 để test giao diện.

## Cấu trúc CSV

File CSV chỉ cần 1 cột `prompt`:

```csv
prompt
"A young woman with bright red hair is dancing happily in a dimly lit jazz club, moody cinematic lighting, 4K."
"A futuristic city at night with neon lights reflecting on wet streets, cyberpunk aesthetic, cinematic composition."
```

## Cấu trúc thư mục

```
veo3-automation-tool/
├── src/
│   ├── main/
│   │   ├── main.js              # Electron main process
│   │   ├── automation.js        # Logic Selenium automation
│   │   └── preload.js           # Electron preload script
│   ├── renderer/
│   │   ├── App.jsx              # React component chính
│   │   ├── store.js             # Zustand store
│   │   ├── index.css            # Styles
│   │   ├── main.jsx             # React entry point
│   │   └── index.html           # HTML template
├── dist/
│   └── videos/                  # Output videos
├── logs/
│   └── automation.log           # Logs
├── prompts.csv                  # Input CSV
├── output.csv                   # Output CSV với kết quả
├── run-automation.js            # Standalone runner
└── package.json
```

## Output

- **Videos**: Lưu trong `dist/videos/` với tên chuẩn: `YYYY-MM-DD_{pIdx3}_{tailSlug}_{modelShort}_{takeIdx2}_{dur}s.mp4`
  - Ví dụ: `2025-10-18_003_yasuo-rain-hand_veo3.1_02_8s.mp4`
- **Manifest**: `dist/manifest.json` chứa thông tin chi tiết tất cả prompts và videos
- **Database**: `data/veo-automation.db` (SQLite) lưu trữ state để resume
- **Logs**: `logs/automation.log` chứa log chi tiết

## Lưu ý quan trọng

### 1. Chrome Installation

Tool tự động detect Chrome. Nếu chưa có: `brew install --cask google-chrome` hoặc https://www.google.com/chrome/

Kiểm tra: `npm run test-setup`

### 2. Profile Manager

- Dùng GUI để tạo profiles (không dùng Chrome profile máy)
- Profiles lưu tại: `~/.veo3-automation/profiles/`
- Mỗi profile có session riêng

### 3. API-Driven Architecture (v2.0)

**Cách hoạt động mới:**
- Selenium chỉ dùng để authenticate (lấy cookies)
- Sau đó gọi trực tiếp VEO APIs:
  - `POST /v1/video:batchAsyncGenerateVideoText` - Submit prompts
  - `POST /v1/video:batchCheckAsyncVideoGenerationStatus` - Poll status
  - Download trực tiếp từ `fifeUrl`
- SQLite lưu trữ state → resume được sau crash
- Tự động giữ tối đa 5 prompts đang xử lý (VEO limit)

### 4. Không đóng Chrome thủ công!

**Quan trọng**: Khi automation đang chạy, Chrome sẽ hiển thị. **Không đóng Chrome** thủ công vì sẽ gây lỗi "window already closed".

### 5. Phải login trước!

Tool sẽ tự động kiểm tra login. Nếu chưa login sẽ báo lỗi và dừng lại.

### 6. Timeout & Retry

- **Prompt timeout**: 180-240 giây (3-4 phút)
- **API timeout**: 15 giây per request
- **Download timeout**: 60 giây
- **Retry**: 3 lần với exponential backoff (1s, 2s, 4s)
- **Poll interval**: 1.5-2.5 giây với jitter ±250ms

### 7. Resume Capability

Nếu automation bị gián đoạn:
- State được lưu trong SQLite (`data/veo-automation.db`)
- Khi restart, tự động:
  - Reset prompts đang submit → queued
  - Timeout prompts > 24h → timeout
  - Reset downloads đang chạy → queued
- Chạy lại automation để tiếp tục

## Troubleshooting

### Chrome không tìm thấy

Chạy `npm run test-setup` để kiểm tra. Nếu thiếu, cài Chrome từ https://www.google.com/chrome/

### Not logged in / Session hết hạn

Nếu gặp lỗi "Not logged in":

```bash
npm run login    # Chọn profile và login lại
# Hoặc chỉ định profile:
node open-chrome-profile.js "Profile Name"
```

Hoặc dùng GUI: Click "Login" trên profile.

### User data directory already in use

Tool sẽ tự động phát hiện và hỏi có kill Chrome process đang dùng profile không.

Hoặc đóng Chrome thủ công trước khi chạy automation.

**Lưu ý**: Chỉ kill Chrome process của profile đang dùng, không ảnh hưởng Chrome khác.

### API Authentication Failed (401/403)

Nếu gặp lỗi authentication:
1. Login lại: `npm run login`
2. Đảm bảo đã đăng nhập Google Flow thành công
3. Đợi 5-10 giây sau khi login trước khi đóng Chrome
4. Chạy lại automation

### Database Locked

Nếu gặp lỗi "database is locked":
- Đảm bảo không có automation nào khác đang chạy
- Xóa file `data/veo-automation.db-wal` và `data/veo-automation.db-shm`
- Chạy lại

### Download Failed / URL Expired

Nếu download thất bại với lỗi 403:
- Tool sẽ tự động re-poll để lấy URL mới
- Nếu vẫn lỗi, check logs để xem chi tiết

### Resume After Crash

Nếu automation bị crash:
1. Check logs: `logs/automation.log`
2. Check database: `data/veo-automation.db`
3. Chạy lại automation - sẽ tự động resume từ state cũ
4. Nếu muốn start fresh: xóa database và chạy lại

### macOS Gatekeeper (Electron)

```bash
xattr -d com.apple.quarantine ./node_modules/.bin/electron
```

Hoặc dùng standalone: `node run-automation.js`

## Architecture (v2.0)

### Components

```
┌─────────────────────────────────────────────────────────┐
│                  Electron Main Process                   │
│                                                           │
│  ┌──────────┐      ┌────────────────────────────────┐  │
│  │ Selenium │──────▶│      API Client                │  │
│  │ (Auth)   │      │  - Submit prompts              │  │
│  └──────────┘      │  - Poll status                 │  │
│                     │  - Download videos             │  │
│                     └────────────────────────────────┘  │
│                                │                         │
│                                ▼                         │
│  ┌────────────────────────────────────────────────────┐ │
│  │              Orchestrator                          │ │
│  │  ┌────────┐  ┌────────┐  ┌──────────────────┐   │ │
│  │  │ Feeder │  │ Poller │  │   Downloader     │   │ │
│  │  │(300-500│  │(1.5-2.5│  │   (4-6 workers)  │   │ │
│  │  │   ms)  │  │s+jitter│  │                  │   │ │
│  │  └────────┘  └────────┘  └──────────────────┘   │ │
│  └────────────────────────────────────────────────────┘ │
│                           │                              │
│                           ▼                              │
│  ┌────────────────────────────────────────────────────┐ │
│  │          SQLite Database (WAL mode)                │ │
│  │  ┌────────┐  ┌──────────┐  ┌────────────┐       │ │
│  │  │prompts │  │operations│  │  downloads │       │ │
│  │  └────────┘  └──────────┘  └────────────┘       │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### Flow

1. **Submit Phase**: Feeder submits prompts via API (max 5 concurrent)
2. **Poll Phase**: Poller checks status every 1.5-2.5s
3. **Download Phase**: Downloader streams videos from fifeUrl
4. **State Management**: All state persisted in SQLite for resume

### Files

- `src/main/db.js` - SQLite database layer
- `src/main/api-client.js` - VEO API client
- `src/main/orchestrator.js` - Feeder/Poller/Downloader coordination
- `src/main/automation.js` - Main entry point
- `data/veo-automation.db` - SQLite database (created on first run)

## Scripts

**CLI (Khuyến nghị):**

- `npm run test-setup` - Kiểm tra Chrome, dependencies
- `npm run setup` - Tạo profile mới + login
- `npm run profiles` - Xem danh sách profiles
- `npm run login` - Login lại
- `npm run standalone` - Chạy automation

**GUI:**

- `npm run dev` - Chạy Electron GUI
- `npm run build-renderer` - Build giao diện
- `npm run preview` - Preview giao diện

## Dependencies

- **Backend**: selenium-webdriver, fs-extra, csv-parser, csv-writer, winston, uuid
- **Frontend**: React, Zustand, Vite
- **Build**: Electron, electron-builder

## License

MIT
