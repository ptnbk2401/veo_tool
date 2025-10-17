# Specification: VEO3 Automation Tool

## 1. Tổng quan

**Mục đích**: VEO3 Automation Tool là một ứng dụng desktop tự động hóa quy trình tạo video trên Google Labs Flow (Veo 3) sử dụng Chrome profiles, Selenium-WebDriver, và giao diện React. Tool cho phép người dùng upload file CSV chứa danh sách prompts, chọn các cài đặt (aspect ratio, output count), và thực thi automation mà không cần chạy ứng dụng Electron đầy đủ (để bypass Gatekeeper trên macOS).

**Mục tiêu**:

- Tự động hóa quy trình tạo clip cơ bản (Text to Video) và tạo song song (Concurrent Generation).
- Đọc prompts từ file CSV (chỉ chứa cột `prompt`).
- Cho phép chọn `aspect_ratio` (16:9, 9:16, 1:1) và `output_count` (mặc định 1) qua giao diện.
- Chạy logic automation độc lập bằng Node.js để tránh vấn đề Gatekeeper trên macOS.
- Lưu và quản lý output video, log chi tiết các bước.

**Ngăn xếp công nghệ** (dựa trên package.json):

- **Backend**: Node.js, Selenium-WebDriver, fs-extra, csv-parser, csv-writer, winston, uuid.
- **Frontend**: React, Zustand, Vite.
- **Build**: Electron, electron-builder (chỉ dùng khi cần build app).
- **Test**: Jest.

## 2. Yêu cầu chức năng

### 2.1. Upload và xử lý CSV

- **Input**: File CSV chỉ chứa cột `prompt` (ví dụ: `"A young woman with bright red hair is dancing happily in a dimly lit jazz club, moody cinematic lighting, 4K."`).
- **Chức năng**:
  - Người dùng upload file CSV qua giao diện React.
  - Tool parse CSV và hiển thị danh sách prompts trong giao diện.
  - Lưu danh sách prompts vào Zustand store để đồng bộ với backend.
- **Output**: Danh sách prompts được lưu trong bộ nhớ và sẵn sàng cho automation.

### 2.2. Cấu hình Settings

- **Chức năng**:
  - Cho phép chọn `aspect_ratio` (16:9, 9:16, 1:1) qua dropdown.
  - Cho phép nhập `output_count` (số lượng đầu ra, mặc định 1) qua input number.
  - Settings được lưu trong Zustand store và gửi tới backend khi chạy job.
- **Yêu cầu**: Giao diện phải phản hồi tức thời khi người dùng thay đổi settings.

### 2.3. Tự động hóa quy trình Google Flow

- **Quy trình cơ bản (Text to Video)**:

  - **Mô tả chi tiết flow thực hiện trên Google Labs Flow**:
    1. **Thiết lập Dự án**: Truy cập `https://labs.google/fx/tools/flow` (yêu cầu tài khoản Google AI Pro/Ultra). Nhấp vào nút "New project" để khởi tạo dự án mới. Ở hộp lệnh (Prompt Box) phía dưới, chọn chế độ "Text to Video".
    2. **Cấu hình Cài đặt (Settings)**: Nhấp vào biểu tượng bánh răng (Settings). Đảm bảo chọn Model là Veo 3 (hoặc phiên bản mới nhất). Chọn Aspect Ratio cố định (16:9, 9:16, hoặc 1:1). Đặt Number of Outputs là 1 (cho quy trình 1:1, tức 1 Prompt = 1 Clip).
    3. **Viết và Nhập Prompt**: Nhập prompt chi tiết bằng tiếng Anh vào Prompt Box, bao gồm các thành phần: Chủ thể & Hành động (e.g., "A young woman with bright red hair is dancing happily"), Bối cảnh & Môi trường (e.g., "in a dimly lit jazz club with velvet curtains"), Ánh sáng & Kỹ thuật (e.g., "moody cinematic lighting, shallow depth of field, 4K"), và Âm thanh (tùy chọn, e.g., "with the sound of jazz music and soft chatter").
    4. **Generate và Tải xuống**: Nhấn nút "Generate" để bắt đầu tạo clip. Sau khi clip hoàn tất (trạng thái "Complete"), di chuột qua clip và nhấp vào biểu tượng Download để tải video về.
  - **Tự động hóa**: Sử dụng Chrome profile chỉ định (để lưu session đăng nhập). Tool sẽ tự động thực hiện các bước trên cho từng prompt từ CSV, sử dụng settings đã chọn. Di chuyển file video tải về vào thư mục `dist/videos/` với tên gắn UUID. Ghi log (prompt, file path, timestamp) vào file CSV (`output.csv`).

