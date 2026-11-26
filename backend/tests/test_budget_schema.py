"""Budget payload validation: pure unit tests, no Supabase needed."""

import pytest
from pydantic import ValidationError

from app.schemas import BudgetBody

LINE = {"kind": "custom", "label": "Curtains", "qty": 2, "unit": "item", "unit_price": 150}


def body(*items):
    return BudgetBody.model_validate({"items": list(items)})


def test_valid_lines_of_every_kind():
    result = body(
        LINE,
        {"kind": "furniture", "ref": "sofa", "label": "Sofa", "qty": 1, "unit": "item", "unit_price": 900},
        {"kind": "finish", "ref": "r1|floor", "label": "Floor", "qty": 12.5, "unit": "m2", "unit_price": 70},
    )
    assert len(result.items) == 3 and result.items[2].qty == 12.5


def test_empty_budget_is_allowed():
    assert body().items == []


@pytest.mark.parametrize(
    "bad",
    [
        {**LINE, "qty": -1},
        {**LINE, "qty": 100_001},
        {**LINE, "qty": float("nan")},
        {**LINE, "unit_price": -5},
        {**LINE, "unit_price": 100_000_001},
        {**LINE, "unit_price": 1.5},
        {**LINE, "label": ""},
        {**LINE, "label": "x" * 81},
        {**LINE, "note": "x" * 201},
        {**LINE, "unit": "kg"},
        {**LINE, "kind": "other"},
        {**LINE, "ref": "sofa"},  # a custom line has no ref
        {**LINE, "extra": 1},
        {"kind": "furniture", "label": "Sofa", "qty": 1, "unit": "item", "unit_price": 1},  # missing ref
        {"kind": "furniture", "ref": "sofa", "label": "Sofa", "qty": 1, "unit": "m2", "unit_price": 1},
        {"kind": "furniture", "ref": "r1|floor", "label": "Sofa", "qty": 1, "unit": "item", "unit_price": 1},
        {"kind": "finish", "ref": "r1|roof", "label": "x", "qty": 1, "unit": "m2", "unit_price": 1},
        {"kind": "finish", "ref": "r1|floor", "label": "x", "qty": 1, "unit": "item", "unit_price": 1},
        {"kind": "finish", "ref": "|floor", "label": "x", "qty": 1, "unit": "m2", "unit_price": 1},
        {"kind": "finish", "ref": "bad ref!", "label": "x", "qty": 1, "unit": "m2", "unit_price": 1},
    ],
)
def test_invalid_lines_are_rejected(bad):
    with pytest.raises(ValidationError):
        body(bad)


def test_duplicate_ref_is_rejected_but_custom_lines_may_repeat():
    sofa = {"kind": "furniture", "ref": "sofa", "label": "Sofa", "qty": 1, "unit": "item", "unit_price": 1}
    with pytest.raises(ValidationError):
        body(sofa, sofa)
    assert len(body(LINE, LINE).items) == 2


def test_more_than_300_lines_is_rejected():
    assert len(body(*[LINE] * 300).items) == 300
    with pytest.raises(ValidationError):
        body(*[LINE] * 301)


def test_markup_is_kept_as_plain_text():
    assert body({**LINE, "label": "<img src=x onerror=alert(1)>"}).items[0].label.startswith("<img")
