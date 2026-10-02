import io
import json
import os
import re
import sys
import unittest
from PIL import Image
from pathlib import Path
from unittest.mock import Mock, patch

os.environ["DEMO_MODE"] = "true"
os.environ["SECRET_PASSWORD"] = "Only-A-Test-Password-2026"
os.environ["COOKIE_SECURE"] = "false"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
import main
from storage import DemoStore, DriveStore, StorageError

PNG_BUFFER = io.BytesIO()
Image.new("RGB", (1, 1), (120, 90, 180)).save(PNG_BUFFER, "PNG")
PNG = PNG_BUFFER.getvalue()


class VaultTests(unittest.TestCase):
    def setUp(self):
        main.store = DemoStore(main.BASE / "static/demo")
        main.preview_cache.clear()
        main.sessions.clear(); main.login_attempts.clear()
        self.client = TestClient(main.app)
        self.auth()

    def auth(self):
        response = self.client.post("/auth/login", json={"password": os.environ["SECRET_PASSWORD"]})
        self.assertEqual(response.status_code, 200)
        self.csrf = {"X-CSRF-Token": response.json()["csrf"]}

    def test_root_and_health_get_head(self):
        for path in ["/", "/healthz"]:
            self.assertEqual(self.client.get(path).status_code, 200)
            response = self.client.head(path)
            self.assertEqual(response.status_code, 200); self.assertEqual(response.content, b"")

    def test_root_independent_of_cwd(self):
        previous = Path.cwd()
        try:
            os.chdir(previous.parent)
            self.assertEqual(self.client.get("/").status_code, 200)
        finally: os.chdir(previous)

    def test_static_and_security_headers(self):
        for path in ["/static/app.js", "/static/settings.js", "/static/style.css", "/static/tokens.css", "/static/favicon.svg"]:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertIn("frame-ancestors 'none'", response.headers["Content-Security-Policy"])

    def test_frontend_html_contains_all_controls_used_by_script(self):
        html = (main.BASE / "index.html").read_text(encoding="utf-8")
        script = (main.BASE / "static/app.js").read_text(encoding="utf-8")
        html_ids = set(re.findall(r'\bid="([^"]+)"', html))
        control_ids = set(re.findall(r'\$\(\s*"([^"]+)"\s*\)', script))
        self.assertTrue(control_ids)
        self.assertEqual(control_ids - html_ids, set(), "HTML and JavaScript must be deployed together")
        self.assertIn("/static/settings.js?v=", html)
        self.assertIn("/static/app.js?v=", html)

    def test_unauthorized_and_legacy_password(self):
        client = TestClient(main.app)
        for path in ["/files/", "/files/?password=Only-A-Test-Password-2026", "/stream/demo-0", "/auth/session"]:
            self.assertEqual(client.get(path).status_code, 401)

    def test_invalid_password(self):
        self.assertEqual(self.client.post("/auth/login", json={"password": "wrong"}).status_code, 401)

    def test_cookie_properties_and_logout_revokes(self):
        response = self.client.post("/auth/login", json={"password": os.environ["SECRET_PASSWORD"]})
        cookie = response.headers["set-cookie"]
        self.assertIn("HttpOnly", cookie); self.assertIn("SameSite=strict", cookie)
        token = self.client.cookies.get("vault_session")
        headers = {"X-CSRF-Token": response.json()["csrf"]}
        self.assertEqual(self.client.post("/auth/logout", headers=headers).status_code, 200)
        self.client.cookies.set("vault_session", token)
        self.assertEqual(self.client.get("/files/").status_code, 401)

    def test_secure_cookie(self):
        with patch.dict(os.environ, {"COOKIE_SECURE": "true"}):
            response = self.client.post("/auth/login", json={"password": os.environ["SECRET_PASSWORD"]})
            self.assertIn("Secure", response.headers["set-cookie"])

    def test_csrf(self):
        self.assertEqual(self.client.delete("/delete/demo-0").status_code, 403)
        self.assertEqual(self.client.patch("/files/demo-0", headers={"X-CSRF-Token": "wrong"}, json={"favorite": True}).status_code, 403)
        self.assertEqual(len(self.client.get("/files/").json()["files"]), 6)

    def test_cross_origin_login_and_mutation(self):
        self.assertEqual(self.client.post("/auth/login", headers={"Origin": "https://other.example"}, json={"password": os.environ["SECRET_PASSWORD"]}).status_code, 403)
        self.assertEqual(self.client.delete("/delete/demo-0", headers={**self.csrf, "Origin": "https://other.example"}).status_code, 403)

    def test_session_expiry(self):
        for entry in main.sessions.values(): entry["expires"] = 0
        self.assertEqual(self.client.get("/auth/session").status_code, 401)

    def test_login_rate_limit(self):
        for _ in range(8):
            self.assertEqual(self.client.post("/auth/login", json={"password": "wrong"}).status_code, 401)
        self.assertEqual(self.client.post("/auth/login", json={"password": "wrong"}).status_code, 429)

    def test_missing_password_fails_closed(self):
        with patch.dict(os.environ, {"SECRET_PASSWORD": ""}):
            self.assertEqual(self.client.post("/auth/login", json={"password": ""}).status_code, 503)

    def test_list_edit_favorite_preserves_album(self):
        response = self.client.patch("/files/demo-0", headers=self.csrf, json={"favorite": False})
        self.assertEqual(response.status_code, 200)
        item = response.json()["file"]
        self.assertEqual(item["appProperties"]["favorite"], "false")
        self.assertEqual(item["appProperties"]["album"], "Những chuyến đi")
        response = self.client.patch("/files/demo-0", headers=self.csrf, json={"name": "Kỷ niệm <x>.svg", "album": "Đà Lạt"})
        self.assertEqual(response.json()["file"]["appProperties"]["album"], "Đà Lạt")

    def test_empty_edit_and_long_unicode_album(self):
        self.assertEqual(self.client.patch("/files/demo-0", headers=self.csrf, json={}).status_code, 422)
        self.assertEqual(self.client.patch("/files/demo-0", headers=self.csrf, json={"album": "ấ" * 40}).status_code, 422)
        self.assertEqual(self.client.patch("/files/demo-0", headers=self.csrf, json={"name": "a\nb"}).status_code, 422)

    def test_upload_detects_mime_and_path(self):
        response = self.client.post("/upload/", headers=self.csrf, data={"album": "Đà Lạt"}, files=[("files", ("folder/photo.png", PNG, "application/octet-stream"))])
        self.assertEqual(response.status_code, 200)
        item = response.json()["files"][0]
        self.assertEqual(item["name"], "photo.png"); self.assertEqual(item["mimeType"], "image/png")
        self.assertEqual(self.client.get(f"/stream/{item['id']}").content, PNG)

    def test_reject_html_svg_empty(self):
        for data, expected in [(b"<script>alert(1)</script>", 415), (b"<svg xmlns='x'/>", 415), (b"", 413)]:
            response = self.client.post("/upload/", headers=self.csrf, files={"files": ("fake.png", data, "image/png")})
            self.assertEqual(response.status_code, expected)

    def test_request_size_limit(self):
        response = self.client.post("/upload/", headers={**self.csrf, "Content-Length": str(main.MAX_BYTES + 2 * 1024 ** 2)}, content=b"x")
        self.assertEqual(response.status_code, 413)

    def test_upload_limit_actual_body_and_file(self):
        with patch.object(main, "MAX_BYTES", 20):
            response = self.client.post("/upload/", headers=self.csrf, files={"files": ("photo.png", PNG, "image/png")})
            self.assertEqual(response.status_code, 413)
        # No Content-Length: incoming bytes are bounded too.
        with patch.object(main, "MAX_BYTES", 20):
            response = self.client.post("/upload/", headers={**self.csrf, "Content-Type": "multipart/form-data; boundary=X"}, content=iter([b"x" * (1024 ** 2 + 21)]))
            self.assertEqual(response.status_code, 413)

    def test_upload_partial_failure_returns_saved_ids(self):
        saved = {"id": "saved", "name": "a.png"}
        with patch.object(main.store, "upload", side_effect=[saved, StorageError("Drive unavailable")]):
            response = self.client.post("/upload/", headers=self.csrf, files=[("files", ("a.png", PNG, "image/png")), ("files", ("b.png", PNG, "image/png"))])
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()["files"], [saved])

    def test_stream_ranges_and_unicode_download(self):
        full = self.client.get("/stream/demo-0").content
        response = self.client.get("/stream/demo-0", headers={"Range": "bytes=2-8"})
        self.assertEqual(response.status_code, 206); self.assertEqual(response.content, full[2:9])
        self.assertEqual(response.headers["Content-Range"], f"bytes 2-8/{len(full)}")
        self.assertEqual(self.client.get("/stream/demo-0", headers={"Range": "bytes=-5"}).content, full[-5:])
        response = self.client.get("/stream/demo-0", headers={"Range": "bytes=999999-"})
        self.assertEqual(response.status_code, 416); self.assertIn("bytes */", response.headers["Content-Range"])
        self.assertEqual(self.client.get("/stream/demo-0", headers={"Range": "bytes=0-1,4-5"}).status_code, 416)
        self.client.patch("/files/demo-0", headers=self.csrf, json={"name": "Ảnh.png"})
        self.assertIn("attachment; filename*=UTF-8''", self.client.get("/stream/demo-0?download=true").headers["Content-Disposition"])

    def test_delete_and_not_found(self):
        self.assertEqual(self.client.delete("/delete/demo-0", headers=self.csrf).status_code, 200)
        self.assertEqual(self.client.get("/stream/demo-0").status_code, 404)
        self.assertEqual(len(self.client.get("/files/").json()["files"]), 5)

    def test_drive_configuration_error_is_readable(self):
        with patch.object(main.store, "list_files", side_effect=StorageError("Missing Drive token")):
            response = self.client.get("/files/")
            self.assertEqual(response.status_code, 503); self.assertEqual(response.json()["detail"], "Missing Drive token")
        self.assertEqual(self.client.get("/healthz").status_code, 200)

    def test_list_passes_available_camera_metadata_without_inventing_it(self):
        metadata = {"width": 6000, "height": 4000, "isoSpeed": 200, "exposureTime": 0.008}
        files = [{"id": "photo", "imageMediaMetadata": metadata}, {"id": "no-exif"}]
        with patch.object(main.store, "list_files", return_value=files):
            response = self.client.get("/files/")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["files"], files)

    def test_preview_resizes_and_original_is_unchanged(self):
        source = io.BytesIO()
        Image.new("RGB", (1600, 1000), (121, 92, 180)).save(source, "PNG")
        payload = source.getvalue()
        response = self.client.post("/upload/", headers=self.csrf, files={"files": ("large.png", payload, "image/png")})
        file_id = response.json()["files"][0]["id"]
        preview = self.client.get(f"/preview/{file_id}?size=800")
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.headers["content-type"], "image/jpeg")
        with Image.open(io.BytesIO(preview.content)) as image:
            self.assertEqual(image.size, (800, 500))
        self.assertEqual(self.client.get(f"/stream/{file_id}").content, payload)
        with patch.object(main.store, "stream", side_effect=AssertionError("must use cache")):
            self.assertEqual(self.client.get(f"/preview/{file_id}?size=800").content, preview.content)
            self.assertEqual(self.client.get(f"/preview/{file_id}?size=800", headers={"If-None-Match": preview.headers["etag"]}).status_code, 304)

    def test_image_cache_revalidates_auth_and_deleted_files(self):
        image = self.client.get("/stream/demo-0")
        preview = self.client.get("/preview/demo-0")
        self.assertEqual(image.headers["cache-control"], "private, no-cache")
        for route, cached in [("stream", image), ("preview", preview)]:
            headers = {"If-None-Match": cached.headers["etag"]}
            self.assertEqual(self.client.get(f"/{route}/demo-0", headers=headers).status_code, 304)
            self.assertEqual(TestClient(main.app).get(f"/{route}/demo-0", headers=headers).status_code, 401)
        self.client.delete("/delete/demo-0", headers=self.csrf)
        self.assertEqual(self.client.get("/preview/demo-0", headers={"If-None-Match": preview.headers["etag"]}).status_code, 404)

    def test_preview_rejects_oversized_or_invalid_source_and_closes_it(self):
        from previews import read_limited, resize_image
        upstream = Mock(headers={"Content-Length": "101"})
        with self.assertRaises(StorageError): read_limited(upstream, 100)
        upstream.close.assert_called_once()
        with self.assertRaises(StorageError): resize_image(b"not an image", 800)
        self.assertEqual(self.client.get("/preview/demo-0?size=5000").status_code, 422)

    def test_preview_prefers_drive_thumbnail_without_original_download(self):
        from storage import MemoryStream
        item = {"id": "camera-photo", "mimeType": "image/jpeg", "size": "10000000", "version": "1", "thumbnailLink": "https://lh3.googleusercontent.com/test"}
        with patch.object(main.store, "get", return_value=item), patch.object(main.store, "thumbnail", return_value=MemoryStream(PNG, None), create=True), patch.object(main.store, "stream", side_effect=AssertionError("original must not be downloaded")):
            self.assertEqual(self.client.get("/preview/camera-photo").status_code, 200)
        with patch.object(main.store, "list_files", return_value=[item]):
            self.assertNotIn("thumbnailLink", self.client.get("/files/").json()["files"][0])


