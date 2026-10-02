# Hướng dẫn dùng Taylor's Vault và deploy lên Render

Ngày cập nhật: **02/10/2026**.

**Nếu bấm ảnh hoặc “Thêm kỷ niệm mới” không phản hồi:** đọc [SUA_LOI_MO_ANH.html](SUA_LOI_MO_ANH.html). Website thật đã được kiểm tra và xác nhận HTML/JavaScript lệch phiên bản. Cần cập nhật đồng bộ file trong đúng Root Directory.

## 1. Bản này sửa lỗi gì?

Trong mã nguồn bạn cung cấp có dòng:

```python
@app.get("/", methods=["GET", "HEAD"])
```

Mình đã tái hiện lỗi `TypeError: FastAPI.get() got an unexpected keyword argument 'methods'`. Dòng này làm ứng dụng lỗi ngay khi nạp `main.py`. Bản mới dùng:

```python
@app.api_route("/", methods=["GET", "HEAD"])
```

Giao diện cũ còn có `BACKEND_URL = "http://localhost:8000"`. Khi khách mở website trên Render, `localhost` chỉ máy của khách. Bản mới gọi `/files/`, `/upload/`… ngay trên cùng tên miền Render, nên không cần sửa URL hoặc bật CORS mở rộng.

Ngoài ra, bản mới không mở cửa sổ đăng nhập Google trên máy chủ Render. Bạn tạo token trên máy cá nhân một lần rồi thêm vào phần Environment của Render.

**Log Render bạn gửi ngày 01/10/2026 xác nhận build thành công nhưng Start Command sai.** Render đang chạy cả dòng bảng Markdown có `| Start Command |` và dấu nháy ngược, nên báo `syntax error near unexpected token '|'` và thoát với status 2. Xóa toàn bộ nội dung ô đó rồi dán đúng dòng lệnh ở bước 6. Thông báo cập nhật pip trong log chỉ là thông báo, không phải nguyên nhân lỗi này. Cần deploy lại để xác nhận khởi động và kết nối Drive thật.

## 2. Những gì có trong ZIP

```text
gallery-updated/
  main.py                Máy chủ và các chức năng thư viện
  storage.py             Kết nối Google Drive / chế độ xem thử
  previews.py            Ảnh xem trước và bộ nhớ đệm riêng
  index.html             Giao diện chính
  static/                CSS, JavaScript, biểu tượng, hình demo
    settings.js          Tên website, chữ, mức zoom, bật/tắt info
    tokens.css           Màu giao diện sáng và tối, dễ chỉnh
  setup_drive.py         Tạo token Google trên máy cá nhân
  requirements.txt       Thư viện cần cho website
  requirements-dev.txt   Thư viện bổ sung để chạy kiểm thử
  render.yaml            Cấu hình Render Blueprint
  .python-version        Python 3.12
  .gitignore             Bỏ qua token, mật khẩu, môi trường ảo
  .env.example           Danh sách biến cấu hình; không có mật khẩu sẵn
  tests/                 Các kiểm thử tự động
  README.md
  HUONG_DAN.md / HUONG_DAN.html
  TU_CHINH_SUA.md / TU_CHINH_SUA.html
  SUA_LOI_MO_ANH.md / SUA_LOI_MO_ANH.html
  KET_QUA_KIEM_TRA.md
```

ZIP không chứa `.git`, `env`, `token.json`, `client_secret.json` hoặc thông tin đăng nhập từ thư mục gốc. Mã nguồn cũ ở `F:\tool\gallery` được giữ nguyên. Bạn vẫn dùng các tệp Google hiện có của mình theo bước 4.

## 3. Chạy thử giao diện trên Windows

1. Giải nén ZIP vào thư mục mới, ví dụ `F:\tool\gallery-updated`. Kiểm tra thư mục này có `main.py` trực tiếp, tránh lồng thêm một tầng `gallery-updated`.
2. Cài Python 3.12 từ trang chính thức nếu chưa có. Mở PowerShell tại thư mục vừa giải nén. Nếu có nhiều bản Python, dùng `py -3.12` như bên dưới.
3. Tạo môi trường riêng và cài thư viện. Không dùng lại thư mục `env` trong code cũ.

