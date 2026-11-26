"""The COCO classes item detection keeps (specs/item-detection.md section 6). Everything else is discarded.

Keys are RF-DETR's COCO class ids. `catalog_type` is the editor's furniture type (frontend/js/catalog.js), or None
when the catalog has no matching item. The class names must match the check in the owned_items migration.
"""

from typing import NamedTuple


class ItemClass(NamedTuple):
    item_class: str
    label: str
    catalog_type: str | None


CLASSES: dict[int, ItemClass] = {
    63: ItemClass("couch", "Sofa", "sofa"),
    62: ItemClass("chair", "Chair", "chair"),
    65: ItemClass("bed", "Bed", "double-bed"),
    67: ItemClass("dining table", "Table", "dining-table"),
    72: ItemClass("tv", "TV", "tv-unit"),
    70: ItemClass("toilet", "Toilet", "toilet"),
    81: ItemClass("sink", "Sink", "sink"),
    82: ItemClass("refrigerator", "Fridge", "fridge"),
    79: ItemClass("oven", "Oven", "stove"),
    78: ItemClass("microwave", "Microwave", None),
    64: ItemClass("potted plant", "Plant", None),
    86: ItemClass("vase", "Vase", None),
    85: ItemClass("clock", "Clock", None),
    84: ItemClass("book", "Books", None),
}

BY_NAME: dict[str, ItemClass] = {item.item_class: item for item in CLASSES.values()}