class DriveAdapterTests(unittest.TestCase):
    def setUp(self): self.store = DriveStore(Path("."))

    def test_pagination(self):
        with patch.object(self.store, "json_request", side_effect=[{"files": [{"id": "a"}], "nextPageToken": "next"}, {"files": [{"id": "b"}]}]) as call:
            self.assertEqual([f["id"] for f in self.store.list_files()], ["a", "b"])
            self.assertEqual(call.call_args.kwargs["params"]["pageToken"], "next")

    def test_metadata_requested_and_preserved(self):
        item = {"id": "photo", "spaces": ["appDataFolder"],
                "imageMediaMetadata": {"cameraModel": "Test camera", "aperture": 2.8},
                "videoMediaMetadata": {"durationMillis": "2000"}}
        with patch.object(self.store, "json_request", return_value={"files": [item]}) as call:
            self.assertEqual(self.store.list_files(), [item])
            fields = call.call_args.kwargs["params"]["fields"]
            self.assertIn("imageMediaMetadata(", fields)
            self.assertIn("videoMediaMetadata(", fields)
            self.assertNotIn("location", fields)
        with patch.object(self.store, "json_request", return_value=item) as call:
            self.assertEqual(self.store.get("photo")["imageMediaMetadata"], item["imageMediaMetadata"])
            call.assert_not_called()  # scoped list metadata avoids one request per image
            self.store.metadata.clear()
            self.store.get("photo")
            self.assertIn("imageMediaMetadata(", call.call_args.kwargs["params"]["fields"])

    def test_repeated_page_token_rejected(self):
        with patch.object(self.store, "json_request", return_value={"files": [], "nextPageToken": "same"}):
            with self.assertRaises(StorageError): self.store.list_files()

    def test_ownership_checks(self):
        for item in [{"spaces": ["drive"]}, {"spaces": ["appDataFolder"], "trashed": True}]:
            with patch.object(self.store, "json_request", return_value=item):
                with self.assertRaises(StorageError): self.store.get("other-drive-file")
        with self.assertRaises(StorageError): self.store.get("../something")

    def test_update_preserves_other_properties(self):
        with patch.object(self.store, "get", return_value={"appProperties": {"album": "Old", "custom": "keep"}}), patch.object(self.store, "json_request", return_value={}) as call:
            self.store.update("file-id", {"favorite": True, "name": "New"})
            body = call.call_args.kwargs["json"]
            self.assertEqual(body["name"], "New")
            self.assertEqual(body["appProperties"], {"album": "Old", "custom": "keep", "favorite": "true"})

    def test_resumable_upload_streams_file_object(self):
        response = Mock(); response.headers = {"Location": "https://www.googleapis.com/upload/session"}
        response.__enter__ = Mock(return_value=response); response.__exit__ = Mock(return_value=False)
        file = io.BytesIO(PNG)
        with patch.object(self.store, "request", return_value=response) as init, patch.object(self.store, "json_request", return_value={"id": "new"}) as upload:
            self.assertEqual(self.store.upload(file, "p.png", "image/png", len(PNG), "Album"), {"id": "new"})
            self.assertEqual(init.call_args.kwargs["json"]["parents"], ["appDataFolder"])
            self.assertIs(upload.call_args.kwargs["data"], file)

    def test_upload_rejects_untrusted_session_url(self):
        response = Mock(); response.headers = {"Location": "https://evil.example/upload"}
        response.__enter__ = Mock(return_value=response); response.__exit__ = Mock(return_value=False)
        with patch.object(self.store, "request", return_value=response):
            with self.assertRaises(StorageError): self.store.upload(io.BytesIO(PNG), "p.png", "image/png", len(PNG), "Album")

    def test_upstream_error_is_sanitized(self):
        response = Mock(status_code=403)
        with patch.object(self.store, "token", return_value="test-token"), patch("storage.requests.request", return_value=response):
            with self.assertRaises(StorageError) as caught: self.store.request("GET", "https://www.googleapis.com/drive/v3/files")
            self.assertNotIn("test-token", str(caught.exception)); response.close.assert_called_once()

    def test_stream_forwards_range(self):
        with patch.object(self.store, "request", return_value=Mock()) as call:
            self.store.stream("file-id", "bytes=20-30")
            self.assertEqual(call.call_args.kwargs["headers"], {"Range": "bytes=20-30"})
            self.assertTrue(call.call_args.kwargs["stream"])

    def test_thumbnail_rejects_other_hosts_and_disables_redirects(self):
        for url in ["https://evil.example/image", "http://lh3.googleusercontent.com/image", "https://lh3.googleusercontent.com.evil.example/image"]:
            with self.assertRaises(StorageError): self.store.thumbnail({"thumbnailLink": url})
        with patch.object(self.store, "request", return_value=Mock()) as call:
            self.store.thumbnail({"thumbnailLink": "https://lh3.googleusercontent.com/test"})
            self.assertFalse(call.call_args.kwargs["allow_redirects"])


if __name__ == "__main__": unittest.main()
