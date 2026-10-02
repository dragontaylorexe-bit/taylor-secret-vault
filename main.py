"""A single-owner private photo vault, served together with its frontend."""
import hashlib
import hmac
import logging
import os
import re
import secrets
import threading
import time
from pathlib import Path
from urllib.parse import quote, urlsplit

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from storage import DemoStore, DriveStore, StorageError
from previews import PreviewCache

BASE = Path(__file__).resolve().parent
app = FastAPI(title="Taylor's Vault", docs_url=None, redoc_url=None, openapi_url=None)
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")
DEMO_MODE = os.getenv("DEMO_MODE", "false").lower() == "true"
MAX_UPLOAD_MB = max(1, min(500, int(os.getenv("MAX_UPLOAD_MB", "100"))))
MAX_BYTES = MAX_UPLOAD_MB * 1024 * 1024
SESSION_SECONDS = 12 * 60 * 60
store = DemoStore(BASE / "static" / "demo") if DEMO_MODE else DriveStore(BASE)
preview_cache = PreviewCache()
sessions = {}
login_attempts = {}
state_lock = threading.Lock()
log = logging.getLogger("vault")
MIMES = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
         "image/heic", "image/heif", "image/bmp", "image/tiff", "video/mp4",
         "video/quicktime", "video/webm", "video/ogg"}


