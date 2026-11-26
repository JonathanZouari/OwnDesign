"""The style profile of a project: what its analysed inspiration images have in common.

Pure functions over the stored analyses (`asset_analyses`): the colours they share, weighted by how much of each
image they cover, and the kinds of objects that keep appearing. No style name is guessed.
"""

from collections import defaultdict

MAX_PROFILE_COLOURS = 6


def style_profile(analyses: list[dict], total: int) -> dict:
    """`analyses`: one {palette, objects} per analysed image; `total`: inspiration images in the project."""
    colour_share: dict[str, float] = defaultdict(float)
    colour_images: dict[str, int] = defaultdict(int)
    best_shade: dict[str, tuple[float, str]] = {}
    category_images: dict[str, int] = defaultdict(int)
    category_objects: dict[str, int] = defaultdict(int)

    for analysis in analyses:
        seen_names = set()
        for colour in analysis.get("palette") or []:
            name, share, hex_ = colour.get("name"), float(colour.get("share") or 0), colour.get("hex")
            if not name or not hex_ or share <= 0:
                continue
            colour_share[name] += share
            if name not in seen_names:
                colour_images[name] += 1
                seen_names.add(name)
            if share > best_shade.get(name, (0.0, ""))[0]:
                best_shade[name] = (share, hex_)
        seen_categories = set()
        for found in analysis.get("objects") or []:
            category = found.get("category")
            if not category:
                continue
            category_objects[category] += 1
            if category not in seen_categories:
                category_images[category] += 1
                seen_categories.add(category)

    grand_total = sum(colour_share.values())
    ranked = sorted(colour_share, key=lambda name: (-colour_share[name], name))[:MAX_PROFILE_COLOURS]
    palette = [
        {"hex": best_shade[name][1], "name": name, "share": round(colour_share[name] / grand_total, 2), "images": colour_images[name]}
        for name in ranked
    ]
    categories = [
        {"category": category, "images": category_images[category], "objects": category_objects[category]}
        for category in sorted(category_images, key=lambda c: (-category_images[c], -category_objects[c], c))
    ]
    return {"analysed": len(analyses), "total": total, "palette": palette, "categories": categories}
