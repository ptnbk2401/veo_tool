# 📽️ Video Auto Generator Tool — VEO 3 (Selenium Version)

## 🧭 Mục tiêu
Tạo một công cụ tự động:
- Đăng nhập tài khoản đã có sẵn trên nền tảng VEO 3.
- Tự động nhập prompt và sinh video theo từng cảnh (scene) từ file `.csv`.
- Tự động theo dõi tiến độ render video.
- Tự động tải về video khi hoàn tất.
- Có thể chạy nhiều cảnh liên tục → phù hợp sản xuất video hàng loạt.

---

## 🧠 Kiến trúc hệ thống

```
CSV file → Python Tool (Selenium) → VEO Flow → Render → Download → Output Folder
```

---

## 📝 Định dạng file CSV

| scene_id | prompt_mo_ta                                | output_file_name          |
|----------|----------------------------------------------|---------------------------|
| 1        | Trailer trận MU - Liv, góc quay từ khán đài | scene_01_mu_liv.mp4       |
| 2        | Slowmotion khán giả reo hò                   | scene_02_crowd_cheer.mp4  |
| 3        | Góc cận cầu thủ bước ra từ đường hầm        | scene_03_tunnel_walk.mp4  |

- `scene_id`: thứ tự cảnh
- `prompt_mo_ta`: nội dung prompt mô tả cảnh
- `output_file_name`: tên file sau khi tải

---

## ⚙️ Chức năng chính

### 1. Đăng nhập tự động
- Sử dụng Selenium mở trình duyệt (Chrome).
- Tự động đăng nhập vào tài khoản đã có sẵn.
- Có thể lưu cookie/session để không phải đăng nhập mỗi lần.

### 2. Load danh sách cảnh
- Đọc dữ liệu từ file `.csv`.
- Hiển thị preview console để kiểm tra trước khi chạy.

### 3. Gửi prompt → Tạo video
- Điền prompt vào ô mô tả.
- Nhấn nút “Generate” (giống thao tác tay).
- Lưu `scene_id` và thời điểm gửi.

### 4. Theo dõi tiến độ render
- Poll trạng thái UI của VEO 3 (ví dụ “Rendering…” → “Complete”).
- Có timeout → nếu render quá lâu thì retry.

### 5. Tải video về
- Khi render xong → bấm nút “Download”.
- Lưu file về thư mục output theo tên định sẵn trong CSV.

### 6. Quản lý log
- Ghi log quá trình (bắt đầu render, thành công, lỗi, thời gian).
- Tạo file `render_log.txt` để dễ kiểm tra sau này.

---

## 🖥️ Giao diện CLI

```bash
$ python veo_auto.py --csv scenes.csv --output ./output
✅ Đăng nhập thành công
📄 Tìm thấy 3 cảnh trong file scenes.csv
🎬 Scene 1: Trailer trận MU - Liv
⏳ Đang render...
✅ Render hoàn tất → scene_01_mu_liv.mp4
...
🏁 Hoàn tất: 3/3 cảnh
```

---

## 🧰 Tech Stack

| Hạng mục                | Công nghệ                         | Ghi chú                                     |
|--------------------------|-------------------------------------|---------------------------------------------|
| Ngôn ngữ chính           | Python                             | Linh hoạt, dễ tích hợp Selenium             |
| Tự động trình duyệt     | `selenium` + `webdriver-manager`    | Điều khiển Chrome                          |
| Đọc CSV                 | `pandas`                            | Xử lý dữ liệu cảnh                         |
| Tải file                | `requests` (nếu có URL), hoặc Selenium click |                                           |
| Giao diện CLI           | `argparse`                          | Tham số dòng lệnh                           |
| Log                     | `logging`                           | Ghi log tiến trình                          |

---

## 🚀 Hướng mở rộng

- ✅ Chạy đa luồng để xử lý nhiều cảnh cùng lúc.
- 🪄 Giao diện web đơn giản (Flask/FastAPI).
- 🧠 Tự động cắt ghép thành video hoàn chỉnh.
- 📡 Đồng bộ lên Drive/S3.

---

## ⚠️ Lưu ý kỹ thuật

- Không mở quá nhiều tab cùng lúc → tránh bị rate limit.
- Nên có delay giữa các cảnh để hệ thống ổn định.
- Có cơ chế retry khi render fail.
- VPS/PC phụ giúp chạy qua đêm → sản xuất hàng loạt.

---

## 📦 Cấu trúc thư mục

```
veo-auto-tool/
├── veo_auto.py
├── requirements.txt
├── scenes.csv
├── output/
└── logs/
    └── render_log.txt
```

---

## 📄 requirements.txt

```
selenium
webdriver-manager
pandas
argparse
requests
logging
```

---

## 🧪 Kế hoạch kiểm thử

| Test Case                        | Kết quả mong đợi                             |
|-----------------------------------|-----------------------------------------------|
| Đăng nhập tự động                 | Vào được trang Flow không cần thao tác tay   |
| Render 1 cảnh                     | Video được tải về sau khi render xong        |
| Render nhiều cảnh                 | Chạy tuần tự, không bị crash giữa chừng      |
| Prompt lỗi                        | Tool log lỗi và chuyển sang cảnh kế tiếp     |
| Download thất bại                 | Retry tối đa 3 lần rồi ghi lỗi vào log       |
