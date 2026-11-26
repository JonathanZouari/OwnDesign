"""Preview a straight partition edit against the complete, furnished plan."""
from collections import defaultdict
from math import atan2, degrees, hypot, sqrt
from typing import Literal
from uuid import uuid5, NAMESPACE_URL

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ValidationError
from shapely import affinity
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import polygonize, unary_union

from app.responses import ok
from app.schemas import Geometry, Id
from app.routes.layout_audit import footprint

router = APIRouter(prefix="/v1/partition-preview")
EPS = 1e-6


class Edit(BaseModel):
    geometry: Geometry
    wall_id: Id
    mode: Literal["move", "start", "end", "ellipse", "bay", "parallel"]
    offset: float = Field(ge=-3000, le=3000, allow_inf_nan=False)
    clearance: float = Field(default=90, ge=30, le=200)


def refuse(message):
    raise HTTPException(422, message)


def ends(w):
    return [(w.x1, w.y1), (w.x2, w.y2)]


def face(walls):
    edges = [LineString(ends(w)) for w in walls]
    faces = list(polygonize(edges))
    if len(faces) == 1 and abs(sum(e.length for e in edges) - faces[0].length) < .01:
        return faces[0]
    return None


def profile_height(mode, t):
    t = max(0, min(1, t))
    if t < 1e-12:
        t = 0
    if t > 1-1e-12:
        t = 1
    if mode == "ellipse":
        return sqrt(4*t*(1-t))
    if mode == "bay":
        return min(4*t, 1, 4*(1-t))
    if mode == "parallel":
        return 2 * min(t, 1-t)
    if mode == "move":
        return 1
    return 1-t if mode == "start" else t


def add_profile_vertices(vertices, selected, plan, axis, mode, ux, uy):
    length = selected.length
    a = axis.coords[0]
    def along(p):
        return (p[0]-a[0])*ux + (p[1]-a[1])*uy

    # Keep each opening on a single straight chord, shared by both copies of
    # the wall. Never cut a door or window into several independent openings.
    spans = []
    walls = {w.id:w for w in plan.walls}
    for op in plan.openings:
        edge = LineString(ends(walls[op.wallId]))
        if axis.intersection(edge).length <= EPS:
            continue
        ends_cm = sorted(along(edge.interpolate(s).coords[0]) for s in (op.offset,op.offset+op.width))
        spans.append(ends_cm)
    divisions = min(48,max(4,2*int(length/12))) if mode == "ellipse" else 4
    corners = (.5,) if mode == "parallel" else (.25,.75) if mode == "bay" else ()
    if any(lo+EPS < t*length < hi-EPS for t in corners for lo,hi in spans):
        refuse("פינת ההיסט חוצה דלת או חלון. בחרו קיר אחר או עיקול אליפטי.")
    if mode == "parallel":
        stations = [length/2]
    else:
        stations = [s for span in spans for s in span]
        stations.extend(length*i/divisions for i in range(1,divisions))
    existing = [along(p) for p in vertices if axis.distance(Point(p)) < EPS]
    for s in stations:
        if not 0 < s < length or any(lo+EPS < s < hi-EPS for lo,hi in spans):
            continue
        if any(abs(s-other) < 1.01 for other in existing):
            continue
        vertices.add((a[0]+ux*s, a[1]+uy*s))
        existing.append(s)


