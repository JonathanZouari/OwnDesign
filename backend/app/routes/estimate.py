import json
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError

from app.auth import CurrentUser, current_user
from app.db import audit, service
from app.responses import ok
from app.routes.design import _writable_project
from app.routes.projects import _project_or_404
from app.schemas import EstimateBody

router = APIRouter(prefix="/v1/projects/{project_id}")
sample_router = APIRouter(prefix="/v1/estimate")

ITEM_COLUMNS = "id, position, category, name, room, quantity, unit, unit_price, source, note"
STALE_VERSION = "PT409"  # raised by replace_estimate when p_base is not the current updated_at

# Fail fast: a broken sample file stops the app from starting instead of failing for the first user.
_SAMPLE = json.loads((Path(__file__).resolve().parent.parent / "data" / "sample_shopping_list.json").read_text(encoding="utf-8"))
EstimateBody.model_validate({"currency": _SAMPLE["currency"], "items": _SAMPLE["items"]})


def _amount(quantity: Decimal, unit_price: int) -> int:
    return int((quantity * unit_price).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def _status(items: list, total: int, budget: dict | None, currency: str | None) -> str:
    if not items:
        return "no_items"
    if budget is None or (budget["min"] is None and budget["max"] is None):
        return "no_budget"
    if budget["currency"] != currency:
        return "currency_mismatch"
    if budget["min"] is not None and total < budget["min"]:
        return "under"
    if budget["max"] is not None and total > budget["max"]:
        return "over"
    return "within"


def _payload(user: CurrentUser, project_id: str) -> dict:
    # The header is read before the items: a save in between then leaves updated_at older than the items, so the
    # next checked save conflicts instead of overwriting something the caller never saw.
    head = user.db.table("project_estimates").select("currency, updated_at").eq("project_id", project_id).execute().data
    rows = user.db.table("estimate_items").select(ITEM_COLUMNS).eq("project_id", project_id).order("position").execute().data
    brief = user.db.table("project_briefs").select("brief").eq("project_id", project_id).execute().data
    currency = head[0]["currency"] if head else None
    items, by_category, total = [], {}, 0
    for row in rows:
        quantity = Decimal(str(row["quantity"]))
        amount = _amount(quantity, row["unit_price"])
        total += amount
        by_category[row["category"]] = by_category.get(row["category"], 0) + amount
        items.append({**row, "quantity": float(quantity), "amount": amount})
    budget = None
    if brief:
        b = brief[0]["brief"]
        budget = {"min": b.get("budget_min"), "max": b.get("budget_max"), "currency": b.get("currency")}
    return {
        "currency": currency,
        "updated_at": head[0]["updated_at"] if head else None,
        "items": items,
        "totals": {"total": total, "by_category": by_category},
        "budget": budget,
        "status": _status(items, total, budget, currency),
    }


@router.get("/estimate")
def get_estimate(project_id: UUID, user: CurrentUser = Depends(current_user)):
    project = _project_or_404(user, project_id)
    return ok(_payload(user, project["id"]))


@router.put("/estimate")
def put_estimate(project_id: UUID, body: EstimateBody, user: CurrentUser = Depends(current_user)):
    project = _writable_project(user, project_id)
    items = [{**item.model_dump(), "quantity": str(item.quantity)} for item in body.items]
    params = {"p_project": project["id"], "p_user": user.id, "p_currency": body.currency, "p_items": items}
    if "base_updated_at" in body.model_fields_set:
        base = body.base_updated_at
        params |= {"p_check": True, "p_base": base.isoformat() if base else None}  # keeps the microseconds
    try:
        service().rpc("replace_estimate", params).execute()
    except APIError as error:
        if error.code == STALE_VERSION:
            raise HTTPException(409, "The shopping list was changed by someone else. Load the latest version before saving.") from None
        raise
    audit("estimate.saved", user.id, studio_id=project["studio_id"], project_id=project["id"], count=len(items))
    return ok(_payload(user, project["id"]))


@sample_router.get("/sample")
def get_sample(_: CurrentUser = Depends(current_user)):
    return ok(_SAMPLE)
