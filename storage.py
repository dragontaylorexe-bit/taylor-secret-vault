"""Google Drive appDataFolder storage, with an explicit local preview store."""
import json
import os
import re
import threading
import time
import uuid
from collections import OrderedDict
from datetime import datetime, timezone
from urllib.parse import urlsplit

import requests

FIELDS = ("id,name,mimeType,size,createdTime,modifiedTime,version,thumbnailLink,appProperties,spaces,"
          "imageMediaMetadata(width,height,rotation,time,cameraMake,cameraModel,lens,exposureTime,aperture,focalLength,isoSpeed,whiteBalance,colorSpace),"
          "videoMediaMetadata(width,height,durationMillis)")
API = "https://www.googleapis.com/drive/v3/files"
SCOPES = ["https://www.googleapis.com/auth/drive.appdata"]


class StorageError(Exception):
    def __init__(self, message, status=503, code="storage_unavailable"):
        super().__init__(message)
        self.message, self.status, self.code = message, status, code


class DriveStore:
    def __init__(self, base):
        self.base = base
        self.credentials = None
        self.lock = threading.Lock()
        self.metadata = OrderedDict()
        self.metadata_lock = threading.Lock()

    def remember(self, item):
        if not item.get("id") or "appDataFolder" not in item.get("spaces", []) or item.get("trashed"):
            return
        with self.metadata_lock:
            self.metadata[item["id"]] = (time.monotonic(), dict(item))
            self.metadata.move_to_end(item["id"])
            while len(self.metadata) > 2000:
                self.metadata.popitem(last=False)

    def token(self):
        # Deferred import keeps / and /healthz available even before Drive is configured.
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request
        from google.auth.exceptions import RefreshError, TransportError
        with self.lock:
            if not self.credentials:
                try:
                    raw = os.getenv("DRIVE_TOKEN_JSON")
                    if not raw:
                        path = self.base / "token.json"
                        if not path.exists():
                            raise StorageError("Chưa kết nối Drive. Hãy thêm DRIVE_TOKEN_JSON trong Environment của Render.")
                        raw = path.read_text(encoding="utf-8-sig")
                    info = json.loads(raw)
                    if isinstance(info, str):
                        info = json.loads(info)
                    if not isinstance(info, dict) or not all(info.get(k) for k in ("refresh_token", "client_id", "client_secret")):
                        raise ValueError("incomplete token")
                    # Never refresh a secret against an arbitrary URL from a token file.
                    info["token_uri"] = "https://oauth2.googleapis.com/token"
                    self.credentials = Credentials.from_authorized_user_info(info, scopes=info.get("scopes") or SCOPES)
                except (ValueError, KeyError, OSError, TypeError):
                    raise StorageError("DRIVE_TOKEN_JSON chưa hợp lệ hoặc thiếu refresh_token. Xem mục kết nối Drive trong hướng dẫn.") from None
            try:
                if not self.credentials.valid:
                    self.credentials.refresh(Request())
            except RefreshError:
                self.credentials = None
                raise StorageError("Quyền truy cập Drive đã hết hạn hoặc bị thu hồi. Tạo token mới bằng setup_drive.py rồi cập nhật Render.", code="drive_auth") from None
            except TransportError:
                raise StorageError("Chưa thể kết nối Google. Vui lòng thử lại sau.", code="drive_network") from None
            return self.credentials.token

    def request(self, method, url, **kwargs):
        headers = dict(kwargs.pop("headers", {}))
        headers["Authorization"] = f"Bearer {self.token()}"
        try:
            response = requests.request(method, url, headers=headers, timeout=kwargs.pop("timeout", (15, 180)), **kwargs)
        except requests.RequestException:
            raise StorageError("Kết nối Drive bị gián đoạn. Hãy tải lại danh sách trước khi thử tải tệp lại.", code="drive_network") from None
        if response.status_code in (200, 201, 204, 206, 416):
            return response
        status = response.status_code
        response.close()
        if status == 404:
            raise StorageError("Tệp này không còn tồn tại hoặc không thuộc kho của ứng dụng.", 404, "not_found")
        if status == 403:
            raise StorageError("Google từ chối truy cập. Kiểm tra Drive API, quyền drive.appdata và dung lượng Drive.", 503, "drive_permission")
        if status == 401:
            with self.lock:
                self.credentials = None
            raise StorageError("Token Drive không hợp lệ. Hãy kiểm tra hoặc tạo lại token.", code="drive_auth")
        if status == 429:
            raise StorageError("Drive đang giới hạn số yêu cầu. Vui lòng đợi rồi thử lại.", 429, "drive_limit")
        raise StorageError("Drive chưa xử lý được yêu cầu. Hãy thử lại sau.", code=f"drive_{status}")

    def json_request(self, method, url, **kwargs):
        with self.request(method, url, **kwargs) as response:
            if response.status_code == 416:
                raise StorageError("Drive chưa xử lý được yêu cầu này.", 502)
            try:
                return response.json()
            except ValueError:
                raise StorageError("Drive trả về phản hồi không hợp lệ.", 502) from None

    def list_files(self):
        files = []
        page = None
        seen_pages = set()
        while True:
            params = {"spaces": "appDataFolder", "q": "'appDataFolder' in parents and trashed=false",
                      "fields": f"nextPageToken,files({FIELDS})", "pageSize": 1000}
            if page: params["pageToken"] = page
            data = self.json_request("GET", API, params=params)
            files.extend(data.get("files", []))
            for item in data.get("files", []):
                self.remember(item)
            page = data.get("nextPageToken")
            if not page: return files
            if page in seen_pages:
                raise StorageError("Không tải được toàn bộ danh sách Drive. Vui lòng thử lại.", 502)
            seen_pages.add(page)

    def get(self, file_id):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,200}", file_id):
            raise StorageError("Mã tệp không hợp lệ.", 404)
        with self.metadata_lock:
            cached = self.metadata.get(file_id)
            if cached and time.monotonic() - cached[0] < 60:
                return dict(cached[1])
        item = self.json_request("GET", f"{API}/{file_id}", params={"fields": FIELDS + ",trashed"})
        if "appDataFolder" not in item.get("spaces", []) or item.get("trashed"):
            raise StorageError("Tệp không thuộc kho của ứng dụng.", 404, "outside_vault")
        self.remember(item)
        return item

    def upload(self, file, name, mime, size, album):
        metadata = {"name": name, "parents": ["appDataFolder"], "appProperties": {"album": album, "favorite": "false"}}
        with self.request("POST", "https://www.googleapis.com/upload/drive/v3/files",
                          params={"uploadType": "resumable", "fields": FIELDS}, json=metadata,
                          headers={"X-Upload-Content-Type": mime, "X-Upload-Content-Length": str(size)}) as response:
            location = response.headers.get("Location", "")
        parsed = urlsplit(location)
        if parsed.scheme != "https" or parsed.hostname != "www.googleapis.com":
            raise StorageError("Drive chưa tạo được phiên tải lên.", 502)
        file.seek(0)
        item = self.json_request("PUT", location, data=file,
                                 headers={"Content-Type": mime, "Content-Length": str(size)})
        self.remember(item)
        return item

    def update(self, file_id, changes):
        item = self.get(file_id)
        body = {}
        if "name" in changes: body["name"] = changes["name"]
        props = dict(item.get("appProperties", {}))
        if "album" in changes: props["album"] = changes["album"]
        if "favorite" in changes: props["favorite"] = "true" if changes["favorite"] else "false"
        if "album" in changes or "favorite" in changes: body["appProperties"] = props
        item = self.json_request("PATCH", f"{API}/{file_id}", params={"fields": FIELDS}, json=body)
        self.remember(item)
        return item

    def delete(self, file_id):
        self.get(file_id)
        with self.request("DELETE", f"{API}/{file_id}"):
            pass
        with self.metadata_lock:
            self.metadata.pop(file_id, None)

    def thumbnail(self, item):
        link = item.get("thumbnailLink", "")
        parsed = urlsplit(link)
        host = (parsed.hostname or "").lower()
        allowed = host.endswith(".googleusercontent.com") or host in {"lh3.google.com", "drive.google.com"}
        if parsed.scheme != "https" or not allowed or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise StorageError("Drive chưa có ảnh xem trước hợp lệ.", 404)
        # No redirects: never forward a Google credential to an unvalidated host.
        return self.request("GET", link, stream=True, allow_redirects=False, timeout=(10, 30))

    def stream(self, file_id, byte_range=None):
        headers = {"Range": byte_range} if byte_range else {}
        return self.request("GET", f"{API}/{file_id}", params={"alt": "media"}, headers=headers, stream=True)