```powershell
Set-Location 'F:\tool\gallery-updated'
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Không cần kích hoạt môi trường, nên không cần thay chính sách chạy script của Windows. Nếu `py` không được nhận diện, dùng `python` thay `py -3.12` sau khi kiểm tra `python --version`.

4. Nhập mật khẩu do bạn tự chọn, tối thiểu 12 ký tự, rồi chạy demo:

```powershell
$vaultPassword = Read-Host 'Nhap mat khau thu vien (it nhat 12 ky tu)' -AsSecureString
$env:SECRET_PASSWORD = [System.Net.NetworkCredential]::new('', $vaultPassword).Password
$env:DEMO_MODE = 'true'
$env:COOKIE_SECURE = 'false'
$env:MAX_UPLOAD_MB = '100'
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

5. Mở **http://127.0.0.1:8000** trong trình duyệt. Nhập đúng mật khẩu vừa chọn. Thử album, tìm kiếm, sáng/tối, tải ảnh/video mẫu, đổi tên và tải xuống.
6. Dừng máy chủ bằng `Ctrl+C` trong PowerShell khi xong.

**Demo chỉ để thử:** các ảnh ban đầu là minh họa, mọi thay đổi chỉ lưu trong RAM và mất khi máy chủ khởi động lại. Kho demo giới hạn tổng cộng 50 MB. Khi dùng ảnh thật, chuyển `DEMO_MODE` sang `false` và kết nối Drive.

File `.env.example` là tài liệu cấu hình. Website không tự đọc file `.env`; dùng biến PowerShell khi chạy tại máy và phần Environment khi chạy trên Render.

## 4. Kết nối lại Google Drive của bạn

### Cách A — dùng token hiện có (nên thử đầu tiên)

Thư mục cũ `F:\tool\gallery` đã có `token.json` và `client_secret.json`. Giữ chúng riêng trên máy cá nhân.

- Mở `F:\tool\gallery\token.json` bằng trình soạn thảo và kiểm tra có `refresh_token`, `client_id`, `client_secret`.
- Sao chép **toàn bộ nội dung JSON**, từ dấu `{` đầu tiên đến dấu `}` cuối cùng, vào giá trị `DRIVE_TOKEN_JSON` trên Render. Không dán tên đường dẫn hoặc bọc thêm một lớp dấu nháy.
- Với chạy cục bộ, sau khi dừng demo, dùng:

