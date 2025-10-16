# 🧾 SPEC – VEO3 Automation Tool

## 1️⃣ Mục tiêu

- Tự động tạo video từ **VEO 3 Flow** bằng **Chrome profile đã login**  
- **Không cần email/password**  
- Hỗ trợ **batch render từ CSV**  
- Desktop app đóng gói bằng **Electron** (Windows, tương lai Mac/Linux)  

---

## 2️⃣ Modules chính

| Module             | Mục tiêu / Function |
|-------------------|-------------------|
| **Auth (Chrome profile)** | Load profile, detect session còn sống, mở Chrome visible nếu cần login |
| **CSV Loader**          | Đọc file CSV chứa prompt & Flow URL |
| **Renderer**            | Open Flow URL, paste prompt, click Render, poll progress, download video |
| **Logger**              | Ghi trạng thái render, lỗi, timestamp |
| **UI (Electron)**       | Quản lý profile, CSV input, progress bar, logs |
| **Config**              | Poll interval, timeout, parallel render, output folder |

---

## 3️⃣ Flow hoạt động

### A. Lần đầu mở tool / login

1. User mở tool → vào tab **Accounts**  
2. Chọn Chrome profile đã login VEO  
3. Tool kiểm tra session:  
   - **OK** → sẵn sàng render  
   - **Expired** → mở Chrome visible → user login thủ công → tool lưu session  

---

### B. Chuẩn bị prompt → render → download

1. Load CSV: mỗi dòng = 1 cảnh video  
2. Chọn profile để render (multi-account support)  
3. Mở Flow URL trong Chrome profile  
4. Paste prompt → click **Render**  
5. Poll DOM → khi render xong → lấy link download  
6. Tải video về folder output → cập nhật CSV trạng thái  
7. Lặp cho các cảnh tiếp theo  

---

## 4️⃣ CSV Spec

| Column     | Mô tả |
|------------|-------|
| `ID`       | ID cảnh video |
| `Prompt`   | Nội dung prompt mô tả cảnh |
| `Flow_URL` | URL project Flow |
| `Status`   | `pending` / `rendering` / `done` / `error` |

**Ví dụ CSV:**

```
ID,Prompt,Flow_URL,Status
1,"Trailer MU vs LIV","https://flow.veo.com/project/12345","pending"
2,"Highlight trận MU vs LIV","https://flow.veo.com/project/67890","pending"
```

---

## 5️⃣ Config JSON

```json
{
  "pollInterval": 5000,
  "timeout": 600000,
  "parallel": 1,
  "outputFolder": "./output"
}
```

- `pollInterval`: thời gian check render xong (ms)  
- `timeout`: max thời gian chờ render (ms)  
- `parallel`: số tab Chrome render cùng lúc  
- `outputFolder`: thư mục lưu video  

---

## 6️⃣ Electron UI/UX Spec

- **Tab Accounts:**  
  - List profile đã thêm  
  - Nút **Add Profile** → chọn Chrome profile folder  
  - Nút **Test Login** → check session còn sống  
- **Tab Render:**  
  - Chọn CSV file  
  - Chọn output folder  
  - Progress bar cho từng cảnh  
  - Logs realtime (success / error / download path)  
- Popup thông báo khi profile hết hạn / cần login  

---

## 7️⃣ NodeJS Skeleton Structure

```
src/
├─ main/
│  └─ main.js          # CLI/Electron runner
├─ auth/
│  └─ chromeProfile.js # Load profile, detect session
├─ renderer/
│  └─ renderScene.js   # Open Flow, paste prompt, click Render, poll, download
├─ utils/
│  ├─ csvHandler.js    # Load / write CSV
│  └─ logger.js        # Logging
```

**Pseudo code main.js:**

```javascript
const { loadProfile, checkSession } = require('./auth/chromeProfile');
const { loadCSV, updateCSV } = require('./utils/csvHandler');
const { renderScene } = require('./renderer/renderScene');

const profilePath = "./profiles/veo_main";
const scenes = loadCSV("input/scenes.csv");

loadProfile(profilePath);

for (let scene of scenes) {
    if (!checkSession()) {
        await openChromeForLogin(profilePath);
    }
    await renderScene(scene.Flow_URL, scene.Prompt);
    updateCSV(scene.ID, 'done');
}
```

---

## 8️⃣ Roadmap triển khai

| Phase | Nội dung |
|-------|----------|
| **Phase 1 – Core CLI** | Load CSV, load Chrome profile, detect session, render video từng cảnh → download → update CSV |
| **Phase 2 – Electron GUI** | Quản lý profile, CSV input, progress bar, logs, chọn nhiều profile render song song |
| **Phase 3 – Advanced Features** | Resume batch nếu tool crash, scheduler render tự động (node-cron), logging nâng cao |
| **Phase 4 – Build & Deploy** | Build `.exe` Windows bằng `electron-builder`, mở rộng Mac/Linux |

---

✅ **Lưu ý:**  
- Mỗi profile = 1 session Chrome → scale song song cho batch nhiều video  
- Resume từ CSV → tránh mất tiến trình khi tool crash  
- Poll DOM element thay vì sleep cố định → ổn định và nhanh hơn  
- Output folder + logs rõ ràng → dễ debug  