class MemoryStream:
    def __init__(self, data, byte_range):
        self.status_code = 200
        self.headers = {"Content-Length": str(len(data))}
        self.data = data
        if byte_range:
            start, end = byte_range.removeprefix("bytes=").split("-")
            start_i = int(start) if start else max(0, len(data) - int(end))
            end_i = min(len(data) - 1, int(end)) if start and end else len(data) - 1
            if start_i >= len(data) or end_i < start_i:
                self.status_code = 416
                self.data = b""
                self.headers = {"Content-Range": f"bytes */{len(data)}", "Content-Length": "0"}
            else:
                self.status_code = 206
                self.data = data[start_i:end_i + 1]
                self.headers = {"Content-Range": f"bytes {start_i}-{end_i}/{len(data)}", "Content-Length": str(len(self.data))}

    def iter_content(self, chunk_size):
        for start in range(0, len(self.data), chunk_size):
            yield self.data[start:start + chunk_size]

    def close(self):
        pass


class DemoStore:
    """Synthetic sample art and temporary uploads; never connects to Google."""
    def __init__(self, folder):
        self.items = {}
        self.data = {}
        self.lock = threading.RLock()
        albums = ["Những chuyến đi", "Bình yên", "Những chuyến đi", "Bình yên", "Sắc màu", "Sắc màu"]
        names = ["Miền núi", "Chiều bên hồ", "Bên bờ biển", "Góc phố", "Miền cát", "Đêm yên"]
        for n, path in enumerate(sorted(folder.glob("*.svg"))):
            file_id = f"demo-{n}"
            data = path.read_bytes()
            self.data[file_id] = data
            self.items[file_id] = {"id": file_id, "name": names[n % len(names)] + ".svg",
                "mimeType": "image/svg+xml", "size": str(len(data)), "createdTime": f"2026-09-{20+n:02}T08:30:00Z",
                "appProperties": {"album": albums[n % len(albums)], "favorite": "true" if n in (0, 3) else "false"}}

    def list_files(self):
        with self.lock: return json.loads(json.dumps(list(self.items.values())))

    def get(self, file_id):
        with self.lock:
            if file_id not in self.items: raise StorageError("Không tìm thấy tệp.", 404)
            return json.loads(json.dumps(self.items[file_id]))

    def upload(self, file, name, mime, size, album):
        with self.lock:
            if sum(len(data) for data in self.data.values()) + size > 50 * 1024 * 1024:
                raise StorageError("Chế độ xem thử chỉ lưu tạm tối đa 50 MB. Kết nối Drive để sử dụng thật.", 413)
            file_id = uuid.uuid4().hex
            self.items[file_id] = {"id": file_id, "name": name, "mimeType": mime, "size": str(size),
                "createdTime": datetime.now(timezone.utc).isoformat(), "appProperties": {"album": album, "favorite": "false"}}
            self.data[file_id] = file.read()
            return self.get(file_id)

    def update(self, file_id, changes):
        with self.lock:
            self.get(file_id)
            item = self.items[file_id]
            if "name" in changes: item["name"] = changes["name"]
            if "album" in changes: item["appProperties"]["album"] = changes["album"]
            if "favorite" in changes: item["appProperties"]["favorite"] = str(changes["favorite"]).lower()
            return self.get(file_id)

    def delete(self, file_id):
        with self.lock:
            self.get(file_id)
            del self.items[file_id]
            del self.data[file_id]

    def stream(self, file_id, byte_range=None):
        with self.lock:
            self.get(file_id)
            return MemoryStream(self.data[file_id], byte_range)
