# Sửa lỗi không mở ảnh và không thêm kỷ niệm

Đã kiểm tra trang công khai tại **https://taylor-secret-vault.onrender.com/** ngày **01/10/2026**. Chưa đăng nhập hoặc thay đổi dữ liệu trên website thật.

## 1. Nguyên nhân đã xác nhận

Website đang tải JavaScript mới nhưng trang HTML cũ không có các phần `viewer-info-toggle`, `viewer-info` và `viewer-zoom`. Console báo:

```text
TypeError: Cannot read properties of null (reading 'addEventListener')
at /static/app.js:346:24
```

Dòng JavaScript này tìm nút thông tin chưa có trong HTML. Mã bị dừng giữa chừng, trước khi đăng ký thao tác mở cửa sổ tải ảnh. Khi bấm ảnh, hàm mở cửa sổ cũng truy cập phần info đang thiếu nên bị lỗi. Vì vậy cả hai nút đều không hoạt động; một số thao tác được đăng ký trước dòng lỗi vẫn có thể chạy.

Đã tái hiện đúng lỗi bằng HTML lấy từ website thật và JavaScript trong bản ZIP. Khi dùng bộ HTML/JavaScript cùng phiên bản, ảnh mở bình thường và một PNG thử được tải qua giao diện thành công trong chế độ demo cục bộ.

## 2. Bản sửa có gì?

- Giao diện HTML có đầy đủ phần zoom và info, đi cùng JavaScript tương ứng.
- Các đường tải CSS/JavaScript có mã phiên bản mới để tránh dùng tài nguyên cũ đã lưu trong trình duyệt.
- Nếu HTML thiếu các phần mới, website hiện “Bản cập nhật chưa hoàn tất” thay vì chạy nửa chừng với những nút không phản hồi.
- Có kiểm thử kiểm tra các phần tử mà JavaScript dùng đều tồn tại trong HTML. Bản sửa ngày 01/10 vượt **38/38** kiểm thử; bản bổ sung tải trước ngày 02/10 vượt **39/39** kiểm thử Python và **22/22** kiểm thử hàng đợi JavaScript.

Ảnh gốc, zoom, info và ảnh xem trước vẫn giữ các chức năng trong bản trước. Hướng dẫn chung nằm trong `HUONG_DAN.html`; hướng dẫn tự chỉnh tên, màu và zoom nằm trong `TU_CHINH_SUA.html`.

## 3. Cập nhật đúng chỗ trên GitHub

1. Giải nén ZIP mới rồi mở thư mục `gallery-updated`.
2. Mở repository **dragontaylorexe-bit/taylor-secret-vault**, chọn branch `main` như log deploy đã gửi.
3. Xác định thư mục trong repository mà Render đang dùng làm **Root Directory**. Nếu Render để trống, đó là trang gốc repository có `main.py`.
4. Chọn **Add file → Upload files** tại thư mục đó. Tải **các file và thư mục bên trong `gallery-updated`**, để `index.html`, `main.py`, `storage.py`, `previews.py`, `requirements.txt` và thư mục `static` nằm cùng cấp như cấu trúc bên dưới. Không tải riêng `app.js`; cần toàn bộ bộ mã đồng bộ.
5. GitHub sẽ thay nội dung file đã tồn tại ở cùng đường dẫn. Kiểm tra thay đổi của `index.html` trước khi commit: phải có chữ `viewer-info-toggle`, `viewer-zoom` và `20261001-viewer-fix`.
6. Bấm **Commit changes** trên branch dịch vụ đang dùng. Kiểm tra commit mới có cả `index.html` và các file trong `static`.

```text
Thư mục Render chạy (Root Directory):
  main.py
  storage.py
  previews.py
  index.html          ← file mới phải thay đúng file ở đây
  requirements.txt
  static/
    app.js
    settings.js
    style.css
    tokens.css
    demo/...
```

Nếu bạn tải nguyên thư mục `gallery-updated` lên GitHub, code mới nằm trong thư mục con còn code cũ vẫn ở gốc: hãy đặt **Root Directory của Render là `gallery-updated`**. Nếu đưa các file bên trong ra gốc repository, **Root Directory để trống**. Chỉ cần chọn một cách và giữ đường dẫn nhất quán. Hướng dẫn Root Directory theo [Render — Monorepo support](https://render.com/docs/monorepo-support).

Không tải ZIP nguyên khối vào repository để thay mã nguồn: Render cần các file đã giải nén. Các token và mật khẩu vẫn cấu hình riêng trong Environment theo hướng dẫn triển khai.

## 4. Deploy lại trên Render

1. Mở dịch vụ đang phục vụ website, vào **Settings**, kiểm tra branch và Root Directory khớp với bước 3.
2. Kiểm tra Start Command đã sửa đúng từ lỗi log trước. Chỉ dán dòng lệnh, không kèm cả hàng bảng:

```text
uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1 --proxy-headers --forwarded-allow-ips '*'
```

3. Chọn **Manual Deploy → Deploy latest commit**, chờ **Live**. Đối chiếu commit trong log với commit vừa cập nhật. Nếu Auto-Deploy đang chạy commit đó, có thể chờ lần deploy đó xong. Cơ chế deploy theo [Render — Deploys](https://render.com/docs/deploys).
4. Mở website, nhấn **Ctrl+F5**, đăng nhập lại và kiểm tra hai thao tác ở mục 5.

Chỉ sửa file trong ZIP hoặc trên máy chưa thay đổi website đang chạy. Phải đưa lên đúng repository/branch và deploy đúng commit để website nhận bản sửa.

## 5. Kiểm tra sau cập nhật

1. Bấm một ảnh: cửa sổ xem phải mở, có thanh `−`, tỷ lệ zoom, `+`, **1:1**, **Vừa khung** và nút info.
2. Bấm **Thêm kỷ niệm mới**: phải hiện cửa sổ chọn tệp và album.
3. Chọn một PNG/JPEG nhỏ, bấm **Lưu vào thư viện**, chờ thông báo **Đã lưu 1/1 tệp**.
4. Đóng cửa sổ tải lên, mở ảnh vừa thêm và tải lại trang để kiểm tra ảnh vẫn có trong Drive thật.

Nếu cửa sổ tải lên đã mở nhưng bấm lưu báo lỗi Drive/quyền/token, đó là bước khác cần đọc thông báo cụ thể hoặc log mới. Kiểm tra này tại máy chỉ dùng kho demo, chưa xác nhận token và quyền Drive thật của bạn.

Nếu vẫn không mở cửa sổ, mở **F12 → Console**, tải lại trang, xem lỗi đầu tiên. Nếu còn lỗi `viewer-info-toggle` hoặc cảnh báo cập nhật chưa hoàn tất thì HTML đang chạy vẫn chưa đúng bản. Đừng chỉ tải lại `app.js`: kiểm tra lại file `index.html`, Root Directory và commit được deploy.
