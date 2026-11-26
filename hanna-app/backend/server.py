"""Backend API (Python stdlib, no framework approved in the PRD)."""
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import ai
import catalog
import db
import render

STAFF = ("owner", "designer")
CREDIT = {"chat": 1, "render": 5}
TRIAL_CREDITS = 100
WET = {f["id"] for f in catalog.FURNITURE if f["wet"]}
DECISIONS = ("approved", "changes_requested", "professional_review_required")


class HttpError(Exception):
    def __init__(self, code, msg):
        self.code, self.msg = code, msg


def need(cond, code=400, msg="bad request"):
    if not cond:
        raise HttpError(code, msg)


# ---------- auth ----------
def hash_pw(pw, salt=None):
    salt = salt or secrets.token_hex(8)
    return salt + "$" + hashlib.scrypt(pw.encode(), salt=salt.encode(), n=2 ** 14, r=8, p=1).hex()


def check_pw(pw, stored):
    return hmac.compare_digest(hash_pw(pw, stored.split("$")[0]), stored)


def audit(studio_id, project_id, user, action, detail=""):
    db.q("INSERT INTO audit_events VALUES(?,?,?,?,?,?,?)", db.new_id(), studio_id, project_id,
         user["id"] if user else None, action, str(detail)[:500], db.now())


def membership(user, studio_id):
    m = db.one("SELECT role FROM memberships WHERE studio_id=? AND user_id=?", studio_id, user["id"])
    return m["role"] if m else None


def project_for(user, pid):
    """Tenant + project-level authorization: the single gate for every project route."""
    p = db.one("SELECT * FROM projects WHERE id=?", pid)
    if p:
        if membership(user, p["studio_id"]) in STAFF or db.one(
                "SELECT 1 AS x FROM project_access WHERE project_id=? AND user_id=?", pid, user["id"]):
            return p
    raise HttpError(404, "project not found")  # 404 also for foreign tenants: no existence leak


def is_staff(user, p):
    return membership(user, p["studio_id"]) in STAFF


def spend(studio_id, what):
    s = db.one("SELECT * FROM studios WHERE id=?", studio_id)
    bal = db.one("SELECT COALESCE(SUM(delta),0) AS b FROM credit_ledger WHERE studio_id=?", studio_id)["b"]
    need(bal >= CREDIT[what], 402, "Not enough AI credits for this studio")
    need(s["trial_ends"] is None or s["trial_ends"] > db.now() or s["plan"] != "trial", 402, "Studio trial has ended")
    db.q("INSERT INTO credit_ledger VALUES(?,?,?,?,?)", db.new_id(), studio_id, -CREDIT[what], what, db.now())


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40] or "studio"


# ---------- plan helpers ----------
def latest(pid):
    return db.one("SELECT * FROM plan_versions WHERE project_id=? ORDER BY n DESC LIMIT 1", pid)


def review_flags(old, new):
    """FR-26: flag wall / opening / wet-area changes for professional review."""
    reasons = []
    if old is None:
        return reasons
    geo = lambda p: sorted(json.dumps(x, sort_keys=True) for x in (
        [{k: r[k] for k in ("x", "y", "w", "h")} for r in p.get("rooms", [])] + p.get("walls", [])))
    if geo(old) != geo(new):
        reasons.append("Walls / room layout changed")
    op = lambda p: sorted(json.dumps(x, sort_keys=True) for x in p.get("openings", []))
    if op(old) != op(new):
        reasons.append("Doors / windows changed")
    wet = lambda p: sorted(json.dumps({k: f.get(k) for k in ("ref", "x", "y", "rot")}, sort_keys=True)
                           for f in p.get("furniture", []) if f.get("ref") in WET)
    if wet(old) != wet(new):
        reasons.append("Kitchen / bathroom (wet area) fixtures changed")
    return reasons


