# Taylor's Vault — bản cập nhật

Kho ảnh/video riêng cho một chủ sở hữu, dùng FastAPI và Google Drive `appDataFolder`. Giao diện tiếng Việt, không cần Node.js hoặc bước build frontend.

**Bắt đầu từ [HUONG_DAN.md](HUONG_DAN.md) hoặc mở `HUONG_DAN.html` bằng trình duyệt.** Hướng dẫn có cách chạy thử, dùng lại Drive cũ, cập nhật GitHub, cấu hình Render và xử lý lỗi.

Để đổi tên, màu và zoom, đọc [TU_CHINH_SUA.md](TU_CHINH_SUA.md) hoặc mở `TU_CHINH_SUA.html`.

Nếu bấm ảnh hoặc thêm kỷ niệm không phản hồi, đọc [SUA_LOI_MO_ANH.md](SUA_LOI_MO_ANH.md). Bộ mã cần được cập nhật đồng bộ, đặc biệt là `index.html` và `static/app.js`.

## Đã thay đổi

- Sửa lỗi `FastAPI.get() got an unexpected keyword argument 'methods'` và đường dẫn giao diện gọi `localhost` khi deploy.
- Phục vụ HTML/CSS/JS và API trên cùng website; đường dẫn tệp không phụ thuộc thư mục chạy.
- Giao diện mới dùng được trên điện thoại, có chế độ sáng/tối và lưới đều/so le.
- Tìm kiếm tiếng Việt có hoặc không dấu; lọc ảnh, video, yêu thích, album; sắp xếp theo tên, ngày, dung lượng.
- Tải nhiều tệp hoặc chọn thư mục; kéo thả; xem hàng đợi, tiến độ, lỗi từng tệp, dừng tải.
- Đổi tên, chuyển album, yêu thích đồng bộ lên Drive; chọn nhiều để chuyển album, yêu thích hoặc xóa.
- Xem ảnh/video, chuyển bằng phím mũi tên, tải bản gốc; hỗ trợ HTTP Range để phát/tua video.
- Zoom ảnh bằng nút, bàn phím, lăn chuột, chụm hai ngón; kéo để di chuyển, 1:1 và vừa khung.
- Bảng info hiện kích thước, dung lượng, định dạng, ngày tải lên; EXIF máy ảnh khi Drive cung cấp; thời lượng video.
- File `static/settings.js` có chú thích tiếng Việt; bảng màu `static/tokens.css` chia từng dòng dễ chỉnh.
- Lưới tải ảnh xem trước nhẹ, cache RAM có giới hạn; cửa sổ xem và nút tải về giữ nguyên file gốc trên Drive.
- Cảnh báo khi HTML thiếu phần mới; mã phiên bản tài nguyên giao diện và kiểm thử sự tương thích giữa HTML/JavaScript.
- Phiên đăng nhập bằng cookie HttpOnly, kiểm tra CSRF, giới hạn thử mật khẩu, xác nhận trước khi xóa vĩnh viễn.
- Đọc nhiều trang danh sách Drive, kiểm tra tệp thuộc `appDataFolder`, báo lỗi token/quyền/kết nối bằng tiếng Việt.
- Có `render.yaml`, công cụ tạo token riêng trên máy cá nhân và chế độ demo không kết nối Google.

## Cấu hình Render

Chọn **Web Service / Python 3**. Đặt `main.py` ngay trong Root Directory của dịch vụ.

```text
pip install -r requirements.txt
```

Dòng trên dành cho **Build Command**. **Start Command** chỉ dán dòng dưới, không kèm tên ô hoặc dấu bảng:

```text
uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1 --proxy-headers --forwarded-allow-ips '*'
```

**Health Check Path:** `/healthz`.

Thêm `SECRET_PASSWORD` (ít nhất 12 ký tự), `DRIVE_TOKEN_JSON` (JSON token của bạn), `DEMO_MODE=false`, `COOKIE_SECURE=true`, `MAX_UPLOAD_MB=100`. File `.python-version` chọn Python 3.12. Nếu Render đang đặt `PYTHON_VERSION`, biến này có ưu tiên cao hơn file; xem hướng dẫn để chỉnh lại.

## Kiểm thử

```powershell
python -m pip install -r requirements-dev.txt
python -m unittest discover -s tests -v
```

Các kiểm thử Drive dùng phản hồi giả lập và không gửi yêu cầu tới tài khoản Google. Chế độ demo lưu thay đổi trong RAM, tối đa 50 MB toàn kho; khởi động lại sẽ trở về hình minh họa.

## Giới hạn

Đây là kho riêng dùng chung một mật khẩu, chưa có tài khoản tách biệt hay phân quyền nhiều người. Phiên đăng nhập và giới hạn thử mật khẩu được lưu trong RAM, nên cấu hình triển khai dùng một worker; người dùng cần đăng nhập lại sau khi dịch vụ restart. Giữ bản sao tệp quan trọng. Kho dùng Drive của ứng dụng, không phải thư viện mã hóa đầu cuối.

Xóa là vĩnh viễn vì Drive không hỗ trợ đưa tệp `appDataFolder` vào thùng rác. HEIC/TIFF và một số codec video có thể không xem trực tiếp được trong trình duyệt; nút tải bản gốc vẫn sử dụng được. Chọn thư mục tùy trình duyệt; trên điện thoại hãy chọn nhiều tệp nếu không có chức năng thư mục.

Pillow chỉ tạo bản xem trước cho ảnh phù hợp. Nếu không có thumbnail Drive, lần đầu cần tải nguồn tối đa 20 MB / 40 MP về máy chủ; vượt giới hạn hoặc không đọc được thì thẻ hiện nút mở/tải gốc. Không giới hạn độ phân giải ảnh gốc theo giới hạn preview. Cache ảnh riêng tư phải xác thực lại; metadata có thể chậm cập nhật tối đa 60 giây khi tệp đổi từ bên ngoài website.

## Nguồn chính thức

Cấu hình khởi động theo [Render — Deploy FastAPI](https://render.com/docs/deploy-fastapi). Đặc tính kho ẩn và giới hạn xóa theo [Google Drive — Application data](https://developers.google.com/workspace/drive/api/guides/appdata).