- **Quy trình song song (Concurrent Generation)**:
  - **Mô tả chi tiết flow thực hiện trên Google Labs Flow**:
    1. **Thiết lập Song song**: Thực hiện các bước 1, 2, 3 của quy trình cơ bản (New project, chọn Text to Video, cấu hình Settings với Number of Outputs = 1).
    2. **Thực hiện Đa luồng (Key to Speed)**:
       - Gửi Yêu cầu 1: Nhập Prompt 1 → Nhấn Generate để khởi động Luồng 1.
       - Gửi Yêu cầu 2, 3, 4...: NGAY LẬP TỨC (không chờ Clip 1 hoàn thành) → Xóa Prompt cũ → Nhập Prompt mới (Prompt 2, 3,...) → Nhấn Generate để khởi động Luồng 2, 3, 4,... song song, lấp đầy Giới hạn Xử lý Đồng thời của Flow.
       - Duy trì Luồng: Khi thấy một clip cũ hoàn thành ("Complete"), gửi yêu cầu Generate tiếp theo ngay lập tức (Prompt N+1) để giữ hàng đợi luôn đầy, tối đa hóa hiệu suất xử lý của Veo 3.
    3. **Tải xuống**: Sau mỗi clip hoàn thành, tải xuống ngay lập tức để giải phóng luồng.
  - **Tự động hóa**: Sử dụng nhiều Chrome profiles (tối đa 4-8 tùy giới hạn Google Flow). Gửi các yêu cầu Generate liên tục mà không chờ clip trước hoàn thành. Theo dõi trạng thái clip (Complete) và tải xuống ngay khi sẵn sàng. Duy trì hàng đợi prompts bằng Zustand để đảm bảo luồng luôn đầy.

### 2.4. Quản lý Chrome Profiles

- **Chức năng**:
  - Sử dụng nhiều Chrome profiles (thư mục như `profiles/user1`, `profiles/user2`) để chạy song song.
  - Đảm bảo profile tồn tại trước khi chạy (`fs-extra.ensureDir`).
  - Mỗi profile lưu session đăng nhập để tránh login lặp lại.

### 2.5. Logging và Output

- **Log**: Sử dụng `winston` để ghi log chi tiết (prompt, file path, lỗi, timestamp) vào `logs/automation.log` và console.
- **Output CSV**: Ghi thông tin clip (prompt, file path, timestamp) vào `output.csv` sử dụng `csv-writer`.

## 3. Yêu cầu phi chức năng

- **Hiệu suất**:

  - Tối ưu hóa concurrent generation để tận dụng giới hạn Google Flow (4-8 luồng tùy tài khoản).
  - Thời gian chờ tối đa cho mỗi Generate: 60 giây, với retry logic (3 lần) cho các bước click/download.

- **Khả năng mở rộng**:

  - Hỗ trợ batch processing (nhiều file CSV).

- **Tính ổn định**:

  - Xử lý lỗi mạng, quota exceeded, hoặc DOM không tìm thấy bằng retry logic.
  - Kiểm tra giới hạn concurrent requests trước khi gửi thêm Generate.

- **Khả năng chạy trên macOS**:
  - Chạy automation logic bằng `node` để bypass Gatekeeper.
  - Test giao diện React độc lập với `vite preview`.

## 4. Cấu trúc hệ thống

### 4.1. Cấu trúc thư mục

```
veo3-automation-tool/
├── src/
│   ├── main/                    # Backend logic
│   │   ├── main.js             # Electron main process (nếu dùng)
│   │   ├── automation.js       # Logic Selenium automation
│   ├── renderer/               # React frontend
│   │   ├── App.jsx             # Component chính
│   │   ├── store.js           # Zustand store
│   ├── logs/                  # Winston logs
│   │   ├── automation.log
│   ├── dist/                  # Output videos
│   │   ├── videos/
│   ├── profiles/              # Chrome profiles
│   │   ├── user1/
│   │   ├── user2/
├── prompts.csv                # Input CSV
├── output.csv                 # Output CSV
├── package.json
```

