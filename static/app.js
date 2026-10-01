"use strict";

const $ = (id) => document.getElementById(id);
const settings = window.VAULT_SETTINGS || {};
const numberSetting = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
const ZOOM_MAX = numberSetting(settings.zoomMaxPercent, 800, 100, 1600) / 100;
const ZOOM_STEP = numberSetting(settings.zoomStep, 1.25, 1.05, 2);
const PREVIEW_SIZE = Math.round(numberSetting(settings.previewSize, 800, 200, 1200));
const settingText = (key, fallback) => typeof settings[key] === "string" && settings[key].trim() ? settings[key].trim() : fallback;
const state = {files: [], filtered: [], filter: "all", album: null, csrf: "", selected: new Set(),
  selecting: false, limit: 60, view: "grid", viewerIds: [], viewerIndex: 0, queue: [], uploading: false,
  stopping: false, xhr: null, maxMB: 100, editId: null, deleteIds: [], busy: false};
const labels = {all: "Tất cả kỷ niệm", photos: "Hình ảnh", videos: "Thước phim", favorites: "Yêu thích"};
const photo = (f) => (f.mimeType || "").startsWith("image/");
const video = (f) => (f.mimeType || "").startsWith("video/");
const albumOf = (f) => f.appProperties?.album || "Chưa phân loại";
const favorite = (f) => f.appProperties?.favorite === "true";
const normalized = (s) => String(s).toLocaleLowerCase("vi").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
const mediaUrl = (id, download = false) => `/stream/${encodeURIComponent(id)}${download ? "?download=true" : ""}`;
const previewUrl = (file) => `/preview/${encodeURIComponent(file.id)}?size=${PREVIEW_SIZE}&v=${encodeURIComponent(file.version || file.modifiedTime || file.createdTime || "")}`;
const dateOf = (f) => {const d = Date.parse(f.createdTime || f.modifiedTime || ""); return Number.isNaN(d) ? 0 : d;};
const dateText = (f) => dateOf(f) ? new Intl.DateTimeFormat("vi-VN", {day: "2-digit", month: "2-digit", year: "numeric"}).format(dateOf(f)) : "Kỷ niệm của bạn";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.setAttribute("aria-hidden", "true");
  svg.append(use);
  return svg;
}
function iconButton(name, label, handler, className = "") {
  const button = el("button", `icon-button ${className}`);
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(icon(name));
  button.addEventListener("click", handler);
  return button;
}
function formatSize(bytes) {
  bytes = Number(bytes) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const unit = bytes >= 1024 ** 3 ? "GB" : bytes >= 1024 ** 2 ? "MB" : "KB";
  return `${(bytes / 1024 ** ({KB: 1, MB: 2, GB: 3}[unit])).toLocaleString("vi-VN", {maximumFractionDigits: 1})} ${unit}`;
}
function toast(message, error = false) {
  const node = el("div", `toast ${error ? "error" : ""}`);
  node.append(icon(error ? "close" : "check"), el("span", "", message));
  $("toasts").append(node);
  setTimeout(() => node.remove(), error ? 9000 : 5000);
}
class ApiError extends Error {constructor(message, status) {super(message); this.status = status;}}
async function api(path, {method = "GET", body} = {}) {
  let response;
  try {
    response = await fetch(path, {method, credentials: "same-origin", headers: {
      ...(body ? {"Content-Type": "application/json"} : {}),
      ...(method !== "GET" ? {"X-CSRF-Token": state.csrf} : {})}, body: body ? JSON.stringify(body) : undefined});
  } catch {throw new ApiError("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.", 0);}
  let data;
  try {data = await response.json();} catch {data = {};}
  if (!response.ok) {
    if (response.status === 401 && path !== "/auth/login") lockScreen();
    const message = typeof data.detail === "string" ? data.detail : "Dữ liệu chưa hợp lệ hoặc máy chủ chưa sẵn sàng. Hãy thử lại.";
    throw new ApiError(message, response.status);
  }
  return data;
}
const mobileMenu = window.matchMedia("(max-width: 700px)");
function syncSidebar() {
  const open = mobileMenu.matches && $("sidebar").classList.contains("open");
  $("sidebar").inert = mobileMenu.matches && !open;
  $("sidebar-backdrop").hidden = !open;
  $("menu-toggle").setAttribute("aria-expanded", String(open));
  document.body.classList.toggle("menu-open", open);
}
function closeSidebar() {$("sidebar").classList.remove("open"); syncSidebar();}
mobileMenu.addEventListener("change", closeSidebar);
function lockScreen() {
  if (state.xhr) state.xhr.abort();
  state.stopping = true;
  state.csrf = ""; state.files = []; state.selected.clear(); state.selecting = false;
  state.filter = "all"; state.album = null;
  state.viewerIds = [];
  clearQueue();
  $("search").value = "";
  $("gallery").replaceChildren();
  $("viewer-media").replaceChildren();
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  $("app-screen").hidden = true;
  $("login-screen").hidden = false;
  closeSidebar();
  $("password").focus();
}
async function unlock(data) {
  state.csrf = data.csrf; state.maxMB = data.max_upload_mb;
  $("login-screen").hidden = true; $("app-screen").hidden = false;
  $("demo-banner").hidden = !data.demo;
  $("storage-label").textContent = data.demo ? "XEM THỬ · LƯU TẠM" : "GOOGLE DRIVE";
  document.querySelector(".private-note p").textContent = data.demo ? "Kho xem thử chỉ lưu tạm trên máy chủ. Kết nối Drive để lưu kỷ niệm thật." : "Kỷ niệm của bạn được lưu trong kho Google Drive của ứng dụng.";
  $("upload-limit").textContent = `Tối đa ${state.maxMB} MB / tệp`;
  $("password").value = "";
  window.scrollTo({top: 0, behavior: "auto"});
  await loadFiles();
}
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true; button.querySelector("span").textContent = "Đang mở khóa…";
  $("login-error").hidden = true;
  try {await unlock(await api("/auth/login", {method: "POST", body: {password: $("password").value}}));}
  catch (error) {$("login-error").textContent = error.message; $("login-error").hidden = false;}
  finally {button.disabled = false; button.querySelector("span").textContent = "Mở khóa thư viện";}
});
$("toggle-password").addEventListener("click", () => {
  const visible = $("password").type === "password";
  $("password").type = visible ? "text" : "password";
  $("toggle-password").textContent = visible ? "Ẩn" : "Hiện";
  $("toggle-password").setAttribute("aria-label", visible ? "Ẩn mật khẩu" : "Hiện mật khẩu");
});
$("logout").addEventListener("click", async () => {
  if (state.uploading || state.busy) {toast("Hãy dừng hoặc chờ thao tác hiện tại hoàn tất trước khi khóa.", true); return;}
  try {await api("/auth/logout", {method: "POST"}); lockScreen(); toast("Thư viện đã được khóa.");}
  catch (error) {toast(error.message, true);}
});
let loading = false;
async function loadFiles() {
  if (loading || !state.csrf) return;
  loading = true; $("loading").hidden = false; $("error-banner").hidden = true;
  $("refresh").disabled = true;
  try {
    const data = await api("/files/");
    if (!state.csrf) return;
    state.files = Array.isArray(data.files) ? data.files : [];
    const ids = new Set(state.files.map((f) => f.id));
    state.selected.forEach((id) => {if (!ids.has(id)) state.selected.delete(id);});
    render();
  } catch (error) {
    if (error.status !== 401) {$("error-text").textContent = error.message; $("error-banner").hidden = false;}
  } finally {loading = false; $("loading").hidden = true; $("refresh").disabled = false;}
}
function albums() {
  const map = new Map();
  state.files.forEach((f) => map.set(albumOf(f), (map.get(albumOf(f)) || 0) + 1));
  return [...map].sort((a, b) => a[0].localeCompare(b[0], "vi"));
}
function filterBy({filter = state.filter, album = state.album} = {}) {
  if (state.busy) return;
  state.filter = filter; state.album = album; state.limit = 60; state.selected.clear();
  closeSidebar(); render();
}
function filteredFiles() {
  const term = normalized($("search").value.trim());
  const files = state.files.filter((f) =>
    (state.filter !== "photos" || photo(f)) && (state.filter !== "videos" || video(f)) &&
    (state.filter !== "favorites" || favorite(f)) && (!state.album || albumOf(f) === state.album) &&
    (!term || normalized(`${f.name} ${albumOf(f)}`).includes(term)));
  const sort = $("sort").value;
  files.sort((a, b) => sort === "name" ? a.name.localeCompare(b.name, "vi") :
    sort === "largest" ? Number(b.size || 0) - Number(a.size || 0) :
    sort === "oldest" ? dateOf(a) - dateOf(b) : dateOf(b) - dateOf(a));
  return files;
}
function renderNav() {
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.classList.toggle("active", state.filter === button.dataset.filter && !state.album);
  });
  $("nav-count").textContent = state.files.length;
  $("album-nav").replaceChildren(); $("filter-chips").replaceChildren(); $("album-options").replaceChildren();
  const all = el("button", `chip ${!state.album ? "active" : ""}`, "Tất cả album");
  all.addEventListener("click", () => filterBy({album: null})); $("filter-chips").append(all);
  const list = albums();
  for (const [name, count] of list) {
    const nav = el("button", `nav-item ${state.album === name ? "active" : ""}`);
    nav.append(icon("folder"), el("span", "", name), el("span", "album-count", count));
    nav.addEventListener("click", () => filterBy({filter: "all", album: name})); $("album-nav").append(nav);
    const chip = el("button", `chip ${state.album === name ? "active" : ""}`, name);
    chip.append(el("span", "", count)); chip.addEventListener("click", () => filterBy({album: name}));
    $("filter-chips").append(chip);
    const option = el("option"); option.value = name; $("album-options").append(option);
  }
  if (!list.length) $("album-nav").append(el("p", "no-albums", "Album sẽ hiện khi bạn thêm ảnh."));
  $("stat-photos").textContent = state.files.filter(photo).length;
  $("stat-videos").textContent = state.files.filter(video).length;
  $("stat-albums").textContent = list.length;
  $("stat-favorites").textContent = state.files.filter(favorite).length;
  $("total-size").textContent = `${formatSize(state.files.reduce((sum, f) => sum + Number(f.size || 0), 0))} trong thư viện`;
}
function renderSelection() {
  $("bulk-bar").hidden = !state.selecting;
  $("select-toggle").textContent = state.selecting ? "Xong" : "Chọn nhiều";
  $("selection-count").textContent = `Đã chọn ${state.selected.size} tệp`;
  for (const id of ["bulk-album", "bulk-favorite", "bulk-delete"]) $(id).disabled = !state.selected.size || state.busy;
  $("select-all").disabled = state.busy;
}
function makeCard(file) {
  const card = el("article", `media-card ${state.selected.has(file.id) ? "selected" : ""}`);
  const media = el("div", "card-media");
  const open = el("button", "open-media");
  open.setAttribute("aria-label", `Xem ${file.name}`);
  open.addEventListener("click", () => state.selecting ? toggleSelection(file.id) : openViewer(file.id));
  if (photo(file)) {
    const img = el("img"); img.src = previewUrl(file); img.alt = file.name; img.loading = "lazy"; img.decoding = "async";
    img.addEventListener("error", () => {img.hidden = true; if (!open.querySelector(".broken-preview")) open.append(el("span", "broken-preview", "Mở để xem / tải về"));});
    open.append(img);
  } else {const cover = el("span", "video-cover"); cover.append(icon(video(file) ? "video" : "folder")); open.append(cover);}
  media.append(open, el("div", "card-hover"), el("span", "card-album", albumOf(file)));
  const heart = iconButton("heart", favorite(file) ? "Bỏ yêu thích" : "Thêm vào yêu thích", () => setFavorite(file.id), `card-favorite ${favorite(file) ? "is-favorite" : ""}`);
  heart.setAttribute("aria-pressed", String(favorite(file))); media.append(heart);
  if (video(file)) media.append(el("span", "video-badge", "VIDEO"));
  if (state.selecting) {
    const check = el("input", "card-select"); check.type = "checkbox"; check.checked = state.selected.has(file.id);
    check.setAttribute("aria-label", `Chọn ${file.name}`); check.disabled = state.busy;
    check.addEventListener("change", () => toggleSelection(file.id)); media.append(check);
  }
  const info = el("div", "card-info"), text = el("div", "card-text"), actions = el("div", "card-actions");
  const title = el("h3", "card-title", file.name); title.title = file.name;
  text.append(title, el("p", "card-meta", `${dateText(file)} · ${formatSize(file.size)}`));
  const download = el("a", "icon-button"); download.href = mediaUrl(file.id, true); download.download = file.name;
  download.title = "Tải về máy"; download.setAttribute("aria-label", `Tải ${file.name}`); download.append(icon("download"));
  actions.append(download, iconButton("edit", `Sửa ${file.name}`, () => openEdit(file.id)),
    iconButton("trash", `Xóa ${file.name}`, () => confirmDelete([file.id]), "danger"));
  info.append(text, actions); card.append(media, info); return card;
}
function render() {
  renderNav(); state.filtered = filteredFiles();
  const title = state.album ? state.album : labels[state.filter];
  $("library-title").replaceChildren(document.createTextNode(title + " "));
  $("library-title").append(el("span", "", state.filtered.length));
  $("gallery").classList.toggle("masonry", state.view === "masonry");
  $("gallery").replaceChildren(...state.filtered.slice(0, state.limit).map(makeCard));
  $("more-wrap").hidden = state.filtered.length <= state.limit;
  $("empty-state").hidden = !!state.filtered.length || !$("error-banner").hidden;
  const narrowed = !!$("search").value || state.album || state.filter !== "all";
  $("empty-title").textContent = narrowed ? "Chưa tìm thấy kỷ niệm này." : "Một câu chuyện mới đang chờ.";
  $("empty-description").textContent = narrowed ? "Thử một từ khóa khác hoặc bỏ bộ lọc." : "Thêm hình ảnh hoặc video đầu tiên vào thư viện.";
  $("empty-action").textContent = narrowed ? "Bỏ bộ lọc" : "Thêm kỷ niệm";
  renderSelection();
}
function toggleSelection(id) {
  if (state.busy) return;
  state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id); render();
}
document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => filterBy({filter: button.dataset.filter, album: null})));
let searchTimer;
$("search").addEventListener("input", () => {clearTimeout(searchTimer); searchTimer = setTimeout(() => {state.limit = 60; render();}, 180);});
$("sort").addEventListener("change", () => {state.limit = 60; render();});
$("load-more").addEventListener("click", () => {state.limit += 60; render();});
$("refresh").addEventListener("click", loadFiles); $("error-retry").addEventListener("click", loadFiles);
$("empty-action").addEventListener("click", () => {
  if ($( "search").value || state.album || state.filter !== "all") {$("search").value = ""; filterBy({filter: "all", album: null});}
  else openUpload();
});
$("select-toggle").addEventListener("click", () => {if (!state.busy) {state.selecting = !state.selecting; state.selected.clear(); render();}});
$("select-all").addEventListener("click", () => {const ids = state.filtered.slice(0, state.limit).map((f) => f.id);
  const allSelected = ids.every((id) => state.selected.has(id)); ids.forEach((id) => allSelected ? state.selected.delete(id) : state.selected.add(id)); render();});