def clean_plan(d):
    need(isinstance(d, dict), 400, "plan must be an object")
    num = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and abs(v) < 1e6
    for r in d.get("rooms", []):
        need(num(r.get("x")) and num(r.get("y")) and num(r.get("w")) and num(r.get("h")) and r["w"] > 0 and r["h"] > 0
             and isinstance(r.get("id"), str), 400, "invalid room")
        r["name"] = str(r.get("name", "Room"))[:60]
    for f in d.get("furniture", []):
        need(f.get("ref") in catalog.FURN and all(num(f.get(k)) for k in ("x", "y", "w", "d")), 400, "invalid furniture")
    for w in d.get("walls", []):
        need(all(num(w.get(k)) for k in ("x1", "y1", "x2", "y2")), 400, "invalid wall")
    for o in d.get("openings", []):
        need(num(o.get("x")) and num(o.get("y")), 400, "invalid opening")
    return {k: d.get(k, [] if k != "materials" else {}) for k in ("rooms", "walls", "openings", "furniture", "materials")}


def save_version(p, user, data, note):
    data = clean_plan(data)
    prev = latest(p["id"])
    flags = review_flags(json.loads(prev["data"]) if prev else None, data)
    vid = db.new_id()
    db.q("INSERT INTO plan_versions VALUES(?,?,?,?,?,?,?,?,?)", vid, p["id"], (prev["n"] + 1) if prev else 1,
         json.dumps(data), str(note or "")[:200], user["id"], int(bool(flags)), json.dumps(flags), db.now())
    audit(p["studio_id"], p["id"], user, "plan_version", "v%d %s" % ((prev["n"] + 1) if prev else 1, flags))
    return db.one("SELECT * FROM plan_versions WHERE id=?", vid)


def ver_out(v, with_data=True):
    o = {k: v[k] for k in ("id", "n", "note", "author_id", "created")}
    o["needs_review"], o["review_reasons"] = bool(v["needs_review"]), json.loads(v["review_reasons"] or "[]")
    if with_data:
        o["data"] = json.loads(v["data"])
    return o


def budget_for(pid):
    v = latest(pid)
    return catalog.budget(json.loads(v["data"]) if v else {})


def studio_out(s):
    return {k: s[k] for k in ("slug", "name", "logo_url", "color_primary", "color_accent", "font", "template")}


# ---------- dossier ----------
def dossier(p, studio):
    v = latest(p["id"])
    plan = json.loads(v["data"]) if v else {}
    brief = json.loads(p["brief"] or "{}")
    b = catalog.budget(plan)
    e = escape
    svgs = ""
    if plan.get("rooms"):
        svgs = "<div class=g>%s%s</div>" % (render.render(plan, "plan"), render.render(plan, "iso_se"))
    rows = "".join("<tr><td>%s</td><td>%s %s</td><td>€%s</td><td>€%s</td></tr>" % (
        e(l["item"]), l["qty"], l["unit"], l["unit_price"], l["total"]) for l in b["lines"])
    brief_rows = "".join("<tr><th>%s</th><td>%s</td></tr>" % (e(str(k)), e(str(x))) for k, x in brief.items() if x)
    decisions = "".join("<li>%s — %s <small>%s</small></li>" % (e(d["decision"]), e(d["note"] or ""), e(d["created"])) for d in
                        db.q("SELECT * FROM review_decisions WHERE project_id=? ORDER BY created", p["id"]))
    flags = json.loads(v["review_reasons"] or "[]") if v else []
    caveat = ("<p class=warn><b>Professional review required:</b> %s. This is a conceptual plan, not a construction document.</p>"
              % e("; ".join(flags))) if flags else "<p class=warn>Conceptual plan, not a construction document.</p>"
    tpl = studio["template"] or "classic"
    return """<!doctype html><meta charset=utf-8><title>%(t)s</title><style>
body{font-family:%(font)s,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#222}
h1,h2{color:%(c1)s}header{border-bottom:4px solid %(c2)s;display:flex;gap:1rem;align-items:center;padding-bottom:1rem}
.g{display:grid;grid-template-columns:1fr 1fr;gap:1rem}svg{width:100%%;height:auto;border:1px solid #ddd}
table{border-collapse:collapse;width:100%%}td,th{border-bottom:1px solid #ddd;padding:.3rem;text-align:left}
.warn{background:#fff4d6;padding:.6rem;border-left:4px solid %(c2)s}.t-modern h1{text-transform:uppercase;letter-spacing:.1em}
</style><body class="t-%(tpl)s"><header>%(logo)s<div><h1>%(t)s</h1><div>%(s)s · version %(n)s</div></div></header>
%(caveat)s<h2>Brief</h2><table>%(brief)s</table><h2>Plan &amp; renders</h2>%(svgs)s
<small>Renders are illustrative and not dimensionally accurate.</small>
<h2>Budget estimate &amp; product list</h2><table><tr><th>Item<th>Qty<th>Unit<th>Total</tr>%(rows)s
<tr><th colspan=3>Total (estimate)<th>€%(total)s</tr></table><small>%(note)s</small>
<h2>Review history</h2><ul>%(dec)s</ul></body>""" % dict(
        t=e(p["name"]), font=e(studio["font"] or "Georgia"), c1=e(studio["color_primary"] or "#333"),
        c2=e(studio["color_accent"] or "#b08d57"), tpl=e(tpl), s=e(studio["name"]), n=v["n"] if v else 0,
        logo='<img src="%s" height=48>' % e(studio["logo_url"]) if studio["logo_url"] else "", caveat=caveat,
        brief=brief_rows, svgs=svgs, rows=rows, total=b["total"], note=e(b["note"]), dec=decisions or "<li>None yet</li>")


