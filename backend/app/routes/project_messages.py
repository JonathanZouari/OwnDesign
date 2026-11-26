from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.auth import CurrentUser, current_user
from app.db import service
from app.responses import ok
from app.routes.projects import _project_or_404

router = APIRouter(prefix="/v1/projects/{project_id}/messages")
COLUMNS = "id,author_id,author_role,body,created_at"


class Message(BaseModel):
    request_id: UUID
    body: str = Field(min_length=1,max_length=2000)


class ReadBatch(BaseModel):
    ids: list[int] = Field(min_length=1,max_length=50)


@router.get("")
def feed(project_id: UUID, before: int | None = Query(default=None,gt=0), user: CurrentUser = Depends(current_user)):
    _project_or_404(user,project_id)
    query=user.db.table("project_messages").select(COLUMNS).eq("project_id",str(project_id))
    if before is not None:
        query=query.lt("id",before)
    rows=query.order("id",desc=True).limit(51).execute().data
    items=[{**row,"mine":row["author_id"]==user.id} for row in reversed(rows[:50])]
    for row in items:
        del row["author_id"]
    unread=user.db.rpc("project_unread_count",{"p_project":str(project_id)}).execute().data
    return ok({"items":items,"more":len(rows)>50,"unread":unread})


@router.post("",status_code=201)
def send_message(project_id: UUID, body: Message,user: CurrentUser = Depends(current_user)):
    project=_project_or_404(user,project_id)
    if project["studio"]["status"]!="active":
        raise HTTPException(403,"Studio is not active")
    message=body.body.strip()
    if not message:
        raise HTTPException(422,"Empty message")
    row={"project_id":str(project_id),"request_id":str(body.request_id),"author_id":user.id,
         "author_role":"designer" if user.role_in(project["studio_id"]) else "client","body":message}
    service().table("project_messages").upsert(row,on_conflict="project_id,author_id,request_id",ignore_duplicates=True,returning="minimal").execute()
    return ok({"sent":True})


@router.put("/read")
def mark_read(project_id: UUID, body: ReadBatch,user: CurrentUser=Depends(current_user)):
    _project_or_404(user,project_id)
    rows=user.db.table("project_messages").select("id").eq("project_id",str(project_id)).neq("author_id",user.id).in_("id",body.ids).execute().data
    if rows:
        service().table("project_message_reads").upsert(
            [{"reader_id":user.id,"message_id":r["id"]} for r in rows],ignore_duplicates=True,returning="minimal"
        ).execute()
    return ok({"read":len(rows)})