```powershell
$env:DEMO_MODE = 'false'
$env:DRIVE_TOKEN_JSON = Get-Content -LiteralPath 'F:\tool\gallery\token.json' -Raw
$env:COOKIE_SECURE = 'false'
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Nếu PowerShell vừa được mở mới, nhập lại biến `SECRET_PASSWORD` như bước 3. Biến PowerShell chỉ áp dụng cho cửa sổ đó. Một cách khác là tự sao chép `token.json` vào thư mục mới để máy chủ đọc khi không có `DRIVE_TOKEN_JSON`; tệp này đã được `.gitignore` bỏ qua.

**Muốn thấy ảnh cũ, cần đúng tài khoản Google và đúng ứng dụng OAuth đã tạo kho cũ.** `appDataFolder` là kho ẩn riêng của từng ứng dụng, không hiện trong “My Drive”. Thay OAuth client có thể làm danh sách trống dù dữ liệu cũ vẫn còn. Bản cập nhật tiếp tục dùng kho này và giữ thuộc tính album cũ. [Giải thích chính thức của Google](https://developers.google.com/workspace/drive/api/guides/appdata).

### Cách B — tạo lại token nếu token cũ hết hạn

1. Mở [Google Cloud Console](https://console.cloud.google.com/) và chọn đúng project đã dùng cho website cũ.
2. Trong **APIs & Services → Library**, kiểm tra **Google Drive API** đã được bật.
3. Trong **Google Auth Platform**, kiểm tra thông tin ứng dụng, đối tượng dùng và danh sách test users nếu ứng dụng đang ở chế độ Testing. Tài khoản bạn đăng nhập phải được cho phép.
4. Trong phần **Clients**, dùng lại OAuth client loại **Desktop app** của ứng dụng cũ. Tải JSON của client này và giữ riêng trên máy. Đổi tên bản tải thành `client_secret.json` trong thư mục code mới nếu muốn dùng lệnh mặc định.
5. Nếu tệp cũ vốn là Desktop app, có thể dùng trực tiếp mà không cần tải lại:

```powershell
.\.venv\Scripts\python.exe setup_drive.py --client 'F:\tool\gallery\client_secret.json'
```

6. Trình duyệt sẽ mở luồng Google. **Bạn tự đăng nhập**, chọn đúng tài khoản và chấp thuận quyền lưu dữ liệu ứng dụng. Công cụ mới chỉ yêu cầu `drive.appdata`.
7. Sau khi hoàn tất, `token.json` mới được tạo trong thư mục code mới. Nếu tệp đã có, công cụ hỏi trước khi ghi đè. Mở token và cập nhật toàn bộ JSON vào `DRIVE_TOKEN_JSON` trên Render; không cần commit token.

Công cụ này chạy trên máy cá nhân, không chạy trong Build Command hoặc Start Command của Render. Nó hỗ trợ Desktop app; nếu JSON là Web application, công cụ sẽ báo rõ. **Trước khi đổi loại client, hãy bảo toàn và xác định cách truy cập kho cũ; một client mới có thể mở một kho riêng khác.** Xem [Google Drive Python quickstart](https://developers.google.com/workspace/drive/api/quickstart/python) cho quy trình OAuth chính thức.

Ứng dụng OAuth external còn ở **Testing** thường được cấp refresh token hết hạn sau 7 ngày đối với quyền Drive. Khi sử dụng lâu dài, xem điều kiện chuyển trạng thái Production trong Google Console; token vẫn có thể bị thu hồi sau đó. [Google — Refresh token expiration](https://developers.google.com/identity/protocols/oauth2#expiration).

## 5. Đưa mã mới lên GitHub

### Nếu cập nhật repository đang kết nối Render

1. Giữ một bản sao thư mục cũ trước khi thay mã.
2. Mở repository của bạn trên GitHub. Ghi nhớ branch Render đang dùng, thường là `main`.
3. Thay `main.py`, `index.html`, `requirements.txt`, `.python-version`, `.gitignore`; thêm `storage.py`, `setup_drive.py`, `render.yaml`, tài liệu và toàn bộ thư mục `static`. Các tệp phải nằm trong cùng thư mục gốc dịch vụ.
4. Commit trên branch đó. Không chỉ upload file ZIP: Render cần mã nguồn đã giải nén.
5. Kiểm tra GitHub có cấu trúc giống bước 2, đặc biệt là `static/settings.js`, `static/app.js`, `static/style.css`, `static/tokens.css`, `static/demo/...`.

Trên giao diện GitHub, có thể dùng **Add file → Upload files**, kéo các tệp và thư mục `static` từ thư mục vừa giải nén rồi commit. Đảm bảo các file bắt đầu bằng dấu chấm cũng được cập nhật; nếu thao tác trình duyệt bỏ sót, dùng GitHub Desktop hoặc Git.

**Chỉ đưa mã nguồn lên GitHub.** Không upload `token.json`, `client_secret.json`, `.env` hoặc `.venv`. Nếu bí mật đã nằm trong Git lịch sử, `.gitignore` không xóa được bí mật cũ; hãy thu hồi/cấp lại token bị lộ và làm sạch lịch sử khi cần.

### Nếu tạo repository mới

Tạo repository, ưu tiên **Private** cho dự án cá nhân. Upload mã nguồn đã giải nén vào thư mục gốc, hoặc dùng GitHub Desktop để chọn thư mục `gallery-updated`, kiểm tra danh sách Changes rồi publish. Mọi người có mật khẩu website vẫn dùng chung một kho; tính private của repository không thay việc bảo vệ website.

## 6. Deploy hoặc cập nhật trên Render

Website có API Python, nên chọn **Web Service**, không chọn Static Site.

### Cập nhật dịch vụ Render đang có

1. Mở dịch vụ trong [Render Dashboard](https://dashboard.render.com/).
2. Vào **Settings**, kiểm tra repository, branch và Root Directory khớp với nơi chứa `main.py`.
3. Nếu `main.py` nằm ngay gốc repo, để Root Directory trống. Nếu code nằm trong `gallery-updated/` của repo, đặt Root Directory là `gallery-updated`.
4. Đặt các mục dưới đây. Sau đó vào **Environment** để thêm biến trong bảng tiếp theo.

| Mục | Giá trị |
|---|---|
| Service type | Web Service |
| Language / Runtime | Python 3 |
| Health Check Path | `/healthz` |
| Instance | Chọn Free nếu bạn muốn bắt đầu thử miễn phí; kiểm tra giới hạn trong Dashboard |

**Ô Build Command:** chỉ sao chép nội dung trong khung sau.

```text
pip install -r requirements.txt
```

**Ô Start Command:** xóa nội dung cũ, chỉ sao chép dòng bắt đầu bằng `uvicorn` trong khung sau. Không dán tên ô, dấu `|`, dấu nháy ngược hoặc cả hàng bảng.

```text
uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1 --proxy-headers --forwarded-allow-ips '*'
```

Giữ nguyên dấu nháy đơn quanh `*`; đó là một phần hợp lệ của lệnh. Start Command dùng biến `$PORT` do Render cung cấp; đừng thay bằng cổng `8000` chỉ vì lúc chạy trên máy dùng cổng đó. Cấu hình bind và build theo [Render — Deploy FastAPI](https://render.com/docs/deploy-fastapi).

Đổi `render.yaml` trong repository không tự sửa ô Start Command của dịch vụ được tạo thủ công. Với lỗi trong log vừa gửi, hãy sửa trực tiếp trong Settings của dịch vụ hiện có, lưu và chọn **Manual Deploy → Deploy latest commit** theo [Render — Deploys](https://render.com/docs/deploys).

| Biến môi trường | Giá trị cần đặt |
|---|---|
| `SECRET_PASSWORD` | Mật khẩu riêng do bạn tự đặt, tối thiểu 12 ký tự; không dùng mật khẩu mẫu hoặc mật khẩu cũ mặc định |
| `DRIVE_TOKEN_JSON` | Toàn bộ nội dung token JSON của đúng kho Drive |
| `DEMO_MODE` | `false` để lưu thật trên Drive |
| `COOKIE_SECURE` | `true` vì Render dùng HTTPS |
| `MAX_UPLOAD_MB` | `100` là mặc định; cho phép 1–500, nên giữ nhỏ khi dùng gói thử |

File `.python-version` đã chọn `3.12`. Nếu Environment có `PYTHON_VERSION` cũ không phù hợp, bỏ biến đó để dùng file, hoặc đặt một phiên bản 3.12.x cụ thể được Render hỗ trợ. Biến `PYTHON_VERSION` ưu tiên hơn `.python-version`. [Render — Python version](https://render.com/docs/python-version).

5. Lưu cấu hình và chọn **Manual Deploy → Deploy latest commit**. Nếu trước đó lỗi thư viện hoặc bộ nhớ build cũ, dùng **Clear build cache & deploy** nếu có.
6. Mở **Logs**. Kết quả mong đợi là cài thư viện thành công, ứng dụng khởi động và Uvicorn lắng nghe cổng Render cung cấp.
7. Khi trạng thái Live, mở URL `https://ten-dich-vu.onrender.com`. Nhập mật khẩu trong `SECRET_PASSWORD`.
8. Kiểm tra danh sách kho cũ, tải một ảnh nhỏ, mở ảnh, tải bản gốc, tải một video ngắn và thử phát/tua. Refresh trình duyệt để xác nhận yêu thích và album vẫn được lưu.