# ---------- routes ----------
def routes():
    R = []

    def route(method, pattern, public=False):
        def deco(fn):
            R.append((method, re.compile("^" + pattern + "$"), fn, public))
            return fn
        return deco
    return R, route


R, route = routes()


@route("GET", "/api/health", True)
def health(u, body, q):
    db.one("SELECT 1 AS ok")
    return {"ok": True}


@route("GET", "/api/catalog", True)
def get_catalog(u, body, q):
    return {"furniture": catalog.FURNITURE, "materials": catalog.MATERIALS, "styles": catalog.STYLES,
            "note": catalog.ESTIMATE_NOTE}


@route("GET", "/api/studios/([a-z0-9-]+)", True)
def public_studio(u, body, q, slug):
    s = db.one("SELECT * FROM studios WHERE slug=?", slug)
    need(s, 404, "studio not found")
    return studio_out(s)


@route("POST", "/api/register", True)
def register(u, b, q):
    email, pw = str(b.get("email", "")).strip().lower(), str(b.get("password", ""))
    need(re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email) and len(pw) >= 8, 400, "valid email and 8+ char password required")
    need(not db.one("SELECT 1 AS x FROM users WHERE email=?", email), 409, "email already registered")
    inv = None
    if b.get("invite"):
        inv = db.one("SELECT * FROM invitations WHERE token=? AND used=0", b["invite"])
        need(inv, 400, "invalid or used invitation")
    studio = None
    if b.get("studio_name"):
        name, slug = str(b["studio_name"])[:60], slugify(b["studio_name"])
        while db.one("SELECT 1 AS x FROM studios WHERE slug=?", slug):
            slug += secrets.token_hex(1)
        sid = db.new_id()
        db.q("INSERT INTO studios VALUES(?,?,?,?,?,?,?,?,?,?,?)", sid, slug, name, "", "#2f3e46", "#b08d57", "Georgia",
             "classic", "trial", db.now(14), db.now())
        db.q("INSERT INTO credit_ledger VALUES(?,?,?,?,?)", db.new_id(), sid, TRIAL_CREDITS, "trial", db.now())
        role = "owner"
    else:
        studio = db.one("SELECT * FROM studios WHERE id=?", inv["studio_id"]) if inv else db.one(
            "SELECT * FROM studios WHERE slug=?", str(b.get("studio_slug", "")))
        need(studio, 400, "studio link or invitation required")
        sid, role = studio["id"], (inv["role"] if inv else "client")
    uid = db.new_id()
    db.q("INSERT INTO users VALUES(?,?,?,?,?)", uid, email, str(b.get("name", ""))[:80], hash_pw(pw), db.now())
    db.q("INSERT INTO memberships VALUES(?,?,?)", sid, uid, role)
    if inv:
        db.q("UPDATE invitations SET used=1 WHERE token=?", inv["token"])
        if inv["project_id"]:
            db.q("INSERT INTO project_access VALUES(?,?,?)", inv["project_id"], uid, "client")
    user = {"id": uid}
    audit(sid, None, user, "register", role)
    return login_user(uid)


