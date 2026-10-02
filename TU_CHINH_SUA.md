# Tự chỉnh website: tên, màu, zoom và thông tin ảnh

Bản cập nhật ngày **02/10/2026**. Bạn có thể chỉnh các mục dưới đây trực tiếp trên GitHub, không cần học toàn bộ mã nguồn. Giữ một bản ZIP dự phòng trước khi sửa.

## 1. Hai file bạn cần biết

| Muốn thay đổi | File cần mở trong repository |
|---|---|
| Tên website, tên chủ kho, lời giới thiệu, chữ nút tải ảnh | `static/settings.js` |
| Zoom tối đa, bước zoom, ảnh lưới, tự mở info, ẩn/hiện thông số máy ảnh | `static/settings.js` |
| Màu nền, màu chữ, màu tím của nút | `static/tokens.css` |
| Các chữ còn lại trên trang đăng nhập hoặc tiêu đề menu | `index.html` — chỉ sửa chữ giữa các thẻ, giữ `id`, `class` và các thuộc tính |

Hai file cấu hình có chú thích tiếng Việt ngay cạnh các giá trị. Bạn không cần chỉnh `main.py` để đổi giao diện. Các file trong `static` được trình duyệt tải công khai: mật khẩu và token Google phải đặt trong **Environment của Render**, không đặt trong file cấu hình giao diện.

## 2. Đổi tên và lời giới thiệu

Mở `static/settings.js`. Ví dụ đổi tên kho và nội dung trang chính bằng cách sửa các dòng tương ứng:

```javascript
brandName: "Kho kỷ niệm của tôi",
ownerName: "Taylor",
heroTitle: "Gom những khoảnh khắc",
heroAccent: "mình yêu.",
heroDescription: "Những chuyến đi và những ngày bình yên.\nMột góc nhỏ để nhớ mãi.",
uploadButtonText: "Thêm ảnh và video",
```

Đây là **các dòng để thay trong file sẵn có**, không thay toàn bộ file bằng đoạn trên. Giữ dòng mở `window.VAULT_SETTINGS = {` và dòng đóng `};`.

`brandName` đổi logo chữ, tên tab trình duyệt và tên ở cuối trang. `ownerName` đổi chữ cái trong avatar và nhãn của nó. `heroTitle`, `heroAccent`, `heroDescription` đổi phần giới thiệu bên trong thư viện. Các lời chào riêng trên màn hình đăng nhập vẫn nằm trong `index.html`.

Giữ dấu nháy kép `"..."` quanh nội dung và dấu phẩy cuối dòng. Nếu cần dấu nháy kép bên trong chữ, viết `\"`; dấu nháy đơn trong `Taylor's` có thể viết bình thường. `\n` là ký hiệu xuống dòng; không gõ Enter giữa một chuỗi đang mở dấu nháy.

## 3. Đổi cách zoom và info

Trong cùng file `static/settings.js`, sửa giá trị tương ứng:

| Cài đặt | Ví dụ | Tác dụng |
|---|---|---|
| `zoomMaxPercent` | `800` | Phóng tối đa 8 lần kích thước gốc; có thể đặt từ 100 đến 1600 |
| `zoomStep` | `1.25` | Nút + nhân mức hiện tại với 1,25; nút − chia cho 1,25. Khoảng hợp lệ 1.05–2 |
| `showCameraMetadata` | `true` | Hiện máy ảnh, ISO, khẩu độ… khi Drive có dữ liệu; `false` ẩn nhóm này |
| `defaultInfoOpen` | `false` | `true` tự mở info mỗi lần mở cửa sổ xem; `false` mở bằng nút ⓘ |
| `defaultTheme` | `"dark"` | Giao diện mặc định tối; đổi thành `"light"` để sáng |
| `previewSize` | `800` | Cạnh dài tối đa bản xem trước ở lưới, từ 200–1200 px; không thay đổi ảnh gốc |

Ví dụ muốn zoom tối đa 1200%, bấm + tăng 50% và luôn mở info:

```javascript
zoomMaxPercent: 1200,
zoomStep: 1.5,
showCameraMetadata: true,
defaultInfoOpen: true
```

Số và `true` / `false` không đặt trong dấu nháy. Dùng dấu chấm trong `1.5`, không dùng dấu phẩy `1,5`. Dòng cuối trong cấu hình không cần dấu phẩy; các dòng trước nó cần dấu phẩy.

Website nhớ lựa chọn sáng/tối trên từng trình duyệt. Nếu đã chọn trước đây, lựa chọn đó được ưu tiên hơn `defaultTheme`; bấm biểu tượng mặt trời để đổi. Có thể dùng cửa sổ riêng tư để kiểm tra mặc định mới.

Zoom 100% nghĩa là một pixel ảnh tương ứng một pixel CSS trên màn hình; nút **Vừa khung** có thể có tỷ lệ thấp hơn với ảnh lớn. Zoom không tạo thêm chi tiết. Video dùng thanh điều khiển riêng và không có thanh zoom ảnh.

