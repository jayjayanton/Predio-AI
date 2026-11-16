"""Local-only PredioAI -> Playwright bridge. Start with: py automation/irm_bridge.py

Only binds loopback, checks exact Origin, validates the predio and allows one
active browser session. CAPTCHA is completed manually in visible Chromium.
"""
import json
import re
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = 8765
ALLOWED_ORIGINS = {
    "https://jayjayanton.github.io",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
}
SCRIPT = Path(__file__).with_name("irm_playwright.py")
_lock = threading.Lock()
_process = None


class Handler(BaseHTTPRequestHandler):
    def _origin_ok(self):
        return self.headers.get("Origin") in ALLOWED_ORIGINS

    def _headers(self, status=200):
        self.send_response(status)
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()

    def _reply(self, status, payload):
        self._headers(status)
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def do_OPTIONS(self):
        if not self._origin_ok() or self.path not in ("/irm/start", "/health"):
            return self._reply(403, {"error": "Origin not allowed"})
        self._headers(204)

    def do_GET(self):
        if self.path != "/health":
            return self._reply(404, {"error": "Not found"})
        if not self._origin_ok():
            return self._reply(403, {"error": "Origin not allowed"})
        with _lock:
            running = _process is not None and _process.poll() is None
        self._reply(200, {"ok": True, "running": running})

    def do_POST(self):
        global _process
        if self.path != "/irm/start":
            return self._reply(404, {"error": "Not found"})
        if not self._origin_ok():
            return self._reply(403, {"error": "Origin not allowed"})
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            return self._reply(415, {"error": "JSON required"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 1024:
                return self._reply(400, {"error": "Invalid request length"})
            payload = json.loads(self.rfile.read(length))
            predio = str(payload.get("predio", "")).strip()
            if not re.fullmatch(r"[0-9]{1,25}", predio):
                return self._reply(400, {"error": "Invalid predio number"})
        except (ValueError, TypeError, json.JSONDecodeError):
            return self._reply(400, {"error": "Invalid JSON"})
        with _lock:
            if _process is not None and _process.poll() is None:
                return self._reply(409, {"error": "An IRM session is already running"})
            try:
                _process = subprocess.Popen(
                    [sys.executable, str(SCRIPT), predio],
                    cwd=str(SCRIPT.parent.parent),
                )
            except OSError:
                return self._reply(500, {"error": "Could not launch Playwright"})
        self._reply(202, {"started": True, "predio": predio})

    def log_message(self, fmt, *args):
        print("IRM bridge:", fmt % args)


if __name__ == "__main__":
    print(f"PredioAI IRM bridge listening on http://{HOST}:{PORT}")
    print("Keep this terminal open. Only the configured PredioAI origins are accepted.")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
