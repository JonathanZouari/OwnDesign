"""Budget and shopping list (PRD FR-10, FR-11): editable, non-binding estimates. No supplier prices."""

import math
from uuid import UUID

from fastapi import APIRouter, Depends

from app.auth import CurrentUser, current_user
from app.catalog import (
    CABINET_M2,
    CURRENCY_FACTOR,
    FURNITURE_PRICES_USD,
    MATERIAL_PRICES_USD,
    MATERIALS_BY_ID,
    WALL_HEIGHT_M,
)
from app.db import audit, service
from app.responses import ok
from app.routes.design import _writable_project
from app.routes.projects import _project_or_404
from app.schemas import BudgetBody

router = APIRouter(prefix="/v1/projects/{project_id}/budget")
COLUMNS = "kind, ref, label, qty, unit, unit_price, note"
NOTICE = "Estimates only: not quotes and not supplier prices."


def _latest_plan(user: CurrentUser, project_id: str) -> dict | None:
    rows = user.db.table("plan_versions").select("geometry").eq("project_id", project_id).order("version_no", desc=True).limit(1).execute().data
    return rows[0]["geometry"] if rows else None


def _brief(user: CurrentUser, project_id: str) -> dict:
    rows = user.db.table("project_briefs").select("brief").eq("project_id", project_id).execute().data
    return rows[0]["brief"] if rows else {}


def _room_box(plan: dict, room_id: str) -> tuple[float, float] | None:
    points = [(w[a], w[b]) for w in plan["walls"] if w.get("roomId") == room_id for a, b in (("x1", "y1"), ("x2", "y2"))]
    if not points:
        return None
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return (max(xs) - min(xs)) / 100, (max(ys) - min(ys)) / 100  # metres


def _line(item: dict, plan: dict | None) -> dict:
    """A saved line plus `stale`: its furniture type or room is no longer in the saved plan."""
    stale = False
    if item["kind"] != "custom":
        if plan is None:
            stale = True
        elif item["kind"] == "furniture":
            stale = item["ref"] not in {f["type"] for f in plan["furniture"]}
        else:
            stale = item["ref"].split("|")[0] not in {r["id"] for r in plan["rooms"]}
    qty = float(item["qty"])
    # Half rounds up, like Math.round in the browser (Python's round() would round half to even).
    return {**item, "qty": qty, "subtotal": math.floor(qty * item["unit_price"] + 0.5), "stale": stale}


def _summary(user: CurrentUser, project_id: str) -> dict:
    items = user.db.table("budget_items").select(COLUMNS).eq("project_id", project_id).order("position").execute().data
    plan = _latest_plan(user, project_id)
    lines = [_line(item, plan) for item in items]
    brief = _brief(user, project_id)
    subtotals = {kind: sum(line["subtotal"] for line in lines if line["kind"] == kind) for kind in ("furniture", "finish", "custom")}
    return {
        "items": lines,
        "subtotals": subtotals,
        "total": sum(subtotals.values()),
        "currency": brief.get("currency") or "USD",
        "budget_min": brief.get("budget_min"),
        "budget_max": brief.get("budget_max"),
        "notice": NOTICE,
    }


@router.get("")
def get_budget(project_id: UUID, user: CurrentUser = Depends(current_user)):
    _project_or_404(user, project_id)
    return ok(_summary(user, str(project_id)))


@router.put("")
def put_budget(project_id: UUID, body: BudgetBody, user: CurrentUser = Depends(current_user)):
    project = _writable_project(user, project_id)
    # One database transaction: a failure or a parallel save never leaves the project without its budget.
    rows = [{**item.model_dump(), "position": i} for i, item in enumerate(body.items)]
    service().rpc("save_budget", {"p_project": project["id"], "p_user": user.id, "p_items": rows}).execute()
    audit("budget.saved", user.id, studio_id=project["studio_id"], project_id=project["id"], count=len(body.items))
    return ok(_summary(user, project["id"]))


@router.get("/suggestions")
def get_suggestions(project_id: UUID, user: CurrentUser = Depends(current_user)):
    """Lines derived from the saved plan and finishes, priced from the placeholder catalog. Nothing is saved."""
    _project_or_404(user, project_id)
    pid = str(project_id)
    plan = _latest_plan(user, pid)
    currency = _brief(user, pid).get("currency") or "USD"
    factor = CURRENCY_FACTOR[currency]
    suggestions: list[dict] = []
    if plan:
        counts: dict[str, int] = {}
        for item in plan["furniture"]:
            counts[item["type"]] = counts.get(item["type"], 0) + 1
        for kind, count in sorted(counts.items()):
            suggestions.append({
                "kind": "furniture", "ref": kind, "label": kind.replace("-", " ").capitalize(), "qty": float(count), "unit": "item",
                "unit_price": round(FURNITURE_PRICES_USD.get(kind, 0) * factor), "note": "",
            })
        names = {room["id"]: room["name"] for room in plan["rooms"]}
        finishes = user.db.table("finish_selections").select("room_id, surface, material_id").eq("project_id", pid).execute().data
        for finish in finishes:
            material = MATERIALS_BY_ID.get(finish["material_id"])
            if material is None or finish["room_id"] not in names:
                continue
            box = _room_box(plan, finish["room_id"])
            if finish["surface"] == "cabinets":
                qty = CABINET_M2
            elif box is None:
                qty = 0.0
            elif finish["surface"] == "walls":
                qty = 2 * (box[0] + box[1]) * WALL_HEIGHT_M
            else:
                qty = box[0] * box[1]
            suggestions.append({
                "kind": "finish", "ref": f"{finish['room_id']}|{finish['surface']}",
                "label": f"{names[finish['room_id']]} {finish['surface']}: {material['label']}"[:80], "qty": round(qty, 2), "unit": "m2",
                "unit_price": round(MATERIAL_PRICES_USD.get(finish["material_id"], 0) * factor), "note": "",
            })
    return ok({"suggestions": suggestions, "currency": currency, "notice": NOTICE})