for (const view of ["grid", "masonry"]) $( `view-${view}`).addEventListener("click", () => {
  state.view = view; for (const type of ["grid", "masonry"]) {$( `view-${type}`).classList.toggle("active", type === view); $( `view-${type}`).setAttribute("aria-pressed", String(type === view));}
  try {localStorage.setItem("vault_view", view);} catch {} render();
});
$("menu-toggle").addEventListener("click", () => {$("sidebar").classList.toggle("open"); syncSidebar();});
$("sidebar-backdrop").addEventListener("click", closeSidebar);
$("theme-toggle").addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  try {localStorage.setItem("vault_theme", theme);} catch {}
});

function showDialog(id) {if (!$(id).open) $(id).showModal();}
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => {
  if (state.busy || (button.dataset.close === "upload-dialog" && state.uploading)) {toast("Hãy chờ thao tác hoàn tất hoặc dùng nút Dừng tải.", true); return;}
  $(button.dataset.close).close();
}));
document.querySelectorAll("dialog").forEach((dialog) => dialog.addEventListener("cancel", (event) => {
  if (state.busy || (dialog.id === "upload-dialog" && state.uploading)) event.preventDefault();
}));
const zoom = {image: null, fit: 1, scale: 1, x: 0, y: 0, fitted: true, pointers: new Map()};
const zoomCanvas = $("viewer-media");
const zoomButtons = ["zoom-in", "zoom-out", "zoom-original", "zoom-fit"];
function infoRow(label, value) {
  if (value === undefined || value === null || value === "") return;
  $("viewer-info-values").append(el("dt", "", label), el("dd", "", String(value)));
}
function durationText(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
function exposureText(value) {
  const seconds = Number(value);
  if (!(seconds > 0)) return "";
  const reciprocal = 1 / seconds;
  const denominator = Math.round(reciprocal);
  if (denominator >= 2 && Math.abs(reciprocal - denominator) / reciprocal < 0.01) return `1/${denominator} s`;
  return `${seconds.toLocaleString("vi-VN", {maximumSignificantDigits: 4})} s`;
}
function renderInfo(file, media) {
  $("viewer-info-values").replaceChildren();
  infoRow("Tên tệp", file.name); infoRow("Album", albumOf(file)); infoRow("Dung lượng", formatSize(file.size));
  infoRow("Định dạng", (file.mimeType || "Không rõ").replace("image/", "").replace("video/", "").toUpperCase());
  const meta = (video(file) ? file.videoMediaMetadata : file.imageMediaMetadata) || {};
  let width = video(file) ? media?.videoWidth : media?.naturalWidth;
  let height = video(file) ? media?.videoHeight : media?.naturalHeight;
  if (!width || !height) {
    width = Number(meta.width); height = Number(meta.height);
    if (!video(file) && Number(meta.rotation) % 2) [width, height] = [height, width];
  }
  if (width > 0 && height > 0) {
    const vector = file.mimeType === "image/svg+xml";
    infoRow(vector ? "Kích thước hiển thị" : "Kích thước", `${width.toLocaleString("vi-VN")} × ${height.toLocaleString("vi-VN")} px`);
    if (!video(file) && !vector) infoRow("Độ phân giải", `${(width * height / 1e6).toLocaleString("vi-VN", {maximumFractionDigits: 2})} MP`);
  } else infoRow("Kích thước", "Chưa có thông tin");
  if (video(file)) {
    const seconds = Number.isFinite(media?.duration) ? media.duration : Number(meta.durationMillis) / 1000;
    if (Number.isFinite(seconds)) infoRow("Thời lượng", durationText(seconds));
  }
  if (dateOf(file)) infoRow("Ngày tải lên", new Intl.DateTimeFormat("vi-VN", {dateStyle: "medium", timeStyle: "short"}).format(dateOf(file)));
  let cameraInfo = false;
  if (!video(file) && settings.showCameraMetadata !== false) {
    const camera = [meta.cameraMake, meta.cameraModel].filter(Boolean).join(" ");
    const pairs = [
      ["Máy ảnh", camera], ["Ống kính", meta.lens], ["Thời gian chụp (EXIF)", meta.time],
      ["Khẩu độ", Number(meta.aperture) > 0 ? `f/${Number(meta.aperture).toLocaleString("vi-VN", {maximumFractionDigits: 2})}` : ""],
      ["Tốc độ màn trập", exposureText(meta.exposureTime)],
      ["ISO", meta.isoSpeed], ["Tiêu cự", Number(meta.focalLength) > 0 ? `${Number(meta.focalLength).toLocaleString("vi-VN")} mm` : ""],
      ["Cân bằng trắng", meta.whiteBalance], ["Không gian màu", meta.colorSpace]
    ];
    pairs.forEach(([label, value]) => {if (value !== undefined && value !== null && value !== "") {infoRow(label, value); cameraInfo = true;}});
  }
  $("viewer-info-note").hidden = video(file) || settings.showCameraMetadata === false || cameraInfo;
  $("viewer-info-note").textContent = "Ảnh này chưa có thông số máy ảnh do Drive cung cấp. Ảnh chụp màn hình hoặc ảnh đã xóa EXIF thường không có các thông số này.";
}
function toggleInfo(open = $("viewer-info").hidden) {
  $("viewer-info").hidden = !open;
  $("viewer").classList.toggle("info-open", open);
  $("viewer-info-toggle").setAttribute("aria-expanded", String(open));
  $("viewer-info-toggle").setAttribute("aria-label", open ? "Ẩn thông tin tệp" : "Hiện thông tin tệp");
  $("viewer-info-toggle").classList.toggle("active", open);
}
$("viewer-info-toggle").addEventListener("click", () => toggleInfo());
$("viewer-info-close").addEventListener("click", () => {toggleInfo(false); $("viewer-info-toggle").focus();});
function clearZoom() {
  for (const id of zoom.pointers.keys()) {
    if (zoomCanvas.hasPointerCapture(id)) zoomCanvas.releasePointerCapture(id);
  }
  zoom.pointers.clear(); zoom.image = null; zoom.x = 0; zoom.y = 0; zoom.fitted = true;
  zoomCanvas.classList.remove("image-mode", "can-pan", "dragging");
  $("viewer").classList.remove("has-image");
  $("viewer-zoom").hidden = true; $("zoom-level").textContent = "—";
  zoomButtons.forEach((id) => {$(id).disabled = true;});
}
function clampZoom() {
  if (!zoom.image) return;
  const maxX = Math.max(0, (zoom.image.naturalWidth * zoom.scale - zoomCanvas.clientWidth) / 2);
  const maxY = Math.max(0, (zoom.image.naturalHeight * zoom.scale - zoomCanvas.clientHeight) / 2);
  zoom.x = Math.max(-maxX, Math.min(maxX, zoom.x));
  zoom.y = Math.max(-maxY, Math.min(maxY, zoom.y));
}
function paintZoom() {
  if (!zoom.image || !zoom.image.naturalWidth) return;
  clampZoom();
  zoom.image.style.width = `${zoom.image.naturalWidth * zoom.fit}px`;
  zoom.image.style.height = `${zoom.image.naturalHeight * zoom.fit}px`;
  zoom.image.style.transform = `translate(-50%, -50%) translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale / zoom.fit})`;
  $("zoom-level").textContent = `${Math.round(zoom.scale * 100)}%`;
  $("zoom-level").title = "Tỷ lệ so với kích thước gốc của ảnh";
  $("zoom-out").disabled = zoom.scale <= zoom.fit / 2 + 0.0001;
  $("zoom-in").disabled = zoom.scale >= ZOOM_MAX - 0.0001;
  $("zoom-fit").classList.toggle("active", zoom.fitted);
  $("zoom-original").classList.toggle("active", !zoom.fitted && Math.abs(zoom.scale - 1) < 0.001);
  zoomCanvas.classList.toggle("can-pan", zoom.image.naturalWidth * zoom.scale > zoomCanvas.clientWidth + 1 || zoom.image.naturalHeight * zoom.scale > zoomCanvas.clientHeight + 1);
}
function measureZoom() {
  if (!zoom.image?.naturalWidth || !zoomCanvas.clientWidth || !zoomCanvas.clientHeight) return;
  zoom.fit = Math.min(1, zoomCanvas.clientWidth / zoom.image.naturalWidth, zoomCanvas.clientHeight / zoom.image.naturalHeight);
  zoom.scale = zoom.fitted ? zoom.fit : Math.max(zoom.fit / 2, Math.min(ZOOM_MAX, zoom.scale));
  paintZoom();
}
function changeZoom(scale, anchor, previousAnchor = anchor) {
  if (!zoom.image?.naturalWidth) return;
  scale = Math.max(zoom.fit / 2, Math.min(ZOOM_MAX, scale));
  const factor = scale / zoom.scale;
  if (anchor) {zoom.x = anchor.x - (previousAnchor.x - zoom.x) * factor; zoom.y = anchor.y - (previousAnchor.y - zoom.y) * factor;}
  else {zoom.x *= factor; zoom.y *= factor;}
  zoom.scale = scale; zoom.fitted = false; paintZoom();
}
function fitZoom() {
  if (!zoom.image) return;
  zoom.fitted = true; zoom.x = 0; zoom.y = 0; measureZoom();
}
function pointInCanvas(event) {
  const rect = zoomCanvas.getBoundingClientRect();
  return {x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2};
}
function pinchPoints() {
  const [a, b] = [...zoom.pointers.values()];
  return {distance: Math.hypot(a.x - b.x, a.y - b.y), center: {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}};
}
new ResizeObserver(measureZoom).observe(zoomCanvas);
$("zoom-in").addEventListener("click", () => changeZoom(zoom.scale * ZOOM_STEP));
$("zoom-out").addEventListener("click", () => changeZoom(zoom.scale / ZOOM_STEP));
$("zoom-fit").addEventListener("click", fitZoom);
$("zoom-original").addEventListener("click", () => {zoom.x = 0; zoom.y = 0; changeZoom(1);});
zoomCanvas.addEventListener("wheel", (event) => {
  if (!zoom.image?.naturalWidth) return;
  event.preventDefault();
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? zoomCanvas.clientHeight : 1);
  changeZoom(zoom.scale * Math.exp(-delta * 0.0015), pointInCanvas(event));
}, {passive: false});
zoomCanvas.addEventListener("dblclick", (event) => {
  if (!zoom.image?.naturalWidth) return;
  event.preventDefault();
  if (zoom.scale > zoom.fit * 1.01) fitZoom();
  else changeZoom(Math.max(1, zoom.fit * 2), pointInCanvas(event));
});
zoomCanvas.addEventListener("pointerdown", (event) => {
  if (!zoom.image?.naturalWidth || event.button !== 0) return;
  event.preventDefault();
  zoom.pointers.set(event.pointerId, pointInCanvas(event));
  zoomCanvas.setPointerCapture(event.pointerId);
  zoomCanvas.classList.add("dragging");
});
zoomCanvas.addEventListener("pointermove", (event) => {
  if (!zoom.pointers.has(event.pointerId)) return;
  const previous = zoom.pointers.get(event.pointerId);
  const before = zoom.pointers.size >= 2 ? pinchPoints() : null;
  const point = pointInCanvas(event); zoom.pointers.set(event.pointerId, point);
  if (before) {
    const after = pinchPoints();
    if (before.distance > 0) changeZoom(zoom.scale * after.distance / before.distance, after.center, before.center);
  } else {zoom.x += point.x - previous.x; zoom.y += point.y - previous.y; paintZoom();}
});
function endPointer(event) {
  zoom.pointers.delete(event.pointerId);
  if (!zoom.pointers.size) zoomCanvas.classList.remove("dragging");
}
for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) zoomCanvas.addEventListener(name, endPointer);
$("viewer").addEventListener("close", () => {$("viewer-media").querySelector("video")?.pause(); clearZoom(); $("viewer-media").replaceChildren();});
function openViewer(id) {
  state.viewerIds = state.filtered.map((f) => f.id); state.viewerIndex = state.viewerIds.indexOf(id);
  toggleInfo(settings.defaultInfoOpen === true);
  renderViewer(); showDialog("viewer");
}
function renderViewer() {
  const file = state.files.find((f) => f.id === state.viewerIds[state.viewerIndex]);
  if (!file) {$("viewer").close(); return;}
  const url = mediaUrl(file.id);
  clearZoom();
  $("viewer-media").querySelector("video")?.pause(); $("viewer-media").replaceChildren();
  let media;
  if (video(file)) {
    media = el("video"); media.controls = true; media.preload = "metadata"; media.playsInline = true;
    media.addEventListener("loadedmetadata", () => {if (zoomCanvas.contains(media)) renderInfo(file, media);});
    $("viewer-help").textContent = "Dùng thanh điều khiển để phát và tua · Esc để đóng";
  } else {
    media = el("img"); media.alt = file.name; media.draggable = false;
    const backdrop = el("img", "viewer-loading-preview"); backdrop.alt = ""; backdrop.src = previewUrl(file);
    backdrop.addEventListener("error", () => backdrop.remove());
    zoomCanvas.append(backdrop);
    zoom.image = media; zoomCanvas.classList.add("image-mode"); $("viewer").classList.add("has-image");
    $("viewer-zoom").hidden = false;
    $("viewer-help").textContent = "Đang tải bản gốc từ Drive… Thanh zoom sẽ sẵn sàng khi ảnh tải xong.";
    media.addEventListener("load", () => {
      if (zoom.image !== media) return;
      backdrop.remove();
      $("viewer-help").textContent = "Bản gốc · Lăn chuột / chụm hai ngón để zoom · Kéo để di chuyển · Nhấp đúp để zoom / vừa khung";
      zoomButtons.forEach((id) => {$(id).disabled = false;}); measureZoom(); renderInfo(file, media);
    });
  }
  media.src = url;
  media.addEventListener("error", () => {
    if (!zoomCanvas.contains(media)) return;
    clearZoom();
    $("viewer-help").textContent = "Dùng phím ← → để chuyển · Esc để đóng";
    media.remove();
    const fallback = el("div", "viewer-fallback"); fallback.append(icon("photo"), el("p", "", "Trình duyệt chưa xem được định dạng này, hoặc kết nối đang gián đoạn. Bạn có thể tải bản gốc về máy."));
    const link = el("a", "button primary", "Tải bản gốc"); link.href = mediaUrl(file.id, true); link.download = file.name; fallback.append(link);
    $("viewer-media").replaceChildren(fallback);
  });
  $("viewer-media").append(media);
  renderInfo(file, media);
  $("viewer-name").textContent = file.name;
  $("viewer-meta").textContent = `${albumOf(file)} · ${dateText(file)} · ${formatSize(file.size)}`;
  $("viewer-position").textContent = `${state.viewerIndex + 1} / ${state.viewerIds.length}`;
  $("viewer-download").href = mediaUrl(file.id, true); $("viewer-download").download = file.name;
  $("viewer-favorite").classList.toggle("active", favorite(file)); $("viewer-favorite").setAttribute("aria-pressed", String(favorite(file)));
  $("viewer-prev").disabled = state.viewerIds.length < 2; $("viewer-next").disabled = state.viewerIds.length < 2;
}
function stepViewer(delta) {state.viewerIndex = (state.viewerIndex + delta + state.viewerIds.length) % state.viewerIds.length; renderViewer();}
$("viewer-prev").addEventListener("click", () => stepViewer(-1)); $("viewer-next").addEventListener("click", () => stepViewer(1));
$("viewer-favorite").addEventListener("click", () => setFavorite(state.viewerIds[state.viewerIndex]));
document.addEventListener("keydown", (event) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
  if ($("viewer").open && zoom.image && ["+", "=", "-", "0", "1"].includes(event.key)) {
    event.preventDefault();
    if (event.key === "0") fitZoom();
    else if (event.key === "1") {zoom.x = 0; zoom.y = 0; changeZoom(1);}
    else changeZoom(zoom.scale * (event.key === "-" ? 1 / ZOOM_STEP : ZOOM_STEP));
  }
  else if ($("viewer").open && event.key.toLowerCase() === "i") {event.preventDefault(); toggleInfo();}
  else if ($( "viewer").open && event.target.tagName !== "VIDEO" && ["ArrowLeft", "ArrowRight"].includes(event.key)) {event.preventDefault(); stepViewer(event.key === "ArrowLeft" ? -1 : 1);}
  else if (event.key === "/" && !$("app-screen").hidden && !document.querySelector("dialog[open]")) {event.preventDefault(); $("search").focus();}
});
function replaceFile(file) {const i = state.files.findIndex((f) => f.id === file.id); if (i >= 0) state.files[i] = file; else state.files.push(file);}
const pendingFavorites = new Set();
async function setFavorite(id) {
  if (pendingFavorites.has(id) || state.busy) return;
  const file = state.files.find((f) => f.id === id); if (!file) return;
  pendingFavorites.add(id);
  try {
    replaceFile((await api(`/files/${encodeURIComponent(id)}`, {method: "PATCH", body: {favorite: !favorite(file)}})).file);
    render(); if ($( "viewer").open) {const updated = state.files.find((f) => f.id === id); $("viewer-favorite").classList.toggle("active", favorite(updated)); $("viewer-favorite").setAttribute("aria-pressed", String(favorite(updated)));}
  } catch (error) {toast(error.message, true);} finally {pendingFavorites.delete(id);}
}
function openEdit(id) {
  if (state.busy) return;
  const file = state.files.find((f) => f.id === id); if (!file) return;
  state.editId = id; $("edit-name").value = file.name; $("edit-album").value = albumOf(file); $("edit-error").hidden = true; showDialog("edit-dialog");
}
$("edit-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (state.busy) return;
  state.busy = true; event.submitter.disabled = true;
  try {replaceFile((await api(`/files/${encodeURIComponent(state.editId)}`, {method: "PATCH", body: {name: $("edit-name").value.trim(), album: $("edit-album").value.trim()}})).file);
    $("edit-dialog").close(); render(); toast("Đã lưu thay đổi.");}
  catch (error) {$("edit-error").hidden = false; $("edit-error").textContent = error.message;}
  finally {state.busy = false; event.submitter.disabled = false; renderSelection();}
});
function confirmDelete(ids) {
  if (state.busy || !ids.length) return;
  state.deleteIds = [...ids];
  const file = state.files.find((f) => f.id === ids[0]);
  $("delete-description").textContent = ids.length === 1 ? `Bạn đang xóa “${file?.name || "tệp này"}”.` : `Bạn đang xóa ${ids.length} tệp đã chọn.`;
  showDialog("delete-dialog");
}
async function batch(ids, action, message) {
  if (state.busy) return;
  state.busy = true; renderSelection(); let completed = 0;
  try {for (const id of ids) {await action(id); completed++; state.selected.delete(id);} toast(`${message} ${completed} tệp.`);}
  catch (error) {toast(`Đã xử lý ${completed}/${ids.length} tệp. ${error.message}`, true);}
  finally {state.busy = false; render(); await loadFiles();}
}
$("confirm-delete").addEventListener("click", async () => {
  if (state.busy) return;
  $("confirm-delete").disabled = true;
  await batch([...state.deleteIds], async (id) => {await api(`/delete/${encodeURIComponent(id)}`, {method: "DELETE"}); state.files = state.files.filter((f) => f.id !== id);}, "Đã xóa");
  $("confirm-delete").disabled = false; $("delete-dialog").close();
});
$("bulk-delete").addEventListener("click", () => confirmDelete([...state.selected]));
$("bulk-favorite").addEventListener("click", () => batch([...state.selected], async (id) => replaceFile((await api(`/files/${encodeURIComponent(id)}`, {method: "PATCH", body: {favorite: true}})).file), "Đã yêu thích"));
$("bulk-album").addEventListener("click", () => {$("move-count").textContent = `Chuyển ${state.selected.size} tệp đã chọn vào cùng một album.`; $("move-album").value = ""; showDialog("move-dialog");});
$("move-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (state.busy) return;
  const album = $("move-album").value.trim(); if (!album) return;
  event.submitter.disabled = true;
  await batch([...state.selected], async (id) => replaceFile((await api(`/files/${encodeURIComponent(id)}`, {method: "PATCH", body: {album}})).file), "Đã chuyển album");
  event.submitter.disabled = false; $("move-dialog").close();
});