**Giữ ảnh nét như bản trên Drive:** cửa sổ xem dùng bản gốc đã tải trước trên trình duyệt; nếu chưa có thì tải gốc khi mở. Bản nhẹ chỉ hiện tạm trong lúc chờ. Bấm **1:1** để kiểm tra chi tiết ở độ phân giải gốc. Nút tải về cũng lấy nguyên file gốc. Lưới ảnh dùng bản xem trước để trang mở nhanh hơn. Không giảm chất lượng của bản gốc khi tải trước.

`previewSize` là giới hạn của ảnh lưới, không bảo đảm thumbnail Drive có đủ độ phân giải đó. Nếu muốn lưới tải nhẹ hơn, giảm xuống `400`; nếu muốn bản xem trước tự tạo rõ hơn trên màn hình lớn, tăng lên `1200`. Xem thêm giới hạn và bộ nhớ đệm ở mục 10 của hướng dẫn triển khai.

## 4. Những gì info có thể hiển thị

Bấm ảnh rồi bấm **ⓘ**, hoặc nhấn **I**. Bấm dấu × bên trong bảng để đóng info mà vẫn xem ảnh.

- Thông tin cơ bản: tên, album, dung lượng, định dạng, kích thước, megapixel và ngày tải lên.
- Thông số chụp: máy ảnh, ống kính, thời gian chụp EXIF, khẩu độ, tốc độ màn trập, ISO, tiêu cự, cân bằng trắng, không gian màu.
- Video: kích thước và thời lượng khi trình duyệt hoặc Drive đọc được.