def login_user(uid):
    tok = secrets.token_urlsafe(32)
    db.q("INSERT INTO sessions VALUES(?,?,?)", tok, uid, db.now())
    return {"token": tok}


@route("POST", "/api/login", True)
def login(u, b, q):
    row = db.one("SELECT * FROM users WHERE email=?", str(b.get("email", "")).strip().lower())
    need(row and check_pw(str(b.get("password", "")), row["pw"]), 401, "wrong email or password")
    return login_user(row["id"])


@route("GET", "/api/me")
def me(u, b, q):
    ms = db.q("SELECT s.*, m.role FROM memberships m JOIN studios s ON s.id=m.studio_id WHERE m.user_id=?", u["id"])
    out = []
    for s in ms:
        bal = db.one("SELECT COALESCE(SUM(delta),0) AS b FROM credit_ledger WHERE studio_id=?", s["id"])["b"]
        out.append(dict(studio_out(s), role=s["role"], plan=s["plan"], trial_ends=s["trial_ends"], credits=bal))
    return {"id": u["id"], "email": u["email"], "name": u["name"], "studios": out}


@route("PUT", "/api/studio")
def update_studio(u, b, q):
    s = db.one("SELECT s.* FROM memberships m JOIN studios s ON s.id=m.studio_id WHERE m.user_id=? AND m.role='owner'", u["id"])
    need(s, 403, "only a studio owner can change branding")
    col = lambda k: str(b.get(k, s[k]))[:200]
    for k in ("color_primary", "color_accent"):
        need(re.match(r"^#[0-9a-fA-F]{6}$", col(k)), 400, "colors must be #rrggbb")
    need(col("template") in ("classic", "modern"), 400, "unknown template")
    need(re.match(r"^[\w ,'-]*$", col("font")), 400, "invalid font")
    need(not col("logo_url") or col("logo_url").startswith(("https://", "http://", "data:image/")), 400, "invalid logo url")
    db.q("UPDATE studios SET name=?,logo_url=?,color_primary=?,color_accent=?,font=?,template=? WHERE id=?",
         col("name"), col("logo_url"), col("color_primary"), col("color_accent"), col("font"), col("template"), s["id"])
    audit(s["id"], None, u, "branding_update")
    return {"ok": True}


@route("POST", "/api/invites")
def invite(u, b, q):
    s = db.one("SELECT studio_id FROM memberships WHERE user_id=? AND role IN ('owner','designer')", u["id"])
    need(s, 403, "staff only")
    role = b.get("role", "client")
    need(role in ("client", "designer"), 400, "bad role")
    need(role == "client" or membership(u, s["studio_id"]) == "owner", 403, "only owners invite designers")
    pid = b.get("project_id")
    if pid:
        need(project_for(u, pid)["studio_id"] == s["studio_id"], 403, "wrong studio")
    tok = secrets.token_urlsafe(16)
    db.q("INSERT INTO invitations VALUES(?,?,?,?,?,?,?)", tok, s["studio_id"], str(b.get("email", ""))[:120], role, pid, 0, db.now())
    audit(s["studio_id"], pid, u, "invite", role)
    return {"token": tok}


@route("GET", "/api/projects")
def list_projects(u, b, q):
    return db.q("""SELECT DISTINCT p.id,p.name,p.kind,p.status,p.studio_id,p.created FROM projects p
        WHERE p.id IN (SELECT project_id FROM project_access WHERE user_id=?)
        OR p.studio_id IN (SELECT studio_id FROM memberships WHERE user_id=? AND role IN ('owner','designer'))
        ORDER BY p.created DESC""", u["id"], u["id"])


