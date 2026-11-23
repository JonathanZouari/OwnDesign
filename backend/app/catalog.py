"""Design styles and finish materials: the single source of truth for validation and for GET /v1/catalog."""

SURFACES = ("floor", "walls", "ceiling", "cabinets")

STYLES = [
    {"id": "modern", "label": "Modern", "description": "Clean lines, neutral palette, little ornament."},
    {"id": "scandinavian", "label": "Scandinavian", "description": "Light woods, white walls, cosy textiles."},
    {"id": "industrial", "label": "Industrial", "description": "Raw concrete, black metal, exposed texture."},
    {"id": "mid-century", "label": "Mid-century", "description": "Warm teak, tapered legs, bold accents."},
    {"id": "japandi", "label": "Japandi", "description": "Calm minimalism with natural, handmade materials."},
    {"id": "classic", "label": "Classic", "description": "Symmetry, mouldings and timeless furniture."},
    {"id": "mediterranean", "label": "Mediterranean", "description": "Terracotta, lime plaster and sunlit tones."},
    {"id": "bohemian", "label": "Bohemian", "description": "Layered patterns, plants and collected pieces."},
]

# `surfaces`: where the material can be applied. `color`: swatch shown in the UI.
MATERIALS = [
    {"id": "oak-floor", "label": "Natural oak", "surfaces": ["floor", "cabinets"], "color": "#c9a46b"},
    {"id": "walnut-floor", "label": "Walnut", "surfaces": ["floor", "cabinets"], "color": "#6b4a32"},
    {"id": "polished-concrete", "label": "Polished concrete", "surfaces": ["floor", "walls"], "color": "#9a9a97"},
    {"id": "porcelain-stone", "label": "Stone-look porcelain", "surfaces": ["floor", "walls"], "color": "#b8b2a7"},
    {"id": "terracotta-tile", "label": "Terracotta tile", "surfaces": ["floor", "walls"], "color": "#b9573a"},
    {"id": "white-paint", "label": "Warm white paint", "surfaces": ["walls", "ceiling", "cabinets"], "color": "#f3efe6"},
    {"id": "sage-paint", "label": "Sage green paint", "surfaces": ["walls", "cabinets"], "color": "#9caf88"},
    {"id": "navy-paint", "label": "Deep navy paint", "surfaces": ["walls", "cabinets"], "color": "#26364f"},
    {"id": "lime-plaster", "label": "Lime plaster", "surfaces": ["walls"], "color": "#e4dccb"},
    {"id": "black-metal", "label": "Black metal", "surfaces": ["cabinets"], "color": "#2b2b2b"},
]

STYLE_IDS = frozenset(style["id"] for style in STYLES)
MATERIALS_BY_ID = {material["id"]: material for material in MATERIALS}
