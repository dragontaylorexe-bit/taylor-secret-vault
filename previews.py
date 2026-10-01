"""Bounded private preview cache. Originals are always streamed unchanged."""
import hashlib
import io
import threading
import time
from collections import OrderedDict

from PIL import Image, ImageOps, UnidentifiedImageError
from storage import DemoStore, StorageError

SOURCE_LIMIT = 20 * 1024 * 1024
PIXEL_LIMIT = 40_000_000
download_slots = threading.BoundedSemaphore(2)
decode_slot = threading.BoundedSemaphore(1)


def read_limited(upstream, limit):
    data = bytearray()
    try:
        if int(upstream.headers.get("Content-Length", "0")) > limit:
            raise StorageError("Ảnh quá lớn để tạo xem trước. Bấm mở để xem bản gốc.", 413)
        for chunk in upstream.iter_content(64 * 1024):
            data.extend(chunk)
            if len(data) > limit:
                raise StorageError("Ảnh quá lớn để tạo xem trước. Bấm mở để xem bản gốc.", 413)
        return bytes(data)
    finally:
        upstream.close()


def resize_image(data, size):
    try:
        with decode_slot, Image.open(io.BytesIO(data)) as image:
            if image.width * image.height > PIXEL_LIMIT:
                raise StorageError("Ảnh quá lớn để tạo xem trước. Bấm mở để xem bản gốc.", 413)
            # JPEG draft decoding saves RAM. EXIF orientation must match the original.
            image.draft("RGB", (size, size))
            image.thumbnail((size, size), Image.Resampling.LANCZOS)
            frame = ImageOps.exif_transpose(image)
            try:
                rgba = frame.convert("RGBA")
                try:
                    background = Image.new("RGB", rgba.size, (24, 23, 31))
                    try:
                        background.paste(rgba, mask=rgba.getchannel("A"))
                        output = io.BytesIO()
                        background.save(output, "JPEG", quality=85, optimize=True)
                        return output.getvalue(), "image/jpeg"
                    finally:
                        background.close()
                finally:
                    rgba.close()
            finally:
                frame.close()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise StorageError("Chưa tạo được xem trước cho định dạng này. Bấm mở hoặc tải bản gốc.", 415) from None


class PreviewCache:
    def __init__(self, max_bytes=24 * 1024 * 1024, ttl=300):
        self.entries = OrderedDict()
        self.bytes = 0
        self.max_bytes = max_bytes
        self.ttl = ttl
        self.lock = threading.Lock()
        self.stripes = [threading.Lock() for _ in range(16)]

    def clear(self, file_id=None):
        with self.lock:
            for key in list(self.entries):
                if file_id is None or key[0] == file_id:
                    self.bytes -= len(self.entries.pop(key)[1])

    def cached(self, key):
        with self.lock:
            item = self.entries.get(key)
            if item and time.monotonic() - item[0] < self.ttl:
                self.entries.move_to_end(key)
                return item[1:]
            if item:
                self.bytes -= len(self.entries.pop(key)[1])

    def get(self, store, item, size):
        version = item.get("version") or item.get("modifiedTime") or item.get("createdTime") or ""
        key = (item["id"], version, size)
        with self.stripes[hash(key) % len(self.stripes)]:
            cached = self.cached(key)
            if cached:
                return cached
            with download_slots:
                data = None
                if item.get("thumbnailLink") and hasattr(store, "thumbnail"):
                    try:
                        data = read_limited(store.thumbnail(item), 4 * 1024 * 1024)
                        data, mime = resize_image(data, size)
                    except StorageError:
                        data = None
                if data is None:
                    if not item.get("mimeType", "").startswith("image/"):
                        raise StorageError("Chưa có ảnh xem trước.", 404)
                    if int(item.get("size", "0")) > SOURCE_LIMIT:
                        raise StorageError("Ảnh quá lớn để tạo xem trước. Bấm mở để xem bản gốc.", 413)
                    data = read_limited(store.stream(item["id"]), SOURCE_LIMIT)
                    if item.get("mimeType") == "image/svg+xml" and isinstance(store, DemoStore):
                        mime = "image/svg+xml"
                    else:
                        data, mime = resize_image(data, size)
            etag = '"' + hashlib.sha256(data).hexdigest() + '"'
            with self.lock:
                previous = self.entries.pop(key, None)
                if previous:
                    self.bytes -= len(previous[1])
                self.entries[key] = (time.monotonic(), data, mime, etag)
                self.bytes += len(data)
                while self.bytes > self.max_bytes or len(self.entries) > 256:
                    self.bytes -= len(self.entries.popitem(last=False)[1][1])
            return data, mime, etag