@route("POST", "/api/projects")
def create_project(u, b, q):
    ms = db.q("SELECT * FROM memberships WHERE user_id=?", u["id"])
    sid = b.get("studio_id") or (ms[0]["studio_id"] if ms else None)
    need(any(m["studio_id"] == sid for m in ms), 403, "not a member of this studio")
    kind = b.get("kind", "renovation")
    need(kind in ("renovation", "new_build"), 400, "bad kind")
    pid = db.new_id()
    db.q("INSERT INTO projects VALUES(?,?,?,?,?,?,?)", pid, sid, str(b.get("name") or "My home")[:80], kind, "{}", "draft", db.now())
    db.q("INSERT INTO project_access VALUES(?,?,?)", pid, u["id"], "owner")
    p = db.one("SELECT * FROM projects WHERE id=?", pid)
    if b.get("plan"):
        save_version(p, u, b["plan"], "Imported from guest trial")
    audit(sid, pid, u, "project_create")
    return {"id": pid}


@route("GET", "/api/projects/(\\w+)")
def get_project(u, b, q, pid):
    p = project_for(u, pid)
    v = latest(pid)
    return dict(id=p["id"], name=p["name"], kind=p["kind"], status=p["status"], brief=json.loads(p["brief"] or "{}"),
                staff=is_staff(u, p), version=ver_out(v) if v else None)


@route("PUT", "/api/projects/(\\w+)/brief")
def put_brief(u, b, q, pid):
    p = project_for(u, pid)
    need(isinstance(b, dict) and len(json.dumps(b)) < 20000, 400, "bad brief")
    db.q("UPDATE projects SET brief=? WHERE id=?", json.dumps(b), pid)
    audit(p["studio_id"], pid, u, "brief_update")
    return {"ok": True}


@route("POST", "/api/projects/(\\w+)/submit")
def submit(u, b, q, pid):
    p = project_for(u, pid)
    db.q("UPDATE projects SET status='submitted' WHERE id=?", pid)
    audit(p["studio_id"], pid, u, "submit")
    return {"ok": True}


@route("GET", "/api/projects/(\\w+)/versions")
def versions(u, b, q, pid):
    project_for(u, pid)
    return [ver_out(v, False) for v in db.q("SELECT * FROM plan_versions WHERE project_id=? ORDER BY n DESC", pid)]


@route("GET", "/api/projects/(\\w+)/versions/(\\w+)")
def one_version(u, b, q, pid, vid):
    project_for(u, pid)
    v = db.one("SELECT * FROM plan_versions WHERE id=? AND project_id=?", vid, pid)
    need(v, 404, "version not found")
    return ver_out(v)


@route("POST", "/api/projects/(\\w+)/versions")
def post_version(u, b, q, pid):
    p = project_for(u, pid)
    return ver_out(save_version(p, u, b.get("data"), b.get("note")), False)


@route("GET", "/api/projects/(\\w+)/budget")
def get_budget(u, b, q, pid):
    project_for(u, pid)
    return budget_for(pid)


@route("GET", "/api/projects/(\\w+)/dossier")
def get_dossier(u, b, q, pid):
    p = project_for(u, pid)
    return ("html", dossier(p, db.one("SELECT * FROM studios WHERE id=?", p["studio_id"])))


@route("POST", "/api/projects/(\\w+)/ai")
def chat(u, b, q, pid):
    p = project_for(u, pid)
    msg = str(b.get("message", "")).strip()[:2000]
    need(msg, 400, "empty message")
    spend(p["studio_id"], "chat")
    v = latest(pid)
    plan = json.loads(v["data"]) if v else {}
    hist = [{"role": m["role"], "content": m["content"]} for m in
            db.q("SELECT role,content FROM ai_messages WHERE project_id=? ORDER BY created DESC LIMIT 10", pid)][::-1]
    reply = ai.answer(msg, hist, ai.context(p, plan, json.loads(p["brief"] or "{}"), catalog.budget(plan)), plan)
    for role, text in (("user", msg), ("assistant", reply)):
        db.q("INSERT INTO ai_messages VALUES(?,?,?,?,?)", db.new_id(), pid, role, text, db.now())
    return {"reply": reply, "plan_changed": False}