### 4.2. Luồng dữ liệu

1. Người dùng upload CSV và chọn settings qua giao diện React.
2. Zustand store lưu prompts và settings, gửi tới backend (qua IPC nếu dùng Electron, hoặc trực tiếp nếu chạy Node.js).
3. Backend (Selenium) đọc prompts, cấu hình Chrome profiles, thực thi automation trên Google Flow.
4. Output video được lưu vào `dist/videos/` với tên gắn UUID.
5. Log và thông tin clip được ghi vào `logs/automation.log` và `output.csv`.

## 5. Giao diện người dùng

### 5.1. Component chính (`App.jsx`)

- **Upload CSV**: Input file (accept `.csv`), hiển thị tên file đã chọn.
- **Settings**:
  - Dropdown cho `aspect_ratio` (16:9, 9:16, 1:1).
  - Input number cho `output_count` (mặc định 1, min 1).
- **Prompt List**: Hiển thị danh sách prompts từ CSV.
- **Start Button**: Gửi job (prompts + settings) tới backend.
- **Zustand Store**:

  ```javascript
  import create from "zustand";

  const queueStore = create((set) => ({
    prompts: [],
    settings: { aspectRatio: "16:9", outputCount: 1 },
    setPrompts: (prompts) => set({ prompts }),
    setSettings: (settings) =>
      set((state) => ({ settings: { ...state.settings, ...settings } })),
  }));
  ```

### 5.2. Mockup giao diện

```
----------------------------------------
| VEO3 Automation Tool                 |
----------------------------------------
| Upload CSV: [Choose File] prompts.csv|
| Aspect Ratio: [16:9 ▼]               |
| Output Count: [1]                    |
|--------------------------------------|
| Prompts (2)                          |
| - A young woman with bright red hair... |
| - A futuristic city at night...      |
|--------------------------------------|
| [Start Automation]                   |
----------------------------------------
```

## 6. Logic Automation

### 6.1. Script chính (`automation.js`)

- **Input**: `profilePath` (Chrome profile), `prompts` (array từ CSV), `settings` (aspectRatio, outputCount).
- **Chức năng**:
  - Khởi tạo Chrome driver với profile.
  - Truy cập Google Flow, cấu hình settings, nhập prompt, generate, và tải clip.
  - Lưu video vào `dist/videos/` với UUID.
  - Ghi log và output CSV.

### 6.2. Code mẫu

```javascript
const fs = require("fs-extra");
const csvParser = require("csv-parser");
const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const winston = require("winston");
const { v4: uuidv4 } = require("uuid");
const createCsvWriter = require("csv-writer").createObjectCsvWriter;

const logger = winston.createLogger({
  level: "info",
  format: winston.format.simple(),
  transports: [
    new winston.transports.File({ filename: "logs/automation.log" }),
    new winston.transports.Console(),
  ],
});

async function safeClick(driver, selector, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await driver.wait(until.elementLocated(By.css(selector)), 10000);
      await driver.findElement(By.css(selector)).click();
      return;
    } catch (error) {
      logger.warn(`Retry ${i + 1} for ${selector}: ${error}`);
      await driver.sleep(1000);
    }
  }
  throw new Error(`Failed to click ${selector}`);
}

async function automateClipCreation(profilePath, csvPath, settings) {
  const prompts = [];
  await new Promise((resolve, reject) => {
    fs.createReadStream(csvPath)
      .pipe(csvParser())
      .on("data", (row) => prompts.push(row.prompt))
      .on("end", resolve)
      .on("error", reject);
  });

  const options = new chrome.Options().addArguments(
    `--user-data-dir=${profilePath}`
  );
  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(options)
    .build();

  const csvWriter = createCsvWriter({
    path: "output.csv",
    header: [
      { id: "prompt", title: "Prompt" },
      { id: "filePath", title: "File Path" },
      { id: "timestamp", title: "Timestamp" },
    ],
  });

  try {
    await fs.ensureDir("dist/videos");
    await driver.get("https://labs.google/fx/tools/flow");
    await safeClick(driver, "#new-project");
    await safeClick(driver, '[data-mode="text-to-video"]');

    // Cấu hình settings
    await safeClick(driver, ".settings-icon");
    await safeClick(driver, '[data-model="veo-3"]');
    await safeClick(driver, `[data-aspect-ratio="${settings.aspectRatio}"]`);
    await safeClick(driver, `[data-output-count="${settings.outputCount}"]`);

    // Xử lý prompts
    for (const prompt of prompts) {
      await driver.findElement(By.id("prompt-box")).clear();
      await driver.findElement(By.id("prompt-box")).sendKeys(prompt);
      await safeClick(driver, "#generate-button");

      await driver.wait(
        until.elementLocated(By.css(".clip-status-complete")),
        60000
      );
      await safeClick(driver, ".download-icon");

      const fileId = uuidv4();
      const filePath = `dist/videos/video-${fileId}.mp4`;
      await fs.move("~/Downloads/video.mp4", filePath);

      await csvWriter.writeRecords([
        { prompt, filePath, timestamp: new Date().toISOString() },
      ]);

      logger.info(`Generated and downloaded clip for prompt: ${prompt}`);
    }
  } catch (error) {
    logger.error(`Error: ${error}`);
  } finally {
    await driver.quit();
  }
}

module.exports = { automateClipCreation };
```

