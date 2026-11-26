"""Generic furniture/material library and transparent cost estimates (no supplier pricing)."""

# id, name, group, width cm, depth cm, height cm, est. unit price EUR, wet-area fixture
_F = [
    ("sofa3", "3-seat sofa", "Living", 220, 95, 85, 1200, False),
    ("armchair", "Armchair", "Living", 85, 85, 90, 450, False),
    ("coffee", "Coffee table", "Living", 110, 60, 45, 250, False),
    ("tvunit", "TV unit", "Living", 180, 45, 50, 350, False),
    ("rug", "Rug 200×300", "Living", 300, 200, 1, 300, False),
    ("dining4", "Dining table (4)", "Dining", 140, 90, 75, 600, False),
    ("dining6", "Dining table (6)", "Dining", 200, 100, 75, 900, False),
    ("chair", "Dining chair", "Dining", 45, 50, 90, 120, False),
    ("bed160", "Double bed 160", "Bedroom", 170, 210, 100, 900, False),
    ("bed90", "Single bed 90", "Bedroom", 100, 205, 90, 450, False),
    ("wardrobe", "Wardrobe", "Bedroom", 200, 60, 220, 800, False),
    ("nightstand", "Nightstand", "Bedroom", 50, 40, 55, 120, False),
    ("desk", "Desk", "Office", 140, 70, 75, 350, False),
    ("officechair", "Office chair", "Office", 65, 65, 110, 250, False),
    ("bookcase", "Bookcase", "Office", 90, 35, 200, 250, False),
    ("kitchen_unit", "Kitchen base unit 60", "Kitchen", 60, 60, 90, 700, True),
    ("kitchen_tall", "Tall unit / fridge 60", "Kitchen", 60, 65, 220, 1100, True),
    ("island", "Kitchen island", "Kitchen", 180, 90, 90, 2500, True),
    ("bathtub", "Bathtub", "Bathroom", 170, 75, 60, 900, True),
    ("shower", "Shower tray", "Bathroom", 90, 90, 10, 600, True),
    ("toilet", "Toilet", "Bathroom", 40, 65, 80, 350, True),
    ("vanity", "Vanity + basin", "Bathroom", 80, 48, 85, 650, True),
]
FURNITURE = [dict(zip(("id", "name", "group", "w", "d", "h", "price", "wet"), f)) for f in _F]
FURN = {f["id"]: f for f in FURNITURE}

# id, name, kind, colour, est. price per m² EUR (0 = colour accent only)
_M = [
    ("oak", "Light oak parquet", "floor", "#c9a27a", 65),
    ("walnut", "Walnut engineered wood", "floor", "#6b4a33", 90),
    ("concrete", "Polished concrete", "floor", "#a5a5a1", 80),
    ("terrazzo", "Terrazzo tile", "floor", "#e3ddd3", 110),
    ("porcelain", "Large porcelain tile", "floor", "#d8d4cc", 55),
    ("white", "Warm white paint", "wall", "#f4f0e8", 12),
    ("greige", "Greige paint", "wall", "#cfc6b8", 12),
    ("sage", "Sage green paint", "wall", "#a9b49a", 14),
    ("navy", "Deep navy paint", "wall", "#2d3a4f", 14),
    ("limewash", "Limewash plaster", "wall", "#e6dccd", 35),
    ("linen", "Natural linen", "accent", "#d9cdb8", 0),
    ("black", "Black steel", "accent", "#2a2a2a", 0),
    ("terracotta", "Terracotta", "accent", "#c46a4a", 0),
    ("brass", "Brushed brass", "accent", "#b59a5b", 0),
    ("rattan", "Rattan", "accent", "#b98f58", 0),
]
MATERIALS = [dict(zip(("id", "name", "kind", "color", "price"), m)) for m in _M]
MAT = {m["id"]: m for m in MATERIALS}

STYLES = ["Scandinavian", "Japandi", "Industrial", "Mid-century", "Classic", "Coastal", "Minimal"]
WALL_HEIGHT_M = 2.6
ESTIMATE_NOTE = ("Estimates based on generic catalog averages. Not supplier quotes or live vendor pricing; "
                 "labour, delivery and construction work are not included.")


def budget(plan):
    lines = {}
    for f in plan.get("furniture", []):
        it = FURN.get(f.get("ref"))
        if not it:
            continue
        own = bool(f.get("existing"))
        line = lines.setdefault((it["id"], own), {
            "item": it["name"] + (" (already owned)" if own else ""), "group": it["group"],
            "qty": 0, "unit": "pcs", "unit_price": 0 if own else it["price"]})
        line["qty"] += 1
    rooms = plan.get("rooms", [])
    floor_m2 = sum(r["w"] * r["h"] for r in rooms) / 1e4
    # shortcut: shared walls are counted twice (both sides get painted), good enough for an estimate
    wall_m2 = sum(2 * (r["w"] + r["h"]) for r in rooms) / 100 * WALL_HEIGHT_M
    mats = plan.get("materials", {})
    for kind, qty in (("floor", floor_m2), ("wall", wall_m2)):
        m = MAT.get(mats.get(kind))
        if m and qty:
            lines[(m["id"], kind)] = {"item": m["name"], "group": "Finishes", "qty": round(qty, 1), "unit": "m²",
                                      "unit_price": m["price"]}
    out = list(lines.values())
    for line in out:
        line["total"] = round(line["qty"] * line["unit_price"])
    return {"lines": out, "total": sum(x["total"] for x in out), "currency": "EUR", "note": ESTIMATE_NOTE}