@route("GET", "/api/projects/(\\w+)/ai")
def chat_history(u, b, q, pid):
    project_for(u, pid)
    return db.q("SELECT role,content,created FROM ai_messages WHERE project_id=? ORDER BY created", pid)


def run_render(jid, plan, viewpoint, room_id):
    try:
        svg = render.render(plan, viewpoint, room_id)
        db.q("UPDATE render_jobs SET status='done', image=? WHERE id=?", svg, jid)
    except Exception as ex:
        db.q("UPDATE render_jobs SET status='failed', error=? WHERE id=?", str(ex)[:300], jid)


@route("POST", "/api/projects/(\\w+)/renders")
def create_render(u, b, q, pid):
    p = project_for(u, pid)
    vp = b.get("viewpoint", "iso_se")
    need(vp in render.VIEWPOINTS, 400, "unknown viewpoint")
    v = db.one("SELECT * FROM plan_versions WHERE id=? AND project_id=?", b.get("version_id") or (latest(pid) or {}).get("id"), pid)
    need(v, 400, "save a plan version first")
    spend(p["studio_id"], "render")
    jid = db.new_id()
    db.q("INSERT INTO render_jobs VALUES(?,?,?,?,?,?,?,?,?)", jid, pid, v["id"], vp, b.get("room_id"), "running", None, None, db.now())
    threading.Thread(target=run_render, args=(jid, json.loads(v["data"]), vp, b.get("room_id")), daemon=True).start()
    audit(p["studio_id"], pid, u, "render", "%s v%d" % (vp, v["n"]))
    return {"id": jid}


@route("GET", "/api/projects/(\\w+)/renders")
def list_renders(u, b, q, pid):
    project_for(u, pid)
    return db.q("""SELECT r.id,r.viewpoint,r.room_id,r.status,r.error,r.created,r.version_id,v.n AS version_n
        FROM render_jobs r JOIN plan_versions v ON v.id=r.version_id WHERE r.project_id=? ORDER BY r.created DESC""", pid)


@route("GET", "/api/projects/(\\w+)/renders/(\\w+)/image")
def render_image(u, b, q, pid, rid):
    project_for(u, pid)
    r = db.one("SELECT image FROM render_jobs WHERE id=? AND project_id=? AND status='done'", rid, pid)
    need(r, 404, "render not ready")
    return ("svg", r["image"])


@route("GET", "/api/projects/(\\w+)/posts")
def posts(u, b, q, pid):
    project_for(u, pid)
    return db.q("""SELECT p.id,p.kind,p.body,p.created,COALESCE(u.name,u.email) AS author FROM project_posts p
        LEFT JOIN users u ON u.id=p.author_id WHERE p.project_id=? ORDER BY p.created""", pid)


@route("POST", "/api/projects/(\\w+)/posts")
def add_post(u, b, q, pid):
    p = project_for(u, pid)
    kind = b.get("kind", "message")
    need(kind in ("message", "comment") and str(b.get("body", "")).strip(), 400, "bad post")
    db.q("INSERT INTO project_posts VALUES(?,?,?,?,?,?)", db.new_id(), pid, u["id"], kind, str(b["body"])[:4000], db.now())
    audit(p["studio_id"], pid, u, kind)
    return {"ok": True}


@route("GET", "/api/projects/(\\w+)/tasks")
def tasks(u, b, q, pid):
    project_for(u, pid)
    return db.q("SELECT id,title,done,assignee_id,created FROM project_tasks WHERE project_id=? ORDER BY created", pid)


