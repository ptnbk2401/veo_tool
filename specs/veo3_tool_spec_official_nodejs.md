
# 🧠 VEO3 AUTOMATION TOOL — OFFICIAL TECH SPEC (NodeJS Version)

## 📌 Tổng quan
Tool tự động hoá việc tạo hàng loạt video bằng nền tảng VEO 3.  
Không cần dùng API, thao tác mô phỏng trực tiếp trên giao diện web VEO bằng **Selenium cho NodeJS**, kết hợp với **Electron** để đóng gói thành app `.exe` có UI trực quan.

---

## 🧱 Kiến trúc hệ thống

```
CSV file → Node Tool (Selenium - JS) → VEO Flow → Render → Download → Output Folder
```

| Thành phần               | Công nghệ                                | Ghi chú |
|---------------------------|-------------------------------------------|---------|
| UI                        | React + Vite + Tailwind + shadcn/ui       | Giao diện dashboard |
| Desktop Shell             | Electron                                 | Đóng gói thành `.exe` |
| Automation Engine         | NodeJS + Selenium WebDriver (Chrome)     | Điều khiển browser |
| Storage                   | Local (CSV, JSON, folder output)         | Dễ triển khai |
| Packaging                 | electron-builder                         | Xuất `.exe` cho Windows |
| Task scheduling (Pro)     | Node cron + UI                           | Lên lịch chạy tự động |
| Proxy (Pro)               | Selenium proxy config                    | Tránh giới hạn tài khoản |

---

## ⚙️ Luồng hoạt động chính

1. Người dùng nhập danh sách cảnh quay (prompt) qua file `.csv` hoặc form UI.  
2. Tool mở Chrome ẩn danh → đăng nhập VEO.  
3. Selenium mô phỏng nhập prompt → submit → đợi render.  
4. Theo dõi tiến trình → tự động tải video thành phẩm.  
5. Lưu file về thư mục output, đồng thời ghi log.  
6. (Pro) Scheduler có thể auto chạy vào khung giờ định trước.

---

## 🧭 Module chính

### 1. Account Manager
- Thêm/xoá/sửa tài khoản VEO
- Gắn proxy riêng từng account (Pro)
- Kiểm tra trạng thái đăng nhập

### 2. Prompt Manager
- Import từ CSV (id, title, prompt, tag…)
- Preview prompt trong UI
- Gắn nhãn cho từng job

### 3. Automation Runner
- Chạy song song nhiều job
- Mở Chrome ở background hoặc visible
- Theo dõi tiến trình real-time (WebSocket nội bộ)
- Retry khi thất bại

### 4. Download & File Manager
- Auto tải về video sau khi render xong
- Đặt tên file theo cấu trúc `JobID_Title.mp4`
- Tạo folder theo ngày để dễ quản lý

### 5. UI Dashboard
- Start / Stop tool
- Log real-time (filterable)
- Trạng thái tài khoản / proxy
- Hiển thị số job thành công / lỗi

### 6. Pro Features
- Proxy rotation
- Scheduler
- API nội bộ (gọi từ AI ngoài)
- License Manager

---

## 🪄 Tech Stack chi tiết

| Loại | Công nghệ |
|------|------------|
| Frontend | React + Vite + shadcn/ui + Tailwind + Zustand |
| Backend nội bộ | NodeJS |
| Automation | Selenium WebDriver + ChromeDriver |
| Đóng gói | Electron + electron-builder |
| Lên lịch (Pro) | node-cron |
| Proxy (Pro) | Chrome proxy config |
| Export | CSV, JSON, Log file |

---

## 🖥 Hệ điều hành hỗ trợ
- ✅ Windows (chính)
- 🌱 macOS (sau)
- 🌱 Linux (sau)

> Người dùng chỉ cần tải `.exe` và chạy, **không cần cài NodeJS hay Python**.

---

## 🧭 Lộ trình phát triển
| Giai đoạn | Mô tả |
|-----------|--------|
| v1.0 MVP | Chạy job từ CSV, render và tải video |
| v1.1 | Giao diện Dashboard + Log |
| v1.2 | Proxy, đa tài khoản |
| v2.0 | Scheduler, API nội bộ, bản Pro |

---

## 🧪 Khả năng mở rộng
- Multi-instance chạy trên nhiều VPS
- SaaS hoá với license key
- Thêm AI viết prompt tự động
- Gắn thêm module quản lý project

---

*Phiên bản: 2.0 — Cập nhật chính thức sang NodeJS + Electron (bỏ Python)*
