from math import cos, sin, radians, hypot
from collections import defaultdict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from shapely.affinity import rotate, scale
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree

from app.responses import ok
from app.schemas import Geometry, Id, RoomLayout


router = APIRouter(prefix="/v1/layout-audit")
EPS = 0.01  # cm or square cm, for numerical noise at a boundary


class AuditRequest(BaseModel):
    geometry: Geometry
    clearance_cm: float = Field(default=90, ge=30, le=200)


def footprint(item):
    rect = box(item.x-item.w/2, item.y-item.d/2, item.x+item.w/2, item.y+item.d/2)
    return rotate(rect, item.rotation, origin=(item.x, item.y))


def opening_zone(wall, opening, polygon, depth):
    ux = (wall.x2-wall.x1)/wall.length
    uy = (wall.y2-wall.y1)/wall.length
    x = wall.x1 + ux * opening.offset
    y = wall.y1 + uy * opening.offset
    middle = (x+ux*opening.width/2, y+uy*opening.width/2)
    nx, ny = -uy, ux
    if not polygon.covers(Point(middle[0]+nx*0.1, middle[1]+ny*0.1)):
        nx, ny = -nx, -ny
    x += nx*wall.thickness/2
    y += ny*wall.thickness/2
    end = (x+ux*opening.width, y+uy*opening.width)
    return Polygon([(x,y),end,(end[0]+nx*depth,end[1]+ny*depth),(x+nx*depth,y+ny*depth)])


class LayoutProposal(BaseModel):
    geometry: Geometry
    room_id: Id
    candidate: RoomLayout


@router.post("/reshape")
def reshape(body: LayoutProposal):
    room = next((r for r in body.geometry.rooms if r.id == body.room_id), None)
    if not room:
        raise HTTPException(422, "Unknown room")
    if room.ellipse:
        e = room.ellipse
        shell = rotate(scale(Point(e.cx, e.cy).buffer(1, quad_segs=128), e.width/2, e.length/2), e.rotation)
    else:
        edges = [LineString([(w.x1,w.y1),(w.x2,w.y2)]) for w in body.geometry.walls if w.roomId == room.id]
        faces = list(polygonize(edges))
        if len(faces) != 1 or abs(sum(edge.length for edge in edges) - faces[0].length) > EPS:
            raise HTTPException(422, "Open room boundary")
        shell = faces[0]
    candidate = Polygon(body.candidate.points)
    if not candidate.is_valid or candidate.area <= EPS:
        raise HTTPException(422, "Invalid layout")
    inside = candidate.intersection(shell)
    if inside.geom_type != "Polygon" or inside.area <= EPS or inside.interiors:
        raise HTTPException(422, "Layout must form a single usable room")
    result = body.candidate.model_copy(update={"points":list(inside.exterior.coords)[:-1]})
    updated = room.model_copy(update={"layout": result})
    plan = body.geometry.model_copy(update={"rooms":[updated if r.id == room.id else r for r in body.geometry.rooms]})
    findings = check_layout(AuditRequest(geometry=plan))["data"]["findings"]
    return ok({"layout":result.model_dump(), "clipped":candidate.area-inside.area > EPS,
               "findings":[f for f in findings if f["room"] == room.id and f["rule"] in ("fit","opening_gap")]})


@router.post("")
def check_layout(body: AuditRequest):
    plan, depth = body.geometry, body.clearance_cm
    walls_by_room, openings = defaultdict(list), defaultdict(list)
    for wall in plan.walls:
        walls_by_room[wall.roomId].append(wall)
    for op in plan.openings:
        openings[op.wallId].append(op)
    findings = []
    shapes = [footprint(item) for item in plan.furniture]
    tree = STRtree(shapes)
    assigned = set()

    def add(rule, room, target=None, value=None, other=None):
        findings.append(dict(rule=rule, room=room, target=target, value=value, other=other))

    for room in plan.rooms:
        walls = walls_by_room[room.id]
        layout = Polygon(room.layout.points) if room.layout else None
        if room.ellipse:
            e = room.ellipse
            angle = radians(e.rotation)
            c, s = cos(angle), sin(angle)

            def contains(x, y):
                dx, dy = x-e.cx, y-e.cy
                return ((dx*c+dy*s)/(e.width/2))**2 + ((dy*c-dx*s)/(e.length/2))**2 <= 1+1e-10

            # Use the exact ellipse for containment. Approximate only the reported overlap area.
            center = (e.cx, e.cy)
            outline = scale(Point(center).buffer(1, quad_segs=128), e.width/2, e.length/2, origin=center)
            outline = rotate(outline, e.rotation, origin=center)
            add("window", room.id)
            if room.type == "hallway" and min(e.width,e.length)+EPS < depth:
                add("corridor", room.id, value=min(e.width,e.length))
            for idx in tree.query(outline.envelope.buffer(0.1)):
                item = plan.furniture[idx]
                if item.id in assigned or not contains(item.x,item.y):
                    continue
                assigned.add(item.id)
                if layout is not None:
                    outside = shapes[idx].difference(layout.intersection(outline)).area
                    if outside > EPS:
                        add("fit",room.id,item.id,round(outside,1))
                elif any(not contains(x,y) for x,y in shapes[idx].exterior.coords):
                    add("fit",room.id,item.id,round(shapes[idx].difference(outline).area,1))
            continue
        segments = [LineString([(w.x1,w.y1),(w.x2,w.y2)]) for w in walls]
        faces = list(polygonize(segments))
        if len(faces)!=1 or not faces[0].is_valid or abs(sum(s.length for s in segments)-faces[0].length)>EPS:
            add("incomplete",room.id)
            continue
        polygon = faces[0]
        interior = polygon.difference(unary_union([s.buffer(w.thickness/2,cap_style="flat") for w,s in zip(walls,segments)]))
        if layout is not None:
            interior = interior.intersection(layout)
        if not any(op.type=="window" for w in walls for op in openings[w.id]):
            add("window",room.id)
        if room.type=="hallway" and not interior.is_empty:
            coords=list(interior.minimum_rotated_rectangle.exterior.coords)
            width=min(hypot(b[0]-a[0],b[1]-a[1]) for a,b in zip(coords,coords[1:]))
            if width+EPS<depth:
                add("corridor",room.id,value=round(width,1))
        for idx in tree.query(polygon):
            item=plan.furniture[idx]
            if item.id in assigned or not polygon.covers(Point(item.x,item.y)):
                continue
            assigned.add(item.id)
            outside=shapes[idx].difference(interior).area
            if outside>EPS:
                add("fit",room.id,item.id,round(outside,1))
        for wall in walls:
            for op in openings[wall.id]:
                if layout is not None:
                    edge = LineString([(wall.x1,wall.y1),(wall.x2,wall.y2)])
                    span = LineString([edge.interpolate(op.offset), edge.interpolate(op.offset+op.width)])
                    if span.difference(layout.buffer(wall.thickness/2)).length > EPS:
                        add("opening_gap",room.id,op.id)
                if op.type=="window":
                    continue
                if op.width+EPS<depth:
                    add("narrow",room.id,op.id,round(op.width,1))
                zone=opening_zone(wall,op,polygon,depth)
                for idx in tree.query(zone):
                    overlap=shapes[idx].intersection(zone).area
                    if overlap>EPS:
                        add("blocked",room.id,plan.furniture[idx].id,round(overlap,1),op.id)
    for item in plan.furniture:
        if item.id not in assigned:
            add("unassigned",None,item.id)
    return ok({"findings":findings,"clearance_cm":depth})
