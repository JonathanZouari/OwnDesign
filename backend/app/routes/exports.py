"""Plan export: a saved, immutable plan version as PDF, PNG or DXF (specs/plan-export.md).

The file is built here from the stored version, never from geometry the browser sends. The export is recorded
in studio activity only after the file was generated, and if that record cannot be written no file is sent.
"""

import threading
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import ValidationError

from app.auth import CurrentUser, current_user
from app.db import audit
from app.exports.dxf import render_dxf
from app.exports.layout import file_name
from app.exports.pdf import ExportInfo, render_pdf
from app.exports.png import render_png
from app.routes.projects import _project_or_404
from app.schemas import Geometry, Strict

router = APIRouter(prefix="/v1/projects/{project_id}/versions/{version_id}")

MEDIA_TYPES = {"pdf": "application/pdf", "png": "image/png", "dxf": "image/vnd.dxf"}
# An A3 PNG is about 17 megapixels; bound how many are built at once so exports cannot starve other requests.
MAX_PARALLEL_EXPORTS = 2
SLOTS = threading.BoundedSemaphore(MAX_PARALLEL_EXPORTS)


class ExportRequest(Strict):
    format: Literal["pdf", "png", "dxf"]
    paper: Literal["a4", "a3"] = "a4"  # PDF and PNG only; DXF has no page


def render(geometry: Geometry, info: ExportInfo, fmt: str, paper: str) -> bytes:
    if fmt == "dxf":
        return render_dxf(geometry)
    return render_pdf(geometry, info, paper) if fmt == "pdf" else render_png(geometry, info, paper)


@router.post("/export")
def export_plan(project_id: UUID, version_id: UUID, body: ExportRequest, user: CurrentUser = Depends(current_user)):
    # Both reads use the caller's JWT, so RLS decides; the version must also belong to this very project.
    project = _project_or_404(user, project_id)
    rows = (
        user.db.table("plan_versions")
        .select("id, version_no, label, geometry")
        .eq("project_id", project["id"])
        .eq("id", str(version_id))
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(404, "Plan version not found")
    version = rows[0]
    try:
        geometry = Geometry.model_validate(version["geometry"])
    except ValidationError:
        raise HTTPException(422, "This saved version cannot be exported") from None

    if not SLOTS.acquire(blocking=False):
        raise HTTPException(429, "Too many exports at once. Please try again in a moment.")
    try:
        info = ExportInfo(project["name"], version["version_no"], version["label"], datetime.now(UTC).date())
        content = render(geometry, info, body.format, body.paper)
    finally:
        SLOTS.release()

    # Reading is allowed in a suspended studio, so this does not use _writable_project; the event is metadata only.
    role = "designer" if user.role_in(project["studio_id"]) else "client"
    audit("plan.exported", user.id, studio_id=project["studio_id"], project_id=project["id"],
          version_no=version["version_no"], format=body.format, actor_role=role)
    return Response(
        content,
        media_type=MEDIA_TYPES[body.format],
        headers={
            "Content-Disposition": f'attachment; filename="{file_name(project["name"], version["version_no"], body.format)}"',
            "Cache-Control": "no-store",
        },
    )