`/healthz` trả `{"status":"ok"}` khi tiến trình hoạt động, kể cả khi Drive chưa được cấu hình. Kiểm tra kho sau đăng nhập mới xác nhận kết nối Drive thành công.

### Tạo dịch vụ mới

Chọn **New → Web Service**, kết nối GitHub và chọn repo mới. Điền cấu hình như trên. Một cách khác là chọn **Blueprint**, chọn repo có `render.yaml` và nhập hai biến bí mật khi Render yêu cầu. Không cần tạo dịch vụ thứ hai nếu bạn chỉ muốn cập nhật dịch vụ hiện có. Cấu trúc Blueprint theo [Render — Blueprint YAML](https://render.com/docs/blueprint-spec).

Render Free có thể ngủ sau 15 phút không có truy cập; lần mở tiếp theo cần chờ khởi động. Tệp trên ổ cục bộ của dịch vụ không bền qua restart/deploy, nên bản này lưu ảnh thật trên Drive. Phiên đăng nhập ở RAM sẽ hết hiệu lực sau restart. Xem [Render — Free services](https://render.com/docs/free) để biết giới hạn băng thông và dịch vụ.

## 7. Sử dụng những tính năng mới

- **Thêm kỷ niệm:** bấm nút tím, nhập album, chọn nhiều tệp hoặc thư mục. Có thể kéo thả tệp vào khung. Khi chọn thư mục bằng nút, tên thư mục được gợi ý làm tên album.
- **Tiến độ:** mỗi tệp gửi lần lượt; đạt 100% vẫn có thể đang đợi Google Drive lưu. Chỉ thông báo “Đã lưu” mới xác nhận hoàn tất. Tệp thành công được bỏ khỏi hàng đợi; tệp lỗi được giữ lại với thông báo riêng.
- **Dừng tải:** dừng việc chờ và không gửi thêm tệp. Tệp đang gửi có thể vẫn được máy chủ/Drive lưu. Tải lại thư viện trước khi thử lại để tránh tạo bản trùng.
- **Album:** bấm tên bên trái hoặc các nút lọc. Album được tạo khi có tệp tải/chuyển vào; chưa hỗ trợ album rỗng, album con hoặc giữ cây thư mục.
- **Tìm kiếm:** nhập tên tệp hoặc album, ví dụ `da lat` tìm được `Đà Lạt`. Phím `/` đưa con trỏ vào ô tìm kiếm.
- **Yêu thích:** bấm trái tim trên ảnh hoặc trong cửa sổ xem; trạng thái được lưu trên Drive và dùng lại giữa các thiết bị.
- **Chọn nhiều:** tích tệp, chuyển cùng album, thêm yêu thích hoặc xóa. “Chọn tất cả đang hiển thị” chỉ chọn các thẻ hiện có; bấm “Xem thêm” để hiện các tệp tiếp theo.
- **Đổi tên:** bấm biểu tượng bút ở dưới thẻ. Giữ phần đuôi `.jpg`, `.png`, `.mp4`… để tiện mở sau khi tải về. Tên album tối đa 110 byte UTF-8; chữ có dấu chiếm nhiều byte hơn.
- **Xem:** bấm ảnh/video. Phím `←` và `→` chuyển mục, `Esc` đóng. Video có thanh tua và nút phát của trình duyệt.
- **Zoom ảnh:** dùng nút `+` / `−`, lăn chuột hoặc chụm hai ngón trên màn hình cảm ứng. Khi ảnh lớn hơn khung, kéo ảnh để xem vùng khác. Nhấp đúp để phóng / trở về vừa khung; nút **1:1** xem kích thước gốc, **Vừa khung** đưa ảnh trở lại. Phím `+`, `−`, `1` và `0` cũng có tác dụng tương ứng. Mức mặc định tối đa 800% kích thước gốc; zoom không làm tăng độ chi tiết của ảnh gốc.
- **Ảnh gốc nét và tải trước:** lưới dùng ảnh xem trước nhẹ; sau mở khóa, website tự tải lần lượt bản gốc toàn thư viện. Thanh phía trên lưới báo đã tải bao nhiêu ảnh, byte/% của ảnh đang tải, tạm dừng/tiếp tục và thử lại. Thẻ “Gốc đã tải” mở bằng bản đã chuẩn bị, giữ nguyên chất lượng Drive; ảnh chưa có vẫn tải khi mở. Mặc định lưu tạm tối đa 512 MB trên trình duyệt, tự giảm theo chỗ còn lại; fallback RAM 64 MB. Khi đầy, báo số ảnh chưa tải trước, không báo hoàn tất giả. Có thể tăng hoặc tắt trong `static/settings.js`; xem [TAI_TRUOC_ANH_GOC.html](TAI_TRUOC_ANH_GOC.html) để chỉnh và triển khai. Giữ trang mở để tải; video không được tải trước.
- **Thông tin ảnh/video:** bấm nút **ⓘ** góc trên của cửa sổ xem hoặc phím `I`. Bảng hiện tên, album, dung lượng, định dạng, kích thước, độ phân giải ảnh, ngày tải lên và thời lượng video. Khi Drive cung cấp EXIF, hiện thêm máy ảnh, ống kính, thời gian chụp, khẩu độ, tốc độ màn trập, ISO, tiêu cự, cân bằng trắng và không gian màu. Thiếu dữ liệu thì bỏ trống mục đó và báo rõ; không tự đoán. Ngày tải lên và thời gian chụp là hai thông tin khác nhau. Không lấy tọa độ GPS. Trên điện thoại, info phủ lên ảnh; bấm dấu × trong bảng để tiếp tục zoom.
- **Tự tùy chỉnh:** mở [TU_CHINH_SUA.html](TU_CHINH_SUA.html) hoặc [TU_CHINH_SUA.md](TU_CHINH_SUA.md). Tên website, nội dung và zoom nằm trong `static/settings.js`; màu nằm trong `static/tokens.css`.
- **Tải bản gốc:** bấm biểu tượng mũi tên tải xuống trên thẻ hoặc trong cửa sổ xem.
- **Sáng/tối:** bấm biểu tượng mặt trời phía trên. Lựa chọn giao diện và kiểu lưới được nhớ trên thiết bị, mật khẩu không được lưu.
- **Khóa thư viện:** bấm mục ở cuối menu. Phiên kéo dài tối đa 12 giờ, cần mở khóa lại sau khi hết hạn hoặc dịch vụ khởi động lại.

Định dạng nhận: JPEG, PNG, GIF, WebP, AVIF, HEIC/HEIF, BMP, TIFF; video MP4, MOV, WebM, Ogg. SVG/HTML không được nhận từ người dùng. HEIC/TIFF và codec video đặc biệt có thể không xem được trực tiếp: tải bản gốc, hoặc đổi sang JPEG/MP4 H.264 trước khi tải lên. Thumbnail video hiện là thẻ biểu tượng; chưa có tính năng tự trích ảnh bìa hoặc chuyển mã video.

Kho chỉ dành cho một chủ sở hữu hoặc nhóm tin cậy dùng chung mật khẩu. Chưa có đăng ký, tài khoản riêng, vai trò quản trị, link chia sẻ công khai hay mã hóa đầu cuối.

## 8. Khi có lỗi, kiểm tra theo bảng này

| Hiện tượng | Cách kiểm tra / xử lý |
|---|---|
| `unexpected keyword argument 'methods'` | Render vẫn chạy code cũ hoặc sai branch/Root Directory. Kiểm tra commit mới có `app.api_route`. |
| `Could not import module main` | Start Command phải dùng `main:app`; Root Directory phải chứa `main.py` và `storage.py`. |
| `ModuleNotFoundError` | Build Command phải cài `requirements.txt`; kiểm tra log build, không upload `env` cũ. |
| Không tìm thấy cổng / deploy timeout | Kiểm tra `--host 0.0.0.0 --port $PORT`; tìm lỗi nạp ứng dụng xuất hiện trước dòng quét cổng. |
| Trang trắng hoặc không có CSS | Kiểm tra thư mục `static` đã lên repo, mở `/static/style.css`, tải lại bằng Ctrl+F5. |
| Bấm ảnh hoặc thêm kỷ niệm không mở cửa sổ; lỗi `addEventListener` với `null` | HTML và JavaScript khác phiên bản. Đưa bộ file mới vào đúng Root Directory, đặc biệt thay `index.html`; xem `SUA_LOI_MO_ANH.html`. |
| `syntax error near unexpected token '|'`, `Exited with status 2` | Start Command có cả hàng bảng hướng dẫn. Xóa toàn bộ ô, dán đúng dòng `uvicorn ...` ở bước 6, lưu rồi deploy lại. |
| Báo `SECRET_PASSWORD` chưa cấu hình | Thêm biến trong Environment, ít nhất 12 ký tự, rồi redeploy. |
| Không vào được dù mật khẩu đúng | Kiểm tra khoảng trắng, đúng dịch vụ, cookie và HTTPS; giữ `COOKIE_SECURE=true` trên Render, `false` khi dùng HTTP localhost. |
| Thử mật khẩu quá nhiều lần | Chờ 15 phút, sau đó thử đúng mật khẩu. Không retry liên tục. |
| Chưa kết nối Drive / JSON không hợp lệ | `DRIVE_TOKEN_JSON` phải là nội dung JSON, có refresh token; không phải tên file hoặc JSON client OAuth. |
| `invalid_grant` / quyền Drive hết hạn | Chạy `setup_drive.py` trên máy cá nhân, cập nhật token. Kiểm tra chế độ Testing 7 ngày và việc thu hồi quyền. |
| Google từ chối truy cập | Kiểm tra API đã bật, scope `drive.appdata`, tài khoản và dung lượng Drive còn trống. |
| Kho trống dù đã có ảnh | Tắt demo, kiểm tra đúng tài khoản và đúng OAuth client tạo kho; kiểm tra bộ lọc/từ khóa. Đừng xóa ứng dụng Google hoặc cấp lại bằng client khác khi chưa xác định kho cũ. |
| Video không phát | Thử MP4 H.264; MOV/HEVC tùy trình duyệt. Bản mới có Range nhưng không tự chuyển codec. |
| Upload vượt giới hạn | Giảm dung lượng tệp hoặc nâng `MAX_UPLOAD_MB` có cân nhắc; demo chỉ chứa tổng 50 MB. |
| Upload đứng 100% | Máy chủ còn đợi Drive. Nếu lỗi hoặc hết thời gian, tải lại danh sách trước khi gửi lại. |
| Mất phiên đăng nhập sau deploy | Phiên ở RAM, dịch vụ restart nên cần nhập mật khẩu lại; ảnh thật trên Drive vẫn còn. |
| Tên file hiển thị ký tự HTML | Tên hiển thị dưới dạng chữ an toàn, không được thực thi thành mã. |

Nếu vẫn lỗi, lấy **20–40 dòng cuối trong Logs** và ghi lại Build Command, Start Command, Root Directory. Che token, client secret và mật khẩu trước khi gửi cho người hỗ trợ.

## 9. Lưu ý về dữ liệu và bản sao

Trong kho `appDataFolder`, Google không hỗ trợ thùng rác cho tệp, nên nút xóa của website xóa vĩnh viễn. Xác nhận trong website nêu rõ điều này. Tải bản sao tệp quan trọng về ổ riêng trước khi xóa. Kho ẩn vẫn có thể bị xóa khi bạn xóa dữ liệu ứng dụng trong cài đặt Drive hoặc gỡ quyền ứng dụng theo cơ chế Google; đừng coi website là bản sao duy nhất. [Google — App data constraints](https://developers.google.com/workspace/drive/api/guides/appdata).

Không cần đặt ảnh thật vào repository. Mật khẩu website và token chỉ đặt trên Render hoặc máy cá nhân. ZIP bàn giao là mã nguồn sạch; bạn bổ sung bí mật của mình khi triển khai.

## 10. Tốc độ tải và độ nét của ảnh

Lưới ảnh ở bản trước gọi bản gốc cho mỗi thẻ. Với hàng chục ảnh dung lượng lớn, máy chủ phải tải nhiều dữ liệu từ Google rồi gửi tiếp tới trình duyệt. Bản này có đường `/preview/` riêng, dùng thumbnail Google khi có, hoặc tạo JPEG xem trước tối đa 800 px ở cạnh dài; ảnh ngoài vùng nhìn vẫn được tải khi cần. Thumbnail Google được lấy qua máy chủ có đăng nhập, theo hướng dẫn proxy ở [Google Drive — thumbnailLink](https://developers.google.com/workspace/drive/api/reference/rest/v3/files).

**Cửa sổ xem và nút tải về vẫn dùng `/stream/` trả đúng file gốc**, không chuyển thành JPEG xem trước. Kiểm tra tự động đã so sánh nội dung trước/sau và xác nhận nguyên dữ liệu. Khi tải xong, dòng trợ giúp ghi “Bản gốc”; nút **1:1** hiển thị ở độ phân giải gốc. Phóng vượt 100% làm pixel lớn hơn, không tạo thêm độ nét.

Bộ nhớ đệm ảnh xem trước trên máy chủ giới hạn 24 MB, tối đa 256 mục, giữ 5 phút; metadata Drive giữ tối đa 60 giây để giảm một lượt hỏi thông tin cho từng ảnh. Khi sửa hoặc xóa từ website, cache liên quan được bỏ. Trình duyệt có thể dùng lại ảnh nhưng phải xác thực lại trước khi nhận phản hồi 304. Đây là cache riêng, không công khai ảnh qua CDN và không làm ảnh thành link chia sẻ công khai. Cache trong RAM mất sau restart/deploy, ảnh thật trên Drive vẫn giữ nguyên.

Nếu Drive chưa tạo thumbnail, lần đầu phải tải bản gốc về máy chủ để thu nhỏ; các lần sau hưởng cache. Để giới hạn RAM của gói nhỏ, chỉ tự tạo preview cho nguồn tối đa 20 MB và 40 megapixel. Định dạng không đọc được hoặc vượt giới hạn hiện nút mở/tải; **bản gốc vẫn xem được nếu trình duyệt hỗ trợ**. GIF xem trước là khung đầu; mở ảnh gốc vẫn giữ hoạt ảnh. Có thể chỉnh `previewSize` trong `static/settings.js` từ 200–1200; chỉ tác động bản xem trước, không đổi dữ liệu ảnh lưu trên Drive.

Chưa đo tốc độ trên Drive và dịch vụ Render của bạn, nên không hứa một số giây hay phần trăm nhanh hơn. Nếu cả trang đăng nhập cũng chậm ở lần mở sau thời gian nghỉ, kiểm tra thời gian khởi động lại của Render Free. Nếu chỉ ảnh gốc chậm, thời gian còn phụ thuộc dung lượng ảnh, mạng từ Google tới Render và mạng tới thiết bị; tải nguyên file lớn luôn cần băng thông. Có thể đo một ảnh điển hình trong tab Network của trình duyệt sau khi deploy để phân biệt thời gian chờ máy chủ và thời gian tải dữ liệu.
