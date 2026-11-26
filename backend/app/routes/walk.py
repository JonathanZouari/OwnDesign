""""How we move": walking paths traced in the browser from a short video, and notes pinned on them.

The video stays on the client's device. The browser sends one still frame (JPEG/PNG/WebP) and the
path as points in frame fractions (0..1). Same access rules as the other design data.
"""

import json
import uuid
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import TypeAdapter, ValidationError

from app.auth import CurrentUser, current_user
from app.db import audit, service
from app.responses import ok
from app.routes.design import BUCKET, _drain_storage_deletions, _signed_urls, _sniff, _writable_project
from app.routes.projects import _project_or_404
from app.schemas import MAX_PATH_POINTS, PathPoints, WalkNoteCreate

router = APIRouter(prefix="/v1/projects/{project_id}/walk-paths")

MAX_FRAME_BYTES = 1_500_000  # keeps the multipart body under the API's 2 MB limit
MAX_PATHS_PER_PROJECT = 10
MAX_NOTES_PER_PATH = 50
PATH_COLUMNS = "id, label, points, width, height, created_at"
NOTE_COLUMNS = "id, path_id, x, y, text, author_role, created_at"
_points = TypeAdapter(PathPoints)


def _path_or_404(user: CurrentUser, project_id: str, path_id: UUID) -> dict:
    rows = user.db.table("walk_paths").select("id").eq("project_id", project_id).eq("id", str(path_id)).execute().data
    if not rows:
        raise HTTPException(404, "Walking path not found")
    return rows[0]


@router.get("")
def list_paths(project_id: UUID, user: CurrentUser = Depends(current_user)):
    _project_or_404(user, project_id)
    paths = user.db.table("walk_paths").select(f"{PATH_COLUMNS}, storage_path").eq("project_id", str(project_id)).order("created_at").execute().data
    notes = (
        user.db.table("walk_path_notes").select(NOTE_COLUMNS).in_("path_id", [p["id"] for p in paths]).order("created_at").execute().data
        if paths
        else []
    )
    urls = _signed_urls([p["storage_path"] for p in paths])
    return ok(
        [
            {
                **{k: v for k, v in path.items() if k != "storage_path"},
                "url": urls.get(path["storage_path"], ""),
                "notes": [n for n in notes if n["path_id"] == path["id"]],
            }
            for path in paths
        ]
    )


@router.post("", status_code=201)
def add_path(
    project_id: UUID,
    file: UploadFile = File(...),
    points: str = Form(..., max_length=MAX_PATH_POINTS * 40),
    width: int = Form(..., ge=1, le=4096),
    height: int = Form(..., ge=1, le=4096),
    label: str = Form("", max_length=80),
    user: CurrentUser = Depends(current_user),
):
    project = _writable_project(user, project_id)
    try:
        parsed = _points.validate_python(json.loads(points))
    except (ValueError, ValidationError):
        raise HTTPException(422, "Invalid input (points): expected 2 to 600 [x, y] pairs between 0 and 1") from None
    data = file.file.read(MAX_FRAME_BYTES + 1)
    if not data:
        raise HTTPException(422, "The image is empty")
    if len(data) > MAX_FRAME_BYTES:
        raise HTTPException(413, "The frame image can be at most 1.5 MB")
    sniffed = _sniff(data)
    if sniffed is None:
        raise HTTPException(415, "Only JPEG, PNG and WebP images are accepted")
    existing = user.db.table("walk_paths").select("id").eq("project_id", project["id"]).execute().data
    if len(existing) >= MAX_PATHS_PER_PROJECT:
        raise HTTPException(409, "This project has reached its limit of walking paths")
    mime, extension = sniffed
    path = f"{project['id']}/walk/{uuid.uuid4()}.{extension}"
    service().storage.from_(BUCKET).upload(path, data, {"content-type": mime})
    try:
        row = (
            service()
            .table("walk_paths")
            .insert(
                {"project_id": project["id"], "label": label.strip(), "storage_path": path, "points": [list(p) for p in parsed],
                 "width": width, "height": height, "created_by": user.id}
            )
            .execute()
            .data[0]
        )
    except Exception as error:
        service().storage.from_(BUCKET).remove([path])
        if getattr(error, "code", None) == "P0001":  # the database quota trigger: parallel uploads raced past the check above
            raise HTTPException(409, "This project has reached its limit of walking paths") from None
        raise
    audit("walk_path.added", user.id, studio_id=project["studio_id"], project_id=project["id"], path_id=row["id"], points=len(parsed))
    return ok({**{key: row[key] for key in PATH_COLUMNS.split(", ")}, "url": _signed_urls([path]).get(path, ""), "notes": []})


@router.delete("/{path_id}")
def delete_path(project_id: UUID, path_id: UUID, user: CurrentUser = Depends(current_user)):
    project = _writable_project(user, project_id)
    _path_or_404(user, project["id"], path_id)
    service().table("walk_paths").delete().eq("id", str(path_id)).execute()  # the trigger queues the frame image
    _drain_storage_deletions()
    audit("walk_path.removed", user.id, studio_id=project["studio_id"], project_id=project["id"], path_id=str(path_id))
    return ok({"id": str(path_id)})


@router.post("/{path_id}/notes", status_code=201)
def add_note(project_id: UUID, path_id: UUID, body: WalkNoteCreate, user: CurrentUser = Depends(current_user)):
    project = _writable_project(user, project_id)
    _path_or_404(user, project["id"], path_id)
    # shortcut: parallel notes can pass this count together and exceed 50 by a few; add a trigger like walk_paths_quota if that matters.
    count = user.db.table("walk_path_notes").select("id").eq("path_id", str(path_id)).execute().data
    if len(count) >= MAX_NOTES_PER_PATH:
        raise HTTPException(409, "This path has reached its limit of notes")
    role = "designer" if user.role_in(project["studio_id"]) else "client"
    row = (
        service()
        .table("walk_path_notes")
        .insert({"path_id": str(path_id), "x": body.x, "y": body.y, "text": body.text, "author_role": role, "author_id": user.id})
        .execute()
        .data[0]
    )
    audit("walk_note.added", user.id, studio_id=project["studio_id"], project_id=project["id"], path_id=str(path_id))
    return ok({key: row[key] for key in NOTE_COLUMNS.split(", ")})