@router.post("")
def preview(body: Edit):
    plan = body.geometry
    selected = next((w for w in plan.walls if w.id == body.wall_id), None)
    if not selected or selected.kind != "partition" or not selected.roomId:
        refuse("בחרו קיר פנימי ישר השייך לחדר.")
    a, b = ends(selected)
    axis = LineString([a,b])
    if not any(w.roomId and w.roomId != selected.roomId and
               axis.intersection(LineString(ends(w))).length > EPS for w in plan.walls):
        refuse("בחרו מחיצה משותפת לשני חללים, בתוך תוכנית הדירה.")
    ux, uy = (b[0]-a[0])/selected.length, (b[1]-a[1])/selected.length
    vertices = {p for w in plan.walls for p in ends(w)}
    if body.mode in ("ellipse","bay","parallel"):
        add_profile_vertices(vertices, selected, plan, axis, body.mode, ux, uy)
    moved = {}
    for x,y in vertices:
        t = ((x-a[0])*ux + (y-a[1])*uy)/selected.length
        side = (x-a[0])*uy - (y-a[1])*ux
        if abs(side) < EPS and -EPS <= t <= 1+EPS:
            weight = profile_height(body.mode,t)
            d = weight*body.offset
            if abs(d)>EPS:
                moved[x,y] = (round(x-uy*d,8), round(y+ux*d,8))
    openings = defaultdict(list)
    if body.offset and not moved:
        refuse("אין בקיר מקטע פנוי לעיצוב בלי לחצות את הפתח.")
    old_rooms, new_rooms = defaultdict(list), defaultdict(list)
    for op in plan.openings:
        openings[op.wallId].append(op)
    walls, updated_openings, affected = [], {}, set()
    for w in plan.walls:
        old_rooms[w.roomId].append(w)
        p,q = ends(w)
        edge = LineString([p,q])
        if not any(edge.distance(Point(v)) < EPS for v in moved):
            walls.append(w)
            new_rooms[w.roomId].append(w)
            continue
        # Junctions sometimes lie in the middle of a longer wall on the other
        # side of a partition. Materialize them before deforming the two faces.
        cuts = sorted((edge.project(Point(v)), v) for v in vertices if edge.distance(Point(v)) < EPS)
        affected.add(w.roomId)
        for i, ((s,v),(e,z)) in enumerate(zip(cuts,cuts[1:])):
            c,d = moved.get(v,v), moved.get(z,z)
            length = hypot(d[0]-c[0], d[1]-c[1])
            if length < 1:
                refuse("העריכה מקצרת מקטע קיר מעבר לטווח המותר.")
            wid = w.id if i == 0 else "w_"+uuid5(NAMESPACE_URL,f"{w.id}:{v}:{z}").hex
            part = w.model_copy(update=dict(id=wid,x1=c[0],y1=c[1],x2=d[0],y2=d[1]))
            walls.append(part)
            new_rooms[w.roomId].append(part)
            previous_end = -1
            for op in sorted(openings[w.id],key=lambda o:o.offset):
                if op.offset+op.width <= s+EPS or op.offset >= e-EPS:
                    continue
                if op.offset < s-EPS or op.offset+op.width > e+EPS:
                    refuse("נקודת החיבור חוצה פתח קיים. בחרו מקטע אחר.")
                center = (op.offset+op.width/2-s)*length/(e-s)
                offset = center-op.width/2
                if offset < -EPS or offset+op.width > length+EPS or offset < previous_end-EPS:
                    refuse("אחרי ההזזה אין מקום לפתח ברוחבו המקורי.")
                previous_end = offset+op.width
                updated_openings[op.id] = op.model_copy(update=dict(wallId=wid,offset=max(0,offset)))
    room_map = {r.id:r for r in plan.rooms}
    before, after, warnings, areas, flagged = {}, {}, [], [], set()
    narrow_spans = []
    for rid,r in room_map.items():
        if r.ellipse:
            el = r.ellipse
            before[rid] = affinity.rotate(affinity.scale(Point(el.cx,el.cy).buffer(1),el.width/2,el.length/2),el.rotation)
        else:
            before[rid] = face(old_rooms[rid])
        after[rid] = face(new_rooms[rid]) if rid in affected else before[rid]
        if rid not in affected:
            continue
        poly = after[rid]
        if before[rid] is None or poly is None or not poly.is_valid or poly.area < 1:
            refuse("הקירות חייבים להישאר מחוברים ולתחום חדר סגור.")
        if r.layout and Polygon(r.layout.points).difference(poly).area > .01:
            refuse("גבול החלופה הקיימת יחרוג מהחדר. הקטינו את ההזזה.")
        areas.append({"room":r.name,"before":round(before[rid].area/10000,2),"after":round(poly.area/10000,2)})
        thickness = [LineString(ends(w)).buffer(w.thickness/2,cap_style="flat") for w in new_rooms[rid]]
        interior = poly.difference(unary_union(thickness))
        if r.type == "hallway":
            # Local cross sections also catch a corridor tapered by a tilted wall.
            rect = list(poly.minimum_rotated_rectangle.exterior.coords)
            u,v = max(zip(rect,rect[1:]),key=lambda pair:Point(pair[0]).distance(Point(pair[1])))
            heading = degrees(atan2(v[1]-u[1],v[0]-u[0]))
            aligned = affinity.rotate(interior,-heading,origin=poly.centroid)
            if not aligned.is_empty:
                left,top,right,bottom = aligned.bounds
                sections = [aligned.intersection(LineString([(x,top-1),(x,bottom+1)])) for x in
                          (left+(right-left)*i/20 for i in range(1,20))]
                span = min(sections,key=lambda section:section.length)
                width = span.length
                if width < body.clearance:
                    warnings.append(f"{r.name} · מעבר של כ־{width:.0f} ס״מ")
                    if span.geom_type == "LineString" and not span.is_empty:
                        narrow_spans.append(list(affinity.rotate(span,heading,origin=poly.centroid).coords))
        for item in plan.furniture:
            if before[rid].covers(Point(item.x,item.y)) and footprint(item).difference(interior).area > .01:
                flagged.add(item.id)
    for rid in affected & room_map.keys():
        for other, poly in after.items():
            if other == rid or poly is None:
                continue
            if after[rid].intersection(poly).area > before[rid].intersection(before[other]).area + .01:
                refuse("העריכה יוצרת חפיפה בין חדרים.")
    try:
        candidate = Geometry.model_validate({**plan.model_dump(by_alias=True),"walls":walls,
            "openings":[updated_openings.get(op.id,op) for op in plan.openings]})
    except ValidationError:
        refuse("התוצאה חורגת ממגבלות התוכנית.")
    return ok({"geometry":candidate.model_dump(by_alias=True,exclude_none=True),"areas":areas,
               "warnings":warnings,"furniture":sorted(flagged),"narrow_spans":narrow_spans})
