from uuid import UUID

from fastapi import APIRouter, Depends

from app.auth import CurrentUser, current_user
from app.catalog import MATERIALS, STYLES, SURFACES
from app.db import audit, service
from app.responses import ok
from app.routes.projects import _project_or_404
from app.schemas import Brief

catalog_router = APIRouter(prefix="/v1/catalog")
router = APIRouter(prefix="/v1/projects/{project_id}")


@catalog_router.get("")
def get_catalog(_: CurrentUser = Depends(current_user)):
    return ok({"styles": STYLES, "materials": MATERIALS, "surfaces": list(SURFACES)})


@router.get("/brief")
def get_brief(project_id: UUID, user: CurrentUser = Depends(current_user)):
    _project_or_404(user, project_id)
    rows = user.db.table("project_briefs").select("brief, updated_at").eq("project_id", str(project_id)).execute().data
    return ok(rows[0] if rows else {"brief": Brief().model_dump(), "updated_at": None})


@router.put("/brief")
def put_brief(project_id: UUID, body: Brief, user: CurrentUser = Depends(current_user)):
    project = _project_or_404(user, project_id)
    row = (
        service()
        .table("project_briefs")
        .upsert({"project_id": project["id"], "brief": body.model_dump(), "updated_by": user.id, "updated_at": "now()"})
        .execute()
        .data[0]
    )
    audit("brief.saved", user.id, studio_id=project["studio_id"], project_id=project["id"])
    return ok({"brief": row["brief"], "updated_at": row["updated_at"]})
