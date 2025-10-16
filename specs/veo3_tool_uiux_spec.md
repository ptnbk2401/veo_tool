
# 📐 VEO3 TOOL — UI/UX SPECIFICATION

## 1. 🧭 Mục tiêu thiết kế giao diện
- Giao diện trực quan, thao tác nhanh, ưu tiên hiệu suất.
- Hỗ trợ nhiều tab mà không bị lag.
- Theo dõi tiến trình real-time.
- Dễ mở rộng cho bản Pro.
- Responsive (desktop chính, mobile chỉ đọc log).

## 2. 🧰 Tech Stack UI
| Thành phần              | Công nghệ                                     | Lý do chọn                                                                                  |
|--------------------------|-----------------------------------------------|---------------------------------------------------------------------------------------------|
| Frontend Framework       | React + Vite                                 | Nhanh, nhẹ, dễ scale, dễ tích hợp với backend API                                            |
| UI Library               | shadcn/ui + Tailwind CSS                     | Thiết kế gọn, chuyên nghiệp, dễ tuỳ biến                                                     |
| Icon & Animation         | lucide-react + Framer Motion                 | Tăng tính sinh động, rõ ràng khi user tương tác                                             |
| Charts                   | Recharts                                    | Hiển thị dữ liệu chạy tool trực quan                                                       |
| State Management         | Zustand                                     | Nhẹ, đơn giản, phù hợp với dashboard                                                        |
| Packaging                | Electron                                   | Build thành app desktop, dễ port sang Mac/Linux                                            |

## 3. 🧭 Luồng người dùng chính (User Flow)
```
Đăng nhập → Trang Dashboard
              ↓
      Quản lý tài khoản  ←→  Cấu hình tool
              ↓
          Khởi chạy tool
              ↓
      Theo dõi tiến trình real-time
              ↓
    Lưu kết quả → Xuất file CSV / Log
```

## 4. 🪄 Các màn hình chính (UI Modules)

### 4.1. Login & License
- Form nhập license key
- Xác thực bản quyền online
- Thông báo bản dùng thử / hết hạn
- Auto redirect vào dashboard

### 4.2. Dashboard
- Sidebar điều hướng
- Card hiển thị số phiên đang chạy
- Nút Start/Stop toàn bộ tool
- Log console realtime (scrollable + filterable)
- Thanh trạng thái kết nối VPS, proxy, license

### 4.3. Account Manager
- Danh sách tài khoản (table)
- Import/Export CSV
- Thêm/Sửa/Xoá tài khoản
- Gắn Proxy riêng cho từng account (Pro)

### 4.4. Settings
- Cấu hình thời gian delay, luồng chạy song song
- Chọn đường dẫn output CSV
- Toggle module
- API Token (Pro)

### 4.5. Task Scheduler (Pro)
- Giao diện chọn thời gian auto chạy
- Cho phép lặp theo ngày/tuần
- Hiển thị lịch chạy sắp tới

### 4.6. Logs & Reports
- Log console real-time + filter
- Export CSV/JSON
- Biểu đồ thống kê hiệu suất

## 5. 🪄 Tính năng UX nâng cao
- Toast notification khi có lỗi hoặc hoàn thành task
- Tự động lưu state UI
- Tooltip hướng dẫn tại các nút nâng cao
- Hotkey (Ctrl+S, Ctrl+R…)
- Dark/Light mode switch

## 6. 🧭 Định hướng mở rộng
- Drag-drop CSV
- Mini view chạy nền (taskbar)
- Điều khiển từ xa qua API / Web dashboard (SaaS)

---
*Phiên bản: 1.0 — UI/UX Spec for VEO3 Automation Tool*