Thông số chụp chỉ hiện khi Google Drive cung cấp; ảnh chụp màn hình, PNG hoặc ảnh gửi qua ứng dụng đã xóa EXIF thường thiếu thông tin. Nếu chỉ có vài thông số thì chỉ hiện những mục đó. Không thể tạo lại ISO/khẩu độ thật bằng cách sửa tên ảnh. Website không yêu cầu tọa độ GPS. Các trường metadata dùng theo [Google Drive — Files reference](https://developers.google.com/workspace/drive/api/reference/rest/v3/files).

Ngày tải lên được lấy từ ngày tạo tệp trong kho Drive; thời gian chụp EXIF là dữ liệu riêng và có thể không kèm múi giờ. Kích thước trên ảnh là kích thước trình duyệt đọc được; nếu trình duyệt không mở được định dạng, website dùng metadata Drive khi có. Hình demo SVG là hình vector, nên chỉ hiện kích thước hiển thị, không báo megapixel như ảnh chụp.

Muốn đổi nhãn như “Dung lượng” hoặc “Khẩu độ”, tìm hàm `renderInfo` trong `static/app.js` và chỉ đổi chuỗi chữ tương ứng. Đây là chỉnh sửa nâng cao hơn; sao lưu trước và giữ nguyên tên biến như `meta.isoSpeed`. Thêm trường metadata mới có thể cần chỉnh cả `storage.py`, nên không chỉ thêm một dòng chữ trong HTML.

## 5. Tự chỉnh tải trước ảnh gốc

Trong `static/settings.js`, `preloadOriginals: true` bật hàng đợi tự tải toàn bộ ảnh gốc; `originalCacheMB: 512` đặt trần lưu tạm 512 MB trên trình duyệt. Nếu kho ảnh khoảng 1,5 GB và máy có đủ chỗ, đổi thành `originalCacheMB: 2048` để đặt trần 2 GB. Hạn mức/chỗ trống thực tế của trình duyệt có thể thấp hơn trần bạn đặt. `originalMemoryMB: 64` chỉ dùng khi không thể lưu tạm trên thiết bị, nên thường giữ nguyên.

Giữ dấu phẩy cuối dòng, cập nhật đầy đủ bộ mã lên GitHub rồi deploy Render và Ctrl+F5. Tải lại trang trong cùng phiên giữ các bản hoàn chỉnh nếu trình duyệt cho lưu tạm; khóa thư viện xóa chúng. Xem ví dụ, giới hạn, nút tạm dừng và các bước cập nhật tại [TAI_TRUOC_ANH_GOC.html](TAI_TRUOC_ANH_GOC.html) hoặc [TAI_TRUOC_ANH_GOC.md](TAI_TRUOC_ANH_GOC.md).

## 6. Đổi màu website

Mở `static/tokens.css`. Khối `:root` là màu giao diện tối; khối `[data-theme="light"]` là màu giao diện sáng.

| Tên màu | Dùng cho |
|---|---|
| `--accent` | Chữ nhấn, nút và biểu tượng chính |
| `--bg` | Nền website |
| `--sidebar` | Nền menu bên trái |
| `--card` | Nền thẻ ảnh |
| `--text` | Chữ chính |
| `--muted` | Chữ phụ |
| `--border` | Đường viền |
| `--accent-dim`, `--active-border`, `--focus` | Nền nhạt, viền mục được chọn, vòng focus |

Ví dụ muốn đổi điểm nhấn từ tím sang xanh trên giao diện tối, thay các dòng tương ứng **trong khối `:root`**:

```css
--accent: #91c8f6;
--accent-dim: #91c8f612;
--active-border: #91c8f631;
--focus: #91c8f624;
```

Trong khối giao diện sáng có thể dùng màu đậm hơn, ví dụ `--accent: #28679e;`. Mã màu có 8 ký tự sau `#` dùng hai ký tự cuối làm độ trong suốt. Giữ dấu chấm phẩy `;` cuối dòng và giữ đủ dấu `{` / `}`.

Một số màu trong cửa sổ xem ảnh được đặt riêng để luôn dễ nhìn trên nền tối. Nếu muốn chỉnh riêng phần đó, tìm `.viewer` trong `static/style.css`. Đổi `--accent` vẫn tác động nhiều nút và điểm nhấn ở cửa sổ này, nhưng không đổi toàn bộ nền info/zoom.

## 7. Sửa trên GitHub rồi cập nhật Render

1. Giải nén bản ZIP mới. Đưa toàn bộ mã trong `gallery-updated` lên repository đang kết nối Render. Bản này đổi cả `main.py`, `storage.py`, thêm `previews.py` và thư viện Pillow trong `requirements.txt`, đồng thời đổi `index.html` và `static`. Đừng chỉ tải `settings.js` vì bản cũ chưa có zoom/info và bộ nhớ đệm.
2. Mở file muốn chỉnh trên GitHub, bấm biểu tượng bút **Edit this file**.
3. Đổi các giá trị theo ví dụ, kiểm tra dấu nháy, dấu phẩy và dấu ngoặc.
4. Bấm **Commit changes** và lưu vào branch dịch vụ Render đang dùng (log của bạn là `main`).
5. Nếu bật Auto-Deploy **On Commit**, Render sẽ chạy lại sau commit. Nếu để **Off**, mở Render, chọn **Manual Deploy → Deploy latest commit**. Cơ chế này theo [Render — Deploys](https://render.com/docs/deploys).
6. Chờ trạng thái **Live**, mở website và nhấn **Ctrl+F5**. Trên điện thoại, tải lại trang hoặc đóng tab rồi mở lại.
7. Kiểm tra tiêu đề, zoom và info bằng một ảnh JPEG/PNG. Ảnh có EXIF mới kiểm tra được nhóm thông số chụp.

Trong log bạn gửi, build đã xong nhưng **Start Command đang chứa cả dòng bảng Markdown**. Hãy mở **Render → Settings → Start Command**, xóa hết nội dung rồi dán đúng dòng trong khung dưới:

```text
uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1 --proxy-headers --forwarded-allow-ips '*'
```

Chỉ dán dòng bắt đầu bằng `uvicorn`, không kèm tiêu đề ô, dấu `|` hoặc dấu nháy ngược. Giữ dấu nháy đơn quanh `*`. Lưu rồi deploy lại. Dòng này phù hợp cấu hình Python Web Service theo [Render — Deploy FastAPI](https://render.com/docs/deploy-fastapi).

## 8. Nếu sửa xong bị lỗi

| Hiện tượng | Cách kiểm tra |
|---|---|
| Sửa tên mà website không đổi | Kiểm tra commit đã deploy, đúng branch, `settings.js` đã được upload; tải lại bằng Ctrl+F5 |
| Giao diện đứng sau khi sửa settings | Kiểm tra dấu phẩy giữa các dòng, dấu nháy và dòng đóng `};`; xem lỗi đầu tiên trong Console của trình duyệt |
| Màu không đổi | Kiểm tra đang dùng sáng hay tối và đã sửa đúng khối màu; giữ dấu `;` |
| EXIF không hiện | Kiểm tra `showCameraMetadata: true`; thử ảnh gốc có EXIF, tải lại danh sách bằng nút làm mới; không phải mọi ảnh đều có metadata |
| Zoom quá nhỏ khi bấm 1:1 | Ảnh gốc có thể nhỏ. Dùng + để phóng hoặc kiểm tra kích thước trong info |
| Deploy báo lỗi ký tự `|` | Sửa ô Start Command trực tiếp trong Render như bước 6 |

Nếu cần hoàn tác, mở lịch sử file trên GitHub, lấy lại nội dung phiên bản trước hoặc dùng bản ZIP dự phòng, commit và deploy lại. Hướng dẫn kết nối Google, biến môi trường và triển khai đầy đủ nằm trong [HUONG_DAN.html](HUONG_DAN.html) / [HUONG_DAN.md](HUONG_DAN.md).
