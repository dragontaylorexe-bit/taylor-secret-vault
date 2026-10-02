# Kết quả kiểm tra bản bàn giao

Ngày: 01/10/2026. Môi trường kiểm tra: Windows, Python 3.12.0, FastAPI 0.136.1, trình duyệt trong ứng dụng Codex.

## Kiểm thử tự động

**38/38 kiểm thử thành công.** Chạy bằng:

```text
python -m unittest discover -s tests -v
```

Bao phủ: trang chủ và health check GET/HEAD; chạy ở thư mục khác; tài nguyên giao diện; header bảo vệ; đăng nhập sai/đúng, cookie HttpOnly/Secure/SameSite, CSRF, chặn origin khác, hết phiên và đăng xuất; giới hạn thử mật khẩu; danh sách tệp; sửa tên/album/yêu thích; giới hạn độ dài UTF-8; tải ảnh và nhận dạng loại tệp từ chữ ký; chặn HTML/SVG/tệp rỗng; giới hạn body kể cả chunked; kết quả upload một phần; stream, download, khoảng byte và lỗi 416; xóa; thông báo lỗi Drive; đọc nhiều trang Drive; kiểm tra ownership; bảo toàn appProperties khi sửa; tải Drive bằng file stream; chặn URL upload ngoài Google; làm sạch lỗi upstream; chuyển header Range.

JavaScript vượt kiểm tra cú pháp. `render.yaml` được đọc thành công bằng trình phân tích YAML. Hai thư viện Google Auth 2.59.0 và Google Auth OAuthlib 1.4.1 nạp được từ môi trường sẵn có; token JSON sai và token thiếu refresh token được trả thành lỗi có hướng dẫn, không lộ nội dung bí mật.

Kiểm thử mới: metadata ảnh/video được yêu cầu và chuyển đầy đủ; tệp thiếu metadata không bị tự thêm dữ liệu; metadata từ danh sách scoped được dùng lại; ảnh 1600 × 1000 tạo preview 800 × 500; `/stream/` trả nguyên byte ảnh gốc; cache preview không tải lại nguồn; ETag/304 vẫn kiểm tra đăng nhập và tệp đã xóa; chặn nguồn preview quá lớn/sai định dạng; ưu tiên thumbnail Drive thay vì tải bản gốc; không lộ URL thumbnail trong JSON; chỉ gửi credential thumbnail tới host Google được chấp nhận và tắt redirect. Pillow 12.3.0 nạp và xử lý ảnh thành công.

Kiểm thử bổ sung cho lỗi mở ảnh/tải lên: các ID tĩnh JavaScript dùng phải có trong HTML và các script mới phải được khai báo. Ngăn bàn giao bộ HTML/JavaScript không khớp nhau.

## Kiểm tra giao diện trong trình duyệt

Thực hiện trên máy chủ cục bộ ở chế độ demo, không kết nối Drive thật:

- Đăng nhập, tự khôi phục phiên sau tải lại trang.
- Tìm theo tên và album bằng từ khóa không dấu.
- Mở ảnh, chuyển ảnh và đóng cửa sổ xem.
- Zoom +/−, 1:1, vừa khung, lăn chuột, nhấp đúp, kéo ảnh và phím tắt. Ảnh thử 1600 × 1000 vẫn có naturalWidth/Height đúng trong cửa sổ xem; ở 100%, kích thước hiển thị là 1600 × 1000 pixel CSS. Giới hạn 800% chặn nút +; mở tệp tiếp theo đặt lại mức vừa khung.
- Bảng info hiện ảnh 1600 × 1000, 1,6 MP và các thông số EXIF giả lập (TEST Camera, f/2,8, 1/125 s, ISO 200, 35 mm). Đây là dữ liệu kiểm tra cục bộ được đưa vào kho demo, không phải EXIF thật từ tài khoản Drive.
- Ảnh 128 × 96 thiếu EXIF hiện thông báo; video mẫu hiện 128 × 96 và thời lượng 0:02, ẩn thanh zoom ảnh.
- Viewport 390 × 844: info đọc được, nút đóng hoạt động; ảnh vừa khung đúng 300 × 187,5 trong vùng xem và không tràn ngang. Chụm hai ngón đã có xử lý pointer nhưng chưa kiểm tra trên điện thoại cảm ứng thật.
- Đổi tên với ký tự `<script>` được hiển thị như chữ; chuyển sang album “Đà Lạt”; tìm bằng `da lat`.
- Chọn hai tệp mẫu PNG và MP4, tải lần lượt; giao diện xác nhận lưu 2/2 tệp.
- Video MP4 mẫu đọc đúng thời lượng 2 giây, readyState=4, phát được, không báo lỗi video.
- Chọn tất cả 8 tệp đang hiện và chuyển cùng một album; giao diện xác nhận xử lý 8 tệp.
- Giao diện sáng/tối và viewport điện thoại 390 × 844; không tràn ngang; menu thu gọn không nhận focus khi đóng.
- Kiểm tra chữ tiếng Việt và các tài nguyên tự phục vụ, không phụ thuộc Tailwind CDN/Fancybox.

Các tệp kiểm tra và thay đổi demo được reset bằng khởi động lại máy chủ. Chỉ các hình minh họa nguyên bản đi kèm mã nguồn.

## Kiểm tra lỗi website đang chạy

Ngày 01/10/2026, mở trang công khai `https://taylor-secret-vault.onrender.com/`, không đăng nhập hay thay đổi dữ liệu thật. HTML không có `viewer-info-toggle`, `viewer-info`, `viewer-zoom`, không tải `settings.js`. Console báo lỗi `Cannot read properties of null (reading 'addEventListener')` ở `/static/app.js:346:24`.

Đã dùng HTML công khai đó để tái hiện tại máy với JavaScript mới: bấm ảnh và nút thêm đều không mở dialog, Console còn báo lỗi `setting 'hidden'` trong `toggleInfo`. Sau khi dùng bộ HTML/JavaScript đồng bộ, ảnh PNG mở ở kích thước gốc 128 × 96; cửa sổ thêm mở được; chọn PNG qua bộ chọn tệp và tải thành công, xác nhận “Đã lưu 1/1 tệp”. Với HTML cũ và JavaScript bản sửa, cảnh báo “Bản cập nhật chưa hoàn tất” hiện rõ. Tất cả thao tác có đăng nhập/tải lên đều thực hiện trên demo cục bộ, chưa dùng tài khoản Drive thật.

## Phạm vi chưa xác minh

Chưa deploy lên tài khoản Render/GitHub của bạn và chưa gửi yêu cầu tới tài khoản Google Drive thật. Log bạn gửi đã được đọc: build thành công, Start Command chứa cả dòng bảng Markdown làm bash lỗi ở dấu `|` và thoát status 2. Hướng dẫn đã sửa để dễ sao chép đúng lệnh. Chưa có log của lần deploy lại; tính hợp lệ của token, thumbnail/EXIF do Google cung cấp, tốc độ mạng, giới hạn Render và codec của video thật cần được kiểm tra sau cấu hình.

Phiên và giới hạn thử mật khẩu ở RAM phù hợp cấu hình một worker; chưa hỗ trợ nhiều worker/instance hoặc tài khoản tách biệt. Có hỗ trợ Range nhưng không tự chuyển codec video. Upload bị ngắt có thể đã được Drive lưu: hãy tải lại danh sách trước khi gửi lại.
