"""Existing-item detection (specs/item-detection.md).

Detection runs the model on a project's stored "Item I own" photo and returns what it found; nothing is stored.
Only the items the user accepts are stored (owned_items), and a line naming them is added to the brief.
"""

import threading
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from pydantic import Field, model_validator

from app.auth import CurrentUser, current_user
from app.db import audit, service
from app.detection.classes import BY_NAME
from app.detection.model import ImageError, ModelUnavailable, load_detector
from app.responses import ok
from app.routes.design import BUCKET, _writable_project
from app.routes.projects import _project_or_404
from app.schemas import Brief, Strict

router = APIRouter(prefix="/v1/projects/{project_id}")

# Same bounds as plan export: a few runs at a time per process, one per user, so detection cannot starve the API.
MAX_PARALLEL_DETECTIONS = 2
SLOTS = threading.BoundedSemaphore(MAX_PARALLEL_DETECTIONS)
_BUSY_USERS: set[str] = set()
_BUSY_LOCK = threading.Lock()
BUSY = {"Retry-After": "5"}

ItemClassName = Literal[
    "couch", "chair", "bed", "dining table", "tv", "toilet", "sink", "refrigerator", "oven",
    "microwave", "potted plant", "vase", "clock", "book",
]
ITEM_COLUMNS = "id, item_class, quantity, source_asset_id, created_at"
MAX_ITEMS_PER_PROJECT = 100
EXISTING_ITEMS_LIMIT = Brief.model_fields["existing_items"].metadata[0].max_length  # 1000, as the brief allows


def get_detector_loader():
    """Returns the function that loads the model. Tests override this dependency with a fake."""
    return load_detector


class OwnedItem(Strict):
    item_class: ItemClassName
    quantity: Annotated[int, Field(ge=1, le=20)]


class OwnedItemsBody(Strict):
    items: Annotated[list[OwnedItem], Field(min_length=1, max_length=len(BY_NAME))]
    source_asset_id: UUID | None = None

    @model_validator(mode="after")
    def _distinct(self):
        if len({item.item_class for item in self.items}) != len(self.items):
            raise ValueError("each item appears once, with its quantity")
        return self


def _with_labels(row: dict) -> dict:
    item = BY_NAME[row["item_class"]]
    return {**row, "label": item.label, "catalog_type": item.catalog_type}


def brief_line(items: list[OwnedItem]) -> str:
    """For example "From a photo: Sofa, Chair × 2"."""
    names = [BY_NAME[i.item_class].label + (f" × {i.quantity}" if i.quantity > 1 else "") for i in items]
    return "From a photo: " + ", ".join(names)


@router.post("/assets/{asset_id}/detect")
def detect_items(project_id: UUID, asset_id: UUID, user: CurrentUser = Depends(current_user), loader=Depends(get_detector_loader)):
    # Reading only, so allowed in a suspended studio. Both reads go through RLS with the caller's JWT.
    project = _project_or_404(user, project_id)
    rows = (
        user.db.table("inspiration_assets").select("id, kind, storage_path")
        .eq("project_id", project["id"]).eq("id", str(asset_id)).execute().data
    )
    if not rows:
        raise HTTPException(404, "Image not found")
    asset = rows[0]
    if asset["kind"] != "existing_item":
        raise HTTPException(422, "Item detection works on photos of items you own")

    with _BUSY_LOCK:
        if user.id in _BUSY_USERS:
            raise HTTPException(429, "Your previous photo is still being analysed. Please wait for it to finish.", headers=BUSY)
        _BUSY_USERS.add(user.id)
    try:
        if not SLOTS.acquire(timeout=2):
            raise HTTPException(429, "Many photos are being analysed right now. Please try again in a moment.", headers=BUSY)
        try:
            detector = loader()
            try:
                data = service().storage.from_(BUCKET).download(asset["storage_path"])
            except Exception:
                raise HTTPException(503, "The photo could not be loaded right now. Please try again.") from None
            found = detector.detect(data)
        except ModelUnavailable:
            raise HTTPException(503, "Item detection is not available right now. Please try again later.") from None
        except ImageError as error:
            raise HTTPException(422, str(error)) from None
        finally:
            SLOTS.release()
    finally:
        with _BUSY_LOCK:
            _BUSY_USERS.discard(user.id)

    audit("items.detected", user.id, studio_id=project["studio_id"], project_id=project["id"], asset_id=asset["id"], count=len(found))
    items = [
        {"item_class": d.item_class, "label": d.label, "catalog_type": d.catalog_type, "confidence": d.confidence,
         "box": {"x": round(d.box[0], 4), "y": round(d.box[1], 4), "w": round(d.box[2], 4), "h": round(d.box[3], 4)}}
        for d in found
    ]
    return ok({"items": items})