function openUpload(newAlbum = false) {
  if (state.busy) return;
  if (!state.uploading) $("upload-album").value = newAlbum ? "" : state.album || "";
  showDialog("upload-dialog"); closeSidebar();
  if (newAlbum) $("upload-album").focus();
}
for (const id of ["hero-upload"]) $(id).addEventListener("click", () => openUpload());
$("new-album").addEventListener("click", () => openUpload(true));
$("choose-files").addEventListener("click", () => $("file-input").click());
$("choose-folder").addEventListener("click", () => $("folder-input").click());
function addFiles(files) {
  if (state.uploading) return;
  let skipped = 0;
  for (const file of files) {
    if (state.queue.length >= 200 || !file.size || file.size > state.maxMB * 1024 ** 2 ||
      !/\.(jpe?g|png|gif|webp|avif|hei[cf]|bmp|tiff?|mp4|mov|webm|ogg|ogv)$/i.test(file.name)) {skipped++; continue;}
    if (state.queue.some((q) => q.file.name === file.name && q.file.size === file.size && q.file.lastModified === file.lastModified)) continue;
    const preview = /^image\/(jpeg|png|gif|webp|avif)$/.test(file.type) ? URL.createObjectURL(file) : null;
    state.queue.push({file, preview, error: "", key: crypto.randomUUID()});
  }
  if (skipped) toast(`Bỏ qua ${skipped} tệp rỗng, định dạng chưa hỗ trợ, vượt ${state.maxMB} MB hoặc vượt 200 tệp trong hàng đợi.`, true);
  renderQueue();
}
$("file-input").addEventListener("change", (event) => {addFiles([...event.target.files]); event.target.value = "";});
$("folder-input").addEventListener("change", (event) => {
  const files = [...event.target.files];
  if (!$("upload-album").value) $("upload-album").value = files[0]?.webkitRelativePath.split("/")[0] || "";
  addFiles(files); event.target.value = "";
});
for (const name of ["dragenter", "dragover"]) $("drop-zone").addEventListener(name, (event) => {event.preventDefault(); if (!state.uploading) $("drop-zone").classList.add("dragover");});
$("drop-zone").addEventListener("dragleave", () => $("drop-zone").classList.remove("dragover"));
$("drop-zone").addEventListener("drop", (event) => {event.preventDefault(); $("drop-zone").classList.remove("dragover"); addFiles([...event.dataTransfer.files]);});
function removeQueue(key) {
  const q = state.queue.find((q) => q.key === key); if (q?.preview) URL.revokeObjectURL(q.preview);
  state.queue = state.queue.filter((q) => q.key !== key); renderQueue();
}
function clearQueue() {
  state.queue.forEach((q) => {if (q.preview) URL.revokeObjectURL(q.preview);}); state.queue = [];
  renderQueue();
}
$("clear-queue").addEventListener("click", () => {if (!state.uploading) {clearQueue(); $("upload-progress").hidden = true;}});
function renderQueue() {
  $("upload-queue").replaceChildren();
  for (const q of state.queue) {
    const row = el("div", "queue-item"); let thumb;
    if (q.preview) {thumb = el("img", "queue-thumb"); thumb.src = q.preview; thumb.alt = "";}
    else {thumb = el("span", "queue-thumb"); thumb.append(icon(q.file.type.startsWith("video/") ? "video" : "photo"));}
    const details = el("div", "queue-details"); details.append(el("strong", "", q.file.name), el("small", q.error ? "queue-error" : "", q.error || formatSize(q.file.size)));
    const remove = iconButton("close", `Bỏ chọn ${q.file.name}`, () => removeQueue(q.key)); remove.disabled = state.uploading;
    row.append(thumb, details, remove); $("upload-queue").append(row);
  }
  $("queue-summary").textContent = state.queue.length ? `${state.queue.length} tệp · ${formatSize(state.queue.reduce((sum, q) => sum + q.file.size, 0))}` : "Chưa chọn tệp nào.";
  $("start-upload").disabled = state.uploading || !state.queue.length;
  for (const id of ["choose-files", "choose-folder", "clear-queue", "upload-album"]) $(id).disabled = state.uploading;
  $("cancel-upload").hidden = !state.uploading;
}
function sendFile(q, album, position, total) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); state.xhr = xhr;
    const body = new FormData(); body.append("files", q.file); body.append("album", album);
    $("upload-status").textContent = `${position}/${total} · ${q.file.name}`;
    $("progress").value = 0; $("upload-percent").textContent = "0%";
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.round(event.loaded / event.total * 100);
      $("progress").value = percent; $("upload-percent").textContent = `${percent}%`;
      if (percent === 100) $("upload-status").textContent = `${position}/${total} · Đang chờ Drive lưu tệp…`;
    });
    xhr.addEventListener("load", () => {
      let data = {}; try {data = JSON.parse(xhr.responseText);} catch {}
      if (xhr.status >= 200 && xhr.status < 300 && data.files?.length) resolve(data.files[0]);
      else {if (xhr.status === 401) lockScreen(); reject(new ApiError(typeof data.detail === "string" ? data.detail : "Tải chưa thành công. Kiểm tra thư viện trước khi thử lại.", xhr.status));}
    });
    xhr.addEventListener("error", () => reject(new ApiError("Mất kết nối. Kiểm tra thư viện trước khi thử lại để tránh trùng tệp.", 0)));
    xhr.addEventListener("timeout", () => reject(new ApiError("Hết thời gian chờ. Kiểm tra thư viện trước khi thử lại.", 0)));
    xhr.addEventListener("abort", () => reject(new ApiError("Đã dừng. Tệp có thể vẫn được Drive lưu; kiểm tra thư viện trước khi thử lại.", 0)));
    xhr.open("POST", "/upload/"); xhr.timeout = 15 * 60 * 1000; xhr.setRequestHeader("X-CSRF-Token", state.csrf); xhr.send(body);
  });
}
$("start-upload").addEventListener("click", async () => {
  if (state.uploading || !state.queue.length) return;
  const album = $("upload-album").value.trim() || "Chưa phân loại";
  if (new TextEncoder().encode(album).length > 110) {toast("Tên album vượt 110 byte UTF-8. Hãy đặt tên ngắn hơn.", true); return;}
  state.uploading = true; state.stopping = false; renderQueue(); $("upload-progress").hidden = false;
  const queue = [...state.queue]; let succeeded = 0, failed = 0;
  for (let n = 0; n < queue.length; n++) {
    if (state.stopping) break;
    const q = queue[n];
    try {const file = await sendFile(q, album, n + 1, queue.length); if (!state.csrf) break;
      replaceFile(file); removeQueue(q.key); succeeded++;}
    catch (error) {q.error = error.message; failed++; renderQueue(); if ([0, 401, 403, 429, 503].includes(error.status)) state.stopping = true;}
  }
  state.uploading = false; state.xhr = null; renderQueue(); render();
  $("upload-status").textContent = `Đã lưu ${succeeded}/${queue.length} tệp${state.stopping ? " · Đã dừng" : ""}`;
  if (succeeded) toast(`Đã thêm ${succeeded} kỷ niệm vào “${album}”.`);
  if (failed) toast("Một số tệp chưa được xác nhận lưu. Xem thông báo trong hàng đợi và kiểm tra thư viện trước khi thử lại.", true);
  await loadFiles();
});
$("cancel-upload").addEventListener("click", () => {state.stopping = true; state.xhr?.abort();});
function updateConnection() {
  $("connection").classList.toggle("offline", !navigator.onLine);
  $("connection").querySelector("span").textContent = navigator.onLine ? "Đã mở khóa" : "Mất kết nối";
}
window.addEventListener("online", updateConnection); window.addEventListener("offline", updateConnection);
(async function init() {
  const brand = settingText("brandName", "Taylor's Vault");
  document.title = `${brand} · Kho kỷ niệm riêng tư`;
  document.querySelectorAll(".brand > span:last-child").forEach((node) => {
    const tagline = node.querySelector("small"); node.replaceChildren(document.createTextNode(brand)); if (tagline) node.append(tagline);
  });
  $("viewer-info-toggle").title = "Thông tin (I)";
  document.querySelector(".avatar").textContent = Array.from(settingText("ownerName", "Taylor"))[0].toLocaleUpperCase("vi");
  document.querySelector(".avatar").setAttribute("aria-label", `Kho riêng của ${settingText("ownerName", "Taylor")}`);
  document.querySelector(".welcome h1").replaceChildren(document.createTextNode(settingText("heroTitle", "Một nơi cho những điều")), el("br"), el("em", "", settingText("heroAccent", "đáng nhớ.")));
  document.querySelector(".welcome-copy p").textContent = settingText("heroDescription", "Từ chuyến đi xa đến một ngày bình thường.\nCất giữ tất cả, theo cách của bạn.");
  $("hero-upload").replaceChildren(icon("plus"), document.createTextNode(settingText("uploadButtonText", "Thêm kỷ niệm mới")));
  document.querySelector(".main-footer > span:first-child").textContent = brand.toLocaleUpperCase("vi");
  if (["dark", "light"].includes(settings.defaultTheme)) document.documentElement.dataset.theme = settings.defaultTheme;
  try {
    // Remove the plaintext password stored by the previous version on this origin.
    localStorage.removeItem("gallery_pass");
    const theme = localStorage.getItem("vault_theme"); if (["dark", "light"].includes(theme)) document.documentElement.dataset.theme = theme;
    const view = localStorage.getItem("vault_view"); if (["grid", "masonry"].includes(view)) {
      state.view = view; for (const v of ["grid", "masonry"]) {$( `view-${v}`).classList.toggle("active", v === view); $( `view-${v}`).setAttribute("aria-pressed", String(v === view));}
    }
  } catch {}
  updateConnection(); syncSidebar();
  try {await unlock(await api("/auth/session"));}
  catch (error) {if (error.status !== 401) {$("login-error").hidden = false; $("login-error").textContent = error.message;}}
})();
