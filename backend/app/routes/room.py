"""Room scan and the list of items already in the home.

A scan stores the photo as an "existing_item" image, runs YOLOv8 on it and returns what was found. Nothing is
added to the list until the person confirms it with POST .../items.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app import vision
from app.auth import CurrentUser, current_user
from app.db import audit, service
from app.responses import ok
from app.routes.design import ASSET_COLUMNS, MAX_ASSET_BYTES, MAX_ASSETS_PER_PROJECT, _signed_urls, _sniff, _writable_project, store_asset
from app.routes.projects import _project_or_404
from app.schemas import RoomItemEdit, RoomItemsBody

router = APIRouter(prefix="/v1/projects/{project_id}")

MAX_ITEMS_PER_PROJECT = 200
ITEM_COLUMNS = "id, room_id, label, category, color_hex, confidence, source, asset_id, box, note, created_at, updated_at"


def _plan_rooms(user: CurrentUser, project_id: str) -> set[str]:
    plan = user.db.table("plan_versions").select("geometry").eq("project_id", project_id).order("version_no", desc=True).limit(1).execute().data
    return {room["id"] for room in plan[0]["geometry"]["rooms"]} if plan else set()


def _check_room(user: CurrentUser, project_id: str, room_id: str | None) -> None:
    if room_id is not None and room_id not in _plan_rooms(user, project_id):
        raise HTTPException(422, "Invalid input (room_id): the room is not part of the saved plan")


@router.post("/scans", status_code=201)
def scan_room(
    project_id: UUID,
    file: UploadFile = File(...),
    room_id: str | None = Form(None, pattern=r"^[A-Za-z0-9_-]{1,40}$"),
    user: CurrentUser = Depends(current_user),
    detector=Depends(vision.get_detector),
):
    project = _writable_project(user, project_id)
    _check_room(user, project["id"], room_id)
    data = file.file.read(MAX_ASSET_BYTES + 1)
    detections: list[dict] = []
    if data and len(data) <= MAX_ASSET_BYTES and _sniff(data):  # store_asset refuses empty, oversized and non-image files
        # The image limit is checked again (and enforced by the database) in store_asset; checking it here first
        # means a full project does not pay for a model run.
        stored = user.db.table("inspiration_assets").select("id", count="exact").eq("project_id", project["id"]).limit(1).execute().count or 0
        if stored >= MAX_ASSETS_PER_PROJECT:
            raise HTTPException(409, "This project has reached its limit of images")
        try:
            detections = vision.scan(data, detector)
        except vision.ImageError:
            raise HTTPException(422, "The photo could not be read. Try a JPEG, PNG or WebP photo.") from None
        except vision.DetectorBusy:
            raise HTTPException(503, "The room scanner is busy. Try again in a moment.") from None
    file.file.seek(0)
    row, _ = store_asset(user, project, file, "existing_item", "Room scan")
    audit("room.scanned", user.id, studio_id=project["studio_id"], project_id=project["id"], asset_id=row["id"], count=len(detections))
    asset = {key: row[key] for key in ASSET_COLUMNS.split(", ")}
    asset["url"] = _signed_urls([row["storage_path"]]).get(row["storage_path"], "")
    return ok({"asset": asset, "room_id": room_id, "detections": detections})


@router.get("/items")
def list_items(project_id: UUID, user: CurrentUser = Depends(current_user)):
    _project_or_404(user, project_id)
    rows = user.db.table("room_items").select(ITEM_COLUMNS).eq("project_id", str(project_id)).order("created_at").order("id").execute().data
    return ok(rows)


@router.post("/items", status_code=201)
def add_items(project_id: UUID, body: RoomItemsBody, user: CurrentUser = Depends(current_user)):
    project = _writable_project(user, project_id)
    pid = project["id"]
    rooms = _plan_rooms(user, pid)
    if any(item.room_id is not None and item.room_id not in rooms for item in body.items):
        raise HTTPException(422, "Invalid input (room_id): the room is not part of the saved plan")
    asset_ids = {str(item.asset_id) for item in body.items if item.asset_id}
    if asset_ids:
        mine = (
            user.db.table("inspiration_assets").select("id").eq("project_id", pid).eq("kind", "existing_item")
            .in_("id", list(asset_ids)).execute().data
        )
        if len(mine) != len(asset_ids):
            raise HTTPException(422, "Invalid input (asset_id): the photo is not a room photo of this project")
    existing = user.db.table("room_items").select("id", count="exact").eq("project_id", pid).limit(1).execute().count or 0
    if existing + len(body.items) > MAX_ITEMS_PER_PROJECT:
        raise HTTPException(409, f"A project can list at most {MAX_ITEMS_PER_PROJECT} items")
    rows = [
        {
            **item.model_dump(mode="json"),
            "color_hex": item.color_hex.lower() if item.color_hex else None,
            "project_id": pid,
            "created_by": user.id,
        }
        for item in body.items
    ]
    try:
        created = service().table("room_items").insert(rows).execute().data
    except Exception as error:
        if getattr(error, "code", None) == "P0001":  # the quota trigger: parallel requests raced past the check above
            raise HTTPException(409, f"A project can list at most {MAX_ITEMS_PER_PROJECT} items") from None
        raise
    audit("items.added", user.id, studio_id=project["studio_id"], project_id=pid, count=len(created))
    return ok([{key: row[key] for key in ITEM_COLUMNS.split(", ")} for row in created])


def _item_or_404(user: CurrentUser, project_id: str, item_id: UUID) -> None:
    found = user.db.table("room_items").select("id").eq("project_id", project_id).eq("id", str(item_id)).execute().data
    if not found:
        raise HTTPException(404, "Item not found")


@router.put("/items/{item_id}")
def edit_item(project_id: UUID, item_id: UUID, body: RoomItemEdit, user: CurrentUser = Depends(current_user)):
    project = _writable_project(user, project_id)
    _item_or_404(user, project["id"], item_id)
    _check_room(user, project["id"], body.room_id)
    changes = {**body.model_dump(), "color_hex": body.color_hex.lower() if body.color_hex else None, "updated_at": "now()"}
    updated = service().table("room_items").update(changes).eq("id", str(item_id)).eq("project_id", project["id"]).execute().data
    if not updated:  # deleted in the meantime
        raise HTTPException(404, "Item not found")
    row = updated[0]
    audit("item.edited", user.id, studio_id=project["studio_id"], project_id=project["id"], item_id=str(item_id))
    return ok({key: row[key] for key in ITEM_COLUMNS.split(", ")})


@router.delete("/items/{item_id}")
def delete_item(project_id: UUID, item_id: UUID, user: CurrentUser = Depends(current_user)):
    project = _writable_project(user, project_id)
    _item_or_404(user, project["id"], item_id)
    service().table("room_items").delete().eq("id", str(item_id)).eq("project_id", project["id"]).execute()
    audit("item.removed", user.id, studio_id=project["studio_id"], project_id=project["id"], item_id=str(item_id))
    return ok({"id": str(item_id)})
