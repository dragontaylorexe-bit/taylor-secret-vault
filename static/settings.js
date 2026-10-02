// CẤU HÌNH DỄ CHỈNH — sửa giá trị bên phải, giữ dấu nháy và dấu phẩy.
// Sau khi sửa: commit lên GitHub, chờ Render deploy, rồi Ctrl+F5.
window.VAULT_SETTINGS = {
  brandName: "Taylor's Vault",              // Tên website và logo chữ
  ownerName: "Taylor",                      // Chữ cái đầu dùng cho avatar
  heroTitle: "Một nơi cho những điều",      // Dòng đầu tiêu đề trang chính
  heroAccent: "đáng nhớ.",                  // Dòng chữ nhấn màu tím
  heroDescription: "Từ chuyến đi xa đến một ngày bình thường.\nCất giữ tất cả, theo cách của bạn.",
  uploadButtonText: "Thêm kỷ niệm mới",
  defaultTheme: "dark",                     // "dark" hoặc "light" (lựa chọn đã nhớ được ưu tiên)
  previewSize: 800,                         // Cạnh dài tối đa ảnh lưới (200–1200 px); bản gốc không đổi
  preloadOriginals: true,                   // Tự tải lần lượt bản gốc của TẤT CẢ ảnh sau khi mở khóa
  originalCacheMB: 512,                     // Giữ tối đa 512 MB bản gốc trên trình duyệt (16–4096 MB)
  originalMemoryMB: 64,                     // Nếu trình duyệt không cho lưu tạm: dùng tối đa 64 MB RAM
  zoomMaxPercent: 800,                      // 800 = phóng tối đa 8 lần kích thước gốc
  zoomStep: 1.25,                           // Mỗi lần bấm + / - thay đổi 25%
  showCameraMetadata: true,                 // Hiện thông số máy ảnh khi Drive cung cấp
  defaultInfoOpen: false                    // true = tự mở bảng thông tin khi xem ảnh
};