@route("POST", "/api/projects/(\\w+)/tasks")
def add_task(u, b, q, pid):
    p = project_for(u, pid)
    need(is_staff(u, p), 403, "designers assign tasks")
    need(str(b.get("title", "")).strip(), 400, "title required")
    owner = db.one("SELECT user_id FROM project_access WHERE project_id=? AND role='owner'", pid)
    db.q("INSERT INTO project_tasks VALUES(?,?,?,?,?,?,?)", db.new_id(), pid, str(b["title"])[:200],
         owner["user_id"] if owner else None, 0, u["id"], db.now())
    audit(p["studio_id"], pid, u, "task_create", b["title"])
    return {"ok": True}


@route("PUT", "/api/projects/(\\w+)/tasks/(\\w+)")
def toggle_task(u, b, q, pid, tid):
    p = project_for(u, pid)
    need(db.one("SELECT 1 AS x FROM project_tasks WHERE id=? AND project_id=?", tid, pid), 404, "task not found")
    db.q("UPDATE project_tasks SET done=? WHERE id=? AND project_id=?", int(bool(b.get("done"))), tid, pid)
    audit(p["studio_id"], pid, u, "task_done" if b.get("done") else "task_reopen", tid)
    return {"ok": True}


@route("GET", "/api/projects/(\\w+)/decisions")
def decisions(u, b, q, pid):
    project_for(u, pid)
    return db.q("SELECT id,version_id,decision,note,created FROM review_decisions WHERE project_id=? ORDER BY created DESC", pid)


@route("POST", "/api/projects/(\\w+)/decisions")
def add_decision(u, b, q, pid):
    p = project_for(u, pid)
    need(is_staff(u, p), 403, "designers record review decisions")
    need(b.get("decision") in DECISIONS, 400, "bad decision")
    v = latest(pid)
    need(v, 400, "no plan version")
    db.q("INSERT INTO review_decisions VALUES(?,?,?,?,?,?,?)", db.new_id(), pid, v["id"], b["decision"], str(b.get("note", ""))[:1000],
         u["id"], db.now())
    db.q("UPDATE projects SET status=? WHERE id=?", b["decision"], pid)
    audit(p["studio_id"], pid, u, "review_decision", b["decision"])
    return {"ok": True}


@route("GET", "/api/projects/(\\w+)/audit")
def get_audit(u, b, q, pid):
    p = project_for(u, pid)
    need(is_staff(u, p), 403, "staff only")
    return db.q("SELECT user_id,action,detail,created FROM audit_events WHERE project_id=? ORDER BY created DESC LIMIT 200", pid)


# ---------- http ----------
class Handler(BaseHTTPRequestHandler):
    def send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else (body if ctype != "application/json" else json.dumps(body)).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        if ctype == "image/svg+xml":
            self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
        self.end_headers()
        self.wfile.write(data)

    def handle_any(self, method):
        path = self.path.split("?")[0]
        try:
            length = int(self.headers.get("Content-Length") or 0)
            need(length < 2_000_000, 413, "body too large")
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                raise HttpError(400, "invalid JSON")
            need(isinstance(body, dict), 400, "JSON object expected")
            for m, rx, fn, public in R:
                hit = m == method and rx.match(path)
                if hit:
                    user = None
                    if not public:
                        tok = (self.headers.get("Authorization") or "").removeprefix("Bearer ")
                        user = db.one("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?", tok)
                        need(user, 401, "login required")
                    res = fn(user, body, None, *hit.groups())
                    if isinstance(res, tuple):
                        return self.send(200, res[1], {"html": "text/html", "svg": "image/svg+xml"}[res[0]])
                    return self.send(200, res)
            raise HttpError(404, "not found")
        except HttpError as e:
            self.send(e.code, {"error": e.msg})
        except Exception as e:  # never leak internals
            print("ERROR", method, path, repr(e), flush=True)
            self.send(500, {"error": "server error"})

    do_GET = lambda self: self.handle_any("GET")
    do_POST = lambda self: self.handle_any("POST")
    do_PUT = lambda self: self.handle_any("PUT")

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    db.init()
    port = int(os.environ.get("PORT", 8001))
    print("backend on", port, flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