class UploadLimit:
    """Bound multipart bodies as they arrive, including chunked requests."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path") != "/upload/":
            return await self.app(scope, receive, send)
        limit = MAX_BYTES + 1024 * 1024
        headers = dict(scope.get("headers", []))
        try:
            length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            length = 0
        if length > limit:
            response = JSONResponse({"detail": f"Mỗi lượt tải tối đa {MAX_UPLOAD_MB} MB."}, 413)
            return await response(scope, receive, send)
        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            received += len(message.get("body", b""))
            if received > limit:
                raise HTTPException(413, f"Mỗi lượt tải tối đa {MAX_UPLOAD_MB} MB.")
            return message

        await self.app(scope, limited_receive, send)


app.add_middleware(UploadLimit)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; "
        "font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    )
    if request.url.path.startswith("/static/") and response.status_code in (200, 304):
        response.headers["Cache-Control"] = "public, max-age=0, must-revalidate"
    else:
        response.headers.setdefault("Cache-Control", "no-store")
    return response


@app.exception_handler(StorageError)
async def storage_error(request, exc):
    log.warning("Storage request failed: %s", exc.code)
    return JSONResponse({"detail": exc.message}, status_code=exc.status)


@app.api_route("/", methods=["GET", "HEAD"])
def home():
    return FileResponse(BASE / "index.html")


@app.api_route("/healthz", methods=["GET", "HEAD"])
def health():
    # This checks process health. Drive readiness is checked after sign-in.
    return {"status": "ok"}


def configured_password():
    password = os.getenv("SECRET_PASSWORD", "")
    if len(password) < 12:
        raise HTTPException(503, "Chưa cấu hình SECRET_PASSWORD (ít nhất 12 ký tự) trên máy chủ.")
    return password


def same_origin(request):
    origin = request.headers.get("origin")
    if origin:
        parsed = urlsplit(origin)
        if parsed.scheme != request.url.scheme or parsed.netloc != request.url.netloc:
            raise HTTPException(403, "Yêu cầu phải xuất phát từ website này.")


def session(request: Request):
    key = hashlib.sha256(request.cookies.get("vault_session", "").encode()).hexdigest()
    with state_lock:
        entry = sessions.get(key)
        if not entry or entry["expires"] < time.time():
            sessions.pop(key, None)
            raise HTTPException(401, "Phiên đăng nhập đã hết hạn. Hãy mở khóa lại.")
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            same_origin(request)
            if not hmac.compare_digest(request.headers.get("x-csrf-token", ""), entry["csrf"]):
                raise HTTPException(403, "Phiên không hợp lệ. Hãy tải lại trang.")
        return entry


class LoginBody(BaseModel):
    password: str = Field(max_length=1024)


@app.post("/auth/login")
def login(body: LoginBody, request: Request, response: Response):
    same_origin(request)
    expected = configured_password()
    ip = request.client.host if request.client else "unknown"
    now = time.time()
    with state_lock:
        # In-memory limits are intended for the one-worker Render configuration.
        for old_ip in list(login_attempts):
            login_attempts[old_ip] = [t for t in login_attempts[old_ip] if t > now - 900]
            if not login_attempts[old_ip]:
                del login_attempts[old_ip]
        attempts = login_attempts.get(ip, [])
        if len(attempts) >= 8:
            raise HTTPException(429, "Bạn đã thử quá nhiều lần. Vui lòng thử lại sau 15 phút.")
        if not hmac.compare_digest(body.password.encode(), expected.encode()):
            login_attempts.setdefault(ip, []).append(now)
            raise HTTPException(401, "Mật khẩu chưa đúng. Bạn thử lại nhé.")
        login_attempts.pop(ip, None)
        for key in list(sessions):
            if sessions[key]["expires"] < now:
                del sessions[key]
        if len(sessions) >= 100:
            sessions.pop(next(iter(sessions)))
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(32)
        # A separate, non-authenticating namespace for temporary browser originals.
        cache_scope = f"{int(now)}-{secrets.token_hex(12)}"
        sessions[hashlib.sha256(token.encode()).hexdigest()] = {"csrf": csrf, "expires": now + SESSION_SECONDS, "cache_scope": cache_scope}
    secure = os.getenv("COOKIE_SECURE", str(request.url.scheme == "https")).lower() == "true"
    response.set_cookie("vault_session", token, max_age=SESSION_SECONDS, httponly=True,
                        secure=secure, samesite="strict", path="/")
    return {"csrf": csrf, "demo": DEMO_MODE, "max_upload_mb": MAX_UPLOAD_MB, "cache_scope": cache_scope, "session_expires_at": now + SESSION_SECONDS}


@app.get("/auth/session")
def session_status(entry=Depends(session)):
    return {"csrf": entry["csrf"], "demo": DEMO_MODE, "max_upload_mb": MAX_UPLOAD_MB, "cache_scope": entry["cache_scope"], "session_expires_at": entry["expires"]}


@app.post("/auth/logout")
def logout(request: Request, response: Response, entry=Depends(session)):
    with state_lock:
        sessions.pop(hashlib.sha256(request.cookies.get("vault_session", "").encode()).hexdigest(), None)
    response.delete_cookie("vault_session", path="/")
    return {"message": "Đã khóa thư viện."}


@app.get("/files/")
def files(entry=Depends(session)):
    return {"files": [public_file(item) for item in store.list_files()]}


def public_file(item):
    # Keep short-lived credentialed Google URLs on the server.
    return {key: value for key, value in item.items() if key != "thumbnailLink"}


@app.get("/preview/{file_id}")
def preview(file_id: str, request: Request, size: int = Query(default=800, ge=200, le=1200), entry=Depends(session)):
    item = store.get(file_id)
    data, mime, etag = preview_cache.get(store, item, size)
    headers = {"Cache-Control": "private, no-cache", "Vary": "Cookie", "ETag": etag}
    # Auth runs before 304 so a locked vault cannot reuse previews without validation.
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(data, media_type=mime, headers=headers)


def clean_text(value, label, limit):
    value = value.strip()
    if not value or any(ord(c) < 32 for c in value) or len(value.encode("utf-8")) > limit:
        raise HTTPException(422, f"{label} không được trống, chứa ký tự điều khiển hoặc vượt {limit} byte UTF-8.")
    return value


def detect_media(head):
    if head.startswith(b"\xff\xd8\xff"): return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"): return "image/png"
    if head.startswith((b"GIF87a", b"GIF89a")): return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP": return "image/webp"
    if head.startswith(b"BM"): return "image/bmp"
    if head.startswith((b"II*\x00", b"MM\x00*")): return "image/tiff"
    if head.startswith(b"\x1aE\xdf\xa3"): return "video/webm"
    if head.startswith(b"OggS"): return "video/ogg"
    if head[4:8] == b"ftyp":
        brands = head[8:64]
        if b"avif" in brands or b"avis" in brands: return "image/avif"
        if any(b in brands for b in [b"heic", b"heix", b"hevc", b"hevx"]): return "image/heic"
        if b"mif1" in brands: return "image/heif"
        return "video/quicktime" if b"qt  " in brands else "video/mp4"
    return None


@app.post("/upload/")
async def upload(files: list[UploadFile] = File(...), album: str = Form("Chưa phân loại"), entry=Depends(session)):
    try:
        album = clean_text(album, "Tên album", 110)
        if not 1 <= len(files) <= 20:
            raise HTTPException(422, "Mỗi lượt chọn từ 1 đến 20 tệp.")
        total = 0
        prepared = []
        for file in files:
            file.file.seek(0, 2)
            size = file.file.tell()
            file.file.seek(0)
            total += size
            if size == 0 or total > MAX_BYTES:
                raise HTTPException(413, f"Tệp rỗng hoặc tổng dung lượng vượt {MAX_UPLOAD_MB} MB.")
            mime = detect_media(await file.read(64))
            await file.seek(0)
            if mime not in MIMES:
                raise HTTPException(415, "Chỉ nhận ảnh JPEG/PNG/GIF/WebP/AVIF/HEIC/BMP/TIFF và video MP4/MOV/WebM/Ogg.")
            name = clean_text((file.filename or "media").replace("\\", "/").split("/")[-1], "Tên tệp", 240)
            prepared.append((file, name, mime, size))
        uploaded = []
        for file, name, mime, size in prepared:
            try:
                uploaded.append(public_file(await run_in_threadpool(store.upload, file.file, name, mime, size, album)))
            except StorageError as exc:
                # Tell the client precisely which files are already saved.
                return JSONResponse({"detail": exc.message, "files": uploaded, "failed": name}, exc.status)
        return {"message": f"Đã lưu {len(uploaded)} tệp.", "files": uploaded}
    finally:
        for file in files:
            await file.close()


class EditBody(BaseModel):
    name: str | None = Field(default=None, max_length=240)
    album: str | None = Field(default=None, max_length=110)
    favorite: bool | None = None


@app.patch("/files/{file_id}")
def edit_file(file_id: str, body: EditBody, entry=Depends(session)):
    changes = body.model_dump(exclude_none=True)
    if "name" in changes:
        changes["name"] = clean_text(changes["name"], "Tên tệp", 240)
    if "album" in changes:
        changes["album"] = clean_text(changes["album"], "Tên album", 110)
    if not changes:
        raise HTTPException(422, "Chưa có nội dung thay đổi.")
    item = store.update(file_id, changes)
    preview_cache.clear(file_id)
    return {"file": public_file(item)}


@app.delete("/delete/{file_id}")
def delete_file(file_id: str, entry=Depends(session)):
    store.delete(file_id)
    preview_cache.clear(file_id)
    return {"message": "Đã xóa vĩnh viễn tệp."}


@app.get("/stream/{file_id}")
def stream(file_id: str, request: Request, download: bool = False, entry=Depends(session)):
    byte_range = request.headers.get("range")
    if byte_range and not re.fullmatch(r"bytes=(?:\d+-\d*|-\d+)", byte_range):
        raise HTTPException(416, "Chỉ hỗ trợ một khoảng byte mỗi yêu cầu.")
    item = store.get(file_id)
    mime = item.get("mimeType", "application/octet-stream")
    safe = mime in MIMES or (DEMO_MODE and mime == "image/svg+xml")
    disposition = "attachment" if download or not safe else "inline"
    headers = {"Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(item['name'], safe='')}",
               "Accept-Ranges": "bytes"}
    if mime.startswith("image/") and safe and not download and not byte_range:
        version = item.get("version") or item.get("modifiedTime") or item.get("createdTime") or ""
        etag = '"' + hashlib.sha256(f"{file_id}:{version}".encode()).hexdigest() + '"'
        headers.update({"Cache-Control": "private, no-cache", "Vary": "Cookie", "ETag": etag})
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers=headers)
    upstream = store.stream(file_id, byte_range)
    for key in ("Content-Length", "Content-Range"):
        if key in upstream.headers:
            headers[key] = upstream.headers[key]
    if upstream.status_code == 416:
        upstream.close()
        return Response(status_code=416, headers=headers)
    return StreamingResponse(upstream.iter_content(256 * 1024), status_code=upstream.status_code,
                             media_type=mime if safe else "application/octet-stream", headers=headers,
                             background=BackgroundTask(upstream.close))
