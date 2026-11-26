"""Client tasks (PRD FR-13): the studio's designer asks, the project's client marks the task done."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError

from app.auth import CurrentUser, current_user
from app.db import audit, service
from app.responses import ok
from app.routes.design import _writable_project
from app.routes.projects import _project_or_404
from app.schemas import TaskCreate, TaskUpdate

router = APIRouter(prefix="/v1/projects/{project_id}/tasks")
inbox_router = APIRouter(prefix="/v1/tasks")

TASK_COLUMNS = "id, title, details, status, client_note, done_at, created_at"
MAX_TASKS_PER_PROJECT = 200
QUOTA_ERROR = "This project has reached its limit of tasks"


def _is_designer(user: CurrentUser, project: dict) -> bool:
    return user.role_in(project["studio_id"]) is not None


def _is_client(user: CurrentUser, project: dict) -> bool:
    return project["client_user_id"] == user.id


def _task_or_404(user: CurrentUser, project: dict, task_id: UUID) -> dict:
    # RLS-scoped, and bound to this project: a task of another project is not found here.
    rows = user.db.table("project_tasks").select(TASK_COLUMNS).eq("project_id", project["id"]).eq("id", str(task_id)).execute().data
    if not rows:
        raise HTTPException(404, "Task not found")
    return rows[0]


@router.get("")
def list_tasks(project_id: UUID, user: CurrentUser = Depends(current_user)):
    _project_or_404(user, project_id)
    rows = (
        user.db.table("project_tasks")
        .select(TASK_COLUMNS)
        .eq("project_id", str(project_id))
        .order("status", desc=True)  # 'open' sorts after 'done', so descending puts open tasks first
        .order("created_at", desc=True)
        .execute()
        .data
    )
    return ok(rows)


@router.post("", status_code=201)
def create_task(project_id: UUID, body: TaskCreate, user: CurrentUser = Depends(current_user)):
    project = _writable_project(user, project_id)
    if not _is_designer(user, project):
        raise HTTPException(403, "Only the studio can create tasks")
    existing = user.db.table("project_tasks").select("id", count="exact").eq("project_id", project["id"]).limit(1).execute()
    if (existing.count or 0) >= MAX_TASKS_PER_PROJECT:
        raise HTTPException(409, QUOTA_ERROR)
    try:
        row = (
            service()
            .table("project_tasks")
            .insert({"project_id": project["id"], "title": body.title, "details": body.details, "created_by": user.id})
            .execute()
            .data[0]
        )
    except APIError as error:
        if error.code == "P0001":  # the database quota trigger: parallel creates raced past the check above
            raise HTTPException(409, QUOTA_ERROR) from None
        raise
    audit("task.created", user.id, studio_id=project["studio_id"], project_id=project["id"], task_id=row["id"])
    return ok({key: row[key] for key in TASK_COLUMNS.split(", ")})


@router.patch("/{task_id}")
def update_task(project_id: UUID, task_id: UUID, body: TaskUpdate, user: CurrentUser = Depends(current_user)):
    project = _writable_project(user, project_id)
    _task_or_404(user, project, task_id)
    if body.status == "done":
        if not _is_client(user, project):
            raise HTTPException(403, "Only the client marks a task as done")
        changes = {"status": "done", "done_at": "now()", "done_by": user.id, "client_note": body.client_note}
        expected = "open"
    else:
        if not (_is_client(user, project) or _is_designer(user, project)):
            raise HTTPException(403, "You cannot reopen this task")
        changes = {"status": "open", "done_at": None, "done_by": None, "client_note": ""}
        expected = "done"
    # Conditional on the current status: of two simultaneous clicks, one changes the task and one gets 409.
    updated = (
        service()
        .table("project_tasks")
        .update(changes)
        .eq("id", str(task_id))
        .eq("project_id", project["id"])
        .eq("status", expected)
        .execute()
        .data
    )
    if not updated:
        raise HTTPException(409, f"This task is already {body.status}")
    action = "task.completed" if body.status == "done" else "task.reopened"
    audit(action, user.id, studio_id=project["studio_id"], project_id=project["id"], task_id=str(task_id))
    return ok({key: updated[0][key] for key in TASK_COLUMNS.split(", ")})


@router.delete("/{task_id}")
def delete_task(project_id: UUID, task_id: UUID, user: CurrentUser = Depends(current_user)):
    project = _writable_project(user, project_id)
    _task_or_404(user, project, task_id)
    if not _is_designer(user, project):
        raise HTTPException(403, "Only the studio can delete tasks")
    service().table("project_tasks").delete().eq("id", str(task_id)).eq("project_id", project["id"]).execute()
    audit("task.deleted", user.id, studio_id=project["studio_id"], project_id=project["id"], task_id=str(task_id))
    return ok({"id": str(task_id)})


@inbox_router.get("")
def my_open_tasks(user: CurrentUser = Depends(current_user)):
    """The client's inbox: open tasks on every project where the caller is the client."""
    projects = {row["id"]: row["name"] for row in user.db.table("projects").select("id, name").eq("client_user_id", user.id).execute().data}
    if not projects:
        return ok([])
    rows = (
        user.db.table("project_tasks")
        .select("id, project_id, title, created_at")
        .in_("project_id", list(projects))
        .eq("status", "open")
        .order("created_at", desc=True)
        .execute()
        .data
    )
    return ok([{**row, "project_name": projects[row["project_id"]]} for row in rows])