### 6.3. Concurrent Generation

- Sử dụng nhiều Chrome drivers (4-8) với profile khác nhau.
- Quản lý hàng đợi bằng Zustand:
  ```javascript
  const queueStore = create((set) => ({
    queue: [],
    addToQueue: (prompt) =>
      set((state) => ({ queue: [...state.queue, prompt] })),
    removeFromQueue: () => set((state) => ({ queue: state.queue.slice(1) })),
  }));
  ```

## 7. Hướng dẫn triển khai

### 7.1. Chuẩn bị

- **Cài đặt dependencies**:
  ```bash
  npm install
  ```
- **Tạo file CSV** (`prompts.csv`):
  ```csv
  prompt
  "A young woman with bright red hair is dancing happily in a dimly lit jazz club, moody cinematic lighting, 4K."
  ```
- **Tạo thư mục**:
  ```bash
  mkdir -p profiles/user1 dist/videos logs
  ```

### 7.2. Test giao diện

- Lưu `App.jsx` và `store.js` vào `src/renderer/`.
- Chạy:
  ```bash
  npm run build-renderer && npx vite preview
  ```
- Mở `http://localhost:4173` để test upload CSV và settings.

### 7.3. Test automation

- Lưu `automation.js` vào `src/main/`.
- Chạy:
  ```bash
  node src/main/automation.js
  ```
  với lệnh gọi:
  ```javascript
  const { automateClipCreation } = require("./src/main/automation");
  automateClipCreation("/path/to/profiles/user1", "prompts.csv", {
    aspectRatio: "16:9",
    outputCount: 1,
  });
  ```

### 7.4. Tích hợp với Electron (nếu cần)

- Thêm IPC trong `main.js`:
  ```javascript
  const { ipcMain } = require("electron");
  const { automateClipCreation } = require("./automation");
  ipcMain.on("start-job", (event, { prompts, settings }) => {
    automateClipCreation("/path/to/profiles/user1", prompts, settings);
  });
  ```
- Bỏ Gatekeeper (nếu cần):
  ```bash
  xattr -d com.apple.quarantine ./node_modules/.bin/electron
  npm run dev
  ```

## 8. Ghi chú

- **DOM Selectors**: Cần kiểm tra DOM thực tế của Google Flow bằng Chrome DevTools để cập nhật selectors (`By.id`, `By.css`). **Lưu ý quan trọng**: Tránh sử dụng text để select DOM (ví dụ: `By.linkText("New project")` hoặc `By.linkText("Dự án mới")`) vì giao diện Google Flow có thể hiển thị song ngữ (tiếng Anh hoặc tiếng Việt) tùy thuộc vào cài đặt ngôn ngữ của người dùng. Thay vào đó, ưu tiên sử dụng các selector dựa trên ID, class, hoặc thuộc tính data (ví dụ: `By.css('[data-action="new-project"]')`). Nếu không có thuộc tính cố định, kiểm tra DOM thực tế và cập nhật logic để xử lý cả hai ngôn ngữ nếu cần.
- **Error Handling**: Retry logic đảm bảo xử lý lỗi mạng hoặc DOM không tìm thấy.
- **Bypass Gatekeeper**: Ưu tiên chạy `node automation.js` để test trên macOS.