@router.get("/owned-items")
def list_owned_items(project_id: UUID, user: CurrentUser = Depends(current_user)):
    _project_or_404(user, project_id)
    rows = user.db.table("owned_items").select(ITEM_COLUMNS).eq("project_id", str(project_id)).order("created_at").execute().data
    return ok([_with_labels(row) for row in rows])


@router.post("/owned-items", status_code=201)
def add_owned_items(project_id: UUID, body: OwnedItemsBody, user: CurrentUser = Depends(current_user)):
    project = _writable_project(user, project_id)
    source = str(body.source_asset_id) if body.source_asset_id else None
    if source and not user.db.table("inspiration_assets").select("id").eq("project_id", project["id"]).eq("id", source).execute().data:
        raise HTTPException(422, "Invalid input (source_asset_id): the photo is not part of this project")

    stored = user.db.table("owned_items").select("id").eq("project_id", project["id"]).execute().data
    if len(stored) + len(body.items) > MAX_ITEMS_PER_PROJECT:
        raise HTTPException(409, "This project has reached its limit of owned items. Remove some, then try again.")

    rows = [{"project_id": project["id"], "item_class": i.item_class, "quantity": i.quantity, "source_asset_id": source,
             "created_by": user.id} for i in body.items]
    inserted = service().table("owned_items").insert(rows).execute().data
    # The line is appended in one database statement, so it cannot overwrite a brief saved at the same moment. If the
    # brief cannot take it, the items just stored are removed again, so the two never disagree.
    try:
        brief = service().rpc("append_existing_items", {
            "p_project": project["id"], "p_line": brief_line(body.items), "p_user": user.id,
            "p_max": EXISTING_ITEMS_LIMIT, "p_default": Brief().model_dump(),
        }).execute().data
    except Exception as error:
        service().table("owned_items").delete().in_("id", [row["id"] for row in inserted]).execute()
        if isinstance(error, APIError) and error.code == "P0001":
            raise HTTPException(422, f"The brief's existing items would pass {EXISTING_ITEMS_LIMIT} characters. Shorten them, then try again.") from None
        raise
    audit("items.accepted", user.id, studio_id=project["studio_id"], project_id=project["id"], count=sum(i.quantity for i in body.items))
    items = [_with_labels({key: row[key] for key in ITEM_COLUMNS.split(", ")}) for row in inserted]
    return ok({"items": items, "brief": brief})


@router.delete("/owned-items/{item_id}")
def remove_owned_item(project_id: UUID, item_id: UUID, user: CurrentUser = Depends(current_user)):
    project = _writable_project(user, project_id)
    found = user.db.table("owned_items").select("id").eq("project_id", project["id"]).eq("id", str(item_id)).execute().data
    if not found:
        raise HTTPException(404, "Item not found")
    service().table("owned_items").delete().eq("id", str(item_id)).execute()
    audit("items.removed", user.id, studio_id=project["studio_id"], project_id=project["id"])
    return ok({"id": str(item_id)})
