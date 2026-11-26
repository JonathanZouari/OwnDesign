"""Run: python test_api.py   (spins up the server on a temp SQLite DB; covers the PRD acceptance tests that are backend-side)."""
import json
import os
import tempfile
import threading
import time
import urllib.request
from http.server import ThreadingHTTPServer

os.environ["SQLITE_PATH"] = os.path.join(tempfile.mkdtemp(), "t.db")
import db, server  # noqa: E402

db.init()
srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:%d" % srv.server_port


def call(method, path, body=None, tok=None):
    req = urllib.request.Request(BASE + path, json.dumps(body or {}).encode() if method != "GET" else None, method=method,
                                 headers={"Authorization": "Bearer " + tok} if tok else {})
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read().decode()
            return r.status, json.loads(raw) if r.headers["Content-Type"].startswith("application/json") else raw
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def reg(**kw):
    s, r = call("POST", "/api/register", dict(password="password1", **kw))
    assert s == 200, r
    return r["token"]


PLAN = {"rooms": [{"id": "r1", "name": "Living room", "x": 0, "y": 0, "w": 500, "h": 400}], "walls": [], "openings": [],
        "furniture": [{"id": "f1", "ref": "sofa3", "x": 50, "y": 50, "w": 220, "d": 95, "rot": 0}],
        "materials": {"floor": "oak", "wall": "white", "accent": "terracotta"}}

a = reg(email="a@a.com", studio_name="Studio A")
b = reg(email="b@b.com", studio_name="Studio B")
c = reg(email="c@c.com", studio_slug="studio-a")  # client via public link
pid = call("POST", "/api/projects", {"name": "Flat"}, c)[1]["id"]
v1 = call("POST", f"/api/projects/{pid}/versions", {"data": PLAN}, c)[1]
assert not v1["needs_review"]
# 1 reload keeps geometry
assert call("GET", f"/api/projects/{pid}", tok=c)[1]["version"]["data"]["rooms"][0]["w"] == 500
# 7 tenant isolation, plus designer of the right studio sees the client project
for path in ("", "/budget", "/ai", "/posts", "/renders", "/versions", "/dossier"):
    assert call("GET", f"/api/projects/{pid}{path}", tok=b)[0] == 404, path
assert call("GET", f"/api/projects/{pid}", tok=a)[0] == 200
# 3 AI suggests but never edits
s, r = call("POST", f"/api/projects/{pid}/ai", {"message": "Could we remove the wall?"}, c)
assert "qualified professional" in r["reply"] and r["plan_changed"] is False
assert call("GET", f"/api/projects/{pid}/versions", tok=c)[1][0]["n"] == 1
# 10 wet area / wall change is flagged
p2 = json.loads(json.dumps(PLAN)); p2["walls"].append({"id": "w1", "x1": 0, "y1": 200, "x2": 300, "y2": 200})
assert call("POST", f"/api/projects/{pid}/versions", {"data": p2}, c)[1]["needs_review"]
# 4/5 render records exact version + viewpoint, new render after change references new version
rid = call("POST", f"/api/projects/{pid}/renders", {"viewpoint": "iso_ne", "version_id": v1["id"]}, c)[1]["id"]
time.sleep(0.5)
jobs = call("GET", f"/api/projects/{pid}/renders", tok=c)[1]
assert jobs[0]["status"] == "done" and jobs[0]["version_id"] == v1["id"] and jobs[0]["viewpoint"] == "iso_ne", jobs
for vp in ("plan", "iso_se", "iso_sw", "iso_nw"):
    render = __import__("render").render(p2, vp)
    assert render.startswith("<svg")
# 6 clients cannot assign tasks; designers can
assert call("POST", f"/api/projects/{pid}/tasks", {"title": "x"}, c)[0] == 403
assert call("POST", f"/api/projects/{pid}/tasks", {"title": "Measure windows"}, a)[0] == 200
# another client of the same studio cannot see this project
d = reg(email="d@d.com", studio_slug="studio-a")
assert call("GET", f"/api/projects/{pid}", tok=d)[0] == 404
# 9 budget labelled as estimate
assert "Not supplier quotes" in call("GET", f"/api/projects/{pid}/budget", tok=c)[1]["note"]
# 8 branding differs per studio
call("PUT", "/api/studio", {"color_primary": "#112233", "template": "modern"}, a)
assert "#112233" in call("GET", f"/api/projects/{pid}/dossier", tok=a)[1]
assert call("PUT", "/api/studio", {"color_primary": "red"}, a)[0] == 400
print("all backend tests passed")
