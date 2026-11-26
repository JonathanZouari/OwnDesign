"""Own SVG renderer: isometric / top-down illustration generated from the saved 2D geometry.
No external model or API; output is illustrative only (the 2D plan stays the source of truth)."""
import math
from html import escape

import catalog

C30, S30 = math.cos(math.pi / 6), math.sin(math.pi / 6)
VIEWPOINTS = ["plan", "iso_ne", "iso_se", "iso_sw", "iso_nw"]


def _shade(hex_, f):
    h = hex_.lstrip("#")
    return "#%02x%02x%02x" % tuple(max(0, min(255, int(int(h[i:i + 2], 16) * f))) for i in (0, 2, 4))


def _rect(x, y, w, d, rot):
    cx, cy, a = x + w / 2, y + d / 2, math.radians(rot or 0)
    ca, sa = math.cos(a), math.sin(a)
    return [(cx + px * ca - py * sa, cy + px * sa + py * ca) for px, py in
            ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))]


def _seg_box(x1, y1, x2, y2, t=10):
    L = math.hypot(x2 - x1, y2 - y1) or 1
    nx, ny = -(y2 - y1) / L * t / 2, (x2 - x1) / L * t / 2
    return [(x1 + nx, y1 + ny), (x2 + nx, y2 + ny), (x2 - nx, y2 - ny), (x1 - nx, y1 - ny)]


def render(plan, viewpoint="iso_se", room_id=None):
    if viewpoint not in VIEWPOINTS:
        raise ValueError("unknown viewpoint")
    rooms = plan.get("rooms", [])
    if room_id:
        rooms = [r for r in rooms if r["id"] == room_id]
    if not rooms:
        raise ValueError("plan has no rooms to render")
    x0, y0 = min(r["x"] for r in rooms), min(r["y"] for r in rooms)
    x1, y1 = max(r["x"] + r["w"] for r in rooms), max(r["y"] + r["h"] for r in rooms)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    k = VIEWPOINTS.index(viewpoint) - 1
    mats = plan.get("materials", {})
    floor_c = catalog.MAT.get(mats.get("floor"), {}).get("color", "#d8d0c2")
    wall_c = catalog.MAT.get(mats.get("wall"), {}).get("color", "#f1ede4")
    acc_c = catalog.MAT.get(mats.get("accent"), {}).get("color", "#8a7f70")
    flat = viewpoint == "plan"

    def tf(p, z=0):
        x, y = p[0] - cx, p[1] - cy
        for _ in range(max(k, 0)):  # rotate 90° per viewpoint
            x, y = -y, x
        return (x, y - 0) if flat else ((x - y) * C30, (x + y) * S30 - z)

    def inside(f):
        return any(r["x"] - 1 <= f["x"] + f["w"] / 2 <= r["x"] + r["w"] + 1 and r["y"] - 1 <= f["y"] + f["d"] / 2 <= r["y"] + r["h"] + 1
                   for r in rooms)

    items = []  # (depth, svg)

    def poly(pts, fill, stroke="#00000022"):
        return '<polygon points="%s" fill="%s" stroke="%s" stroke-width="1"/>' % (
            " ".join("%.1f,%.1f" % p for p in pts), fill, stroke)

    def box(corners, z0, z1, color, depth_bias=0):
        rot = [(*_rot(p, cx, cy, k),) for p in corners]
        mid = (sum(p[0] for p in rot) / 4, sum(p[1] for p in rot) / 4)
        if flat:
            items.append((z1 + depth_bias, poly([tf(p) for p in corners], color)))
            return
        out = []
        for i in range(4):
            p, q = rot[i], rot[(i + 1) % 4]
            nx, ny = (q[1] - p[1]), -(q[0] - p[0])
            em = ((p[0] + q[0]) / 2 - mid[0], (p[1] + q[1]) / 2 - mid[1])
            if nx * em[0] + ny * em[1] < 0:
                nx, ny = -nx, -ny
            if nx + ny > 0:  # faces the viewer (+x,+y)
                out.append(poly([_iso(p, z0), _iso(q, z0), _iso(q, z1), _iso(p, z1)],
                                _shade(color, 0.82 if nx > ny else 0.68)))
        out.append(poly([_iso(p, z1) for p in rot], color))
        items.append((mid[0] + mid[1] + depth_bias, "".join(out)))

    def _iso(p, z):
        return ((p[0] - p[1]) * C30, (p[0] + p[1]) * S30 - z)

    for r in rooms:
        pts = [(r["x"], r["y"]), (r["x"] + r["w"], r["y"]), (r["x"] + r["w"], r["y"] + r["h"]), (r["x"], r["y"] + r["h"])]
        items.append((-1e9, poly([tf(p) for p in pts], floor_c)))
    seen = set()
    walls = []
    for r in rooms:
        a, b, c, d = (r["x"], r["y"]), (r["x"] + r["w"], r["y"]), (r["x"] + r["w"], r["y"] + r["h"]), (r["x"], r["y"] + r["h"])
        for s in ((a, b), (b, c), (c, d), (d, a)):
            key = tuple(sorted(s))
            if key not in seen:
                seen.add(key)
                walls.append(s)
    for w in plan.get("walls", []):
        walls.append(((w["x1"], w["y1"]), (w["x2"], w["y2"])))
    for p, q in walls:  # cut-away walls so the interior stays visible
        box(_seg_box(*p, *q), 0, 120, wall_c)
    for o in plan.get("openings", []):
        w = o.get("w", 90)
        col = "#9ec5d8" if o.get("type") == "window" else "#8b6b4a"
        box(_seg_box(o["x"] - w / 2, o["y"], o["x"] + w / 2, o["y"], 12) if not o.get("vertical") else
            _seg_box(o["x"], o["y"] - w / 2, o["x"], o["y"] + w / 2, 12), 0, 120 if o.get("type") != "window" else 100, col, 1)
    for f in plan.get("furniture", []):
        it = catalog.FURN.get(f.get("ref"))
        if not it or (room_id and not inside(f)):
            continue
        box(_rect(f["x"], f["y"], f["w"], f["d"], f.get("rot")), 0, it["h"], acc_c if it["group"] in ("Living", "Dining") else _shade(acc_c, 1.15))

    items.sort(key=lambda t: t[0])
    allpts = [tuple(map(float, n.split(","))) for _, s in items for g in s.split('points="')[1:] for n in g.split('"')[0].split()]
    xs, ys = [p[0] for p in allpts], [p[1] for p in allpts]
    pad = 60
    vx, vy, vw, vh = min(xs) - pad, min(ys) - pad, max(xs) - min(xs) + 2 * pad, max(ys) - min(ys) + 2 * pad + 30
    label = escape("Illustrative render · %s · not dimensionally accurate" % viewpoint)
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="%.0f %.0f %.0f %.0f" font-family="sans-serif">'
            '<rect x="%.0f" y="%.0f" width="%.0f" height="%.0f" fill="#faf8f4"/>%s'
            '<text x="%.0f" y="%.0f" font-size="%d" fill="#777">%s</text></svg>') % (
        vx, vy, vw, vh, vx, vy, vw, vh, "".join(s for _, s in items), vx + 12, vy + vh - 12, max(10, int(vw / 55)), label)


def _rot(p, cx, cy, k):
    x, y = p[0] - cx, p[1] - cy
    for _ in range(max(k, 0)):
        x, y = -y, x
    return (x, y)
