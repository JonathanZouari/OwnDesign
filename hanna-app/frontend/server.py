"""Serves the static UI and proxies /api/* to the SAME-environment backend (BACKEND_URL),
so a frontend can never talk to another environment's API and no secret reaches the browser."""
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.environ.get("BACKEND_URL", "http://127.0.0.1:8001").rstrip("/")
TYPES = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml"}


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, data, ctype, extra=()):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in extra:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_any(self):
        if self.path.startswith("/api/"):
            body = self.rfile.read(int(self.headers.get("Content-Length") or 0)) or None
            req = urllib.request.Request(BACKEND + self.path, body, method=self.command)
            for h in ("Authorization", "Content-Type"):
                if self.headers.get(h):
                    req.add_header(h, self.headers[h])
            try:
                r = urllib.request.urlopen(req, timeout=120)
            except urllib.error.HTTPError as e:
                r = e
            except Exception:
                return self.reply(502, b'{"error":"backend unavailable"}', "application/json")
            return self.reply(r.status if hasattr(r, "status") else r.code, r.read(), r.headers.get("Content-Type", "application/json"),
                              [(h, r.headers[h]) for h in ("Content-Security-Policy",) if r.headers.get(h)])
        name = self.path.split("?")[0].lstrip("/")
        f = os.path.normpath(os.path.join(ROOT, name))
        # unknown paths (e.g. /s/<studio-slug>) fall back to the SPA shell
        if not name or not f.startswith(ROOT + os.sep) or not os.path.isfile(f) or f.endswith(".py"):
            f = os.path.join(ROOT, "index.html")
        with open(f, "rb") as fh:
            self.reply(200, fh.read(), TYPES.get(os.path.splitext(f)[1], "application/octet-stream") + "; charset=utf-8")

    do_GET = do_POST = do_PUT = do_any

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    print("frontend on", port, "->", BACKEND, flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
