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

# Rough placeholder estimates (USD), NOT supplier prices: a starting point the user edits (PRD FR-10, MVP-06).
# Furniture: per item. Materials: per square metre. The source of real benchmarks is an open PRD decision (12).
FURNITURE_PRICES_USD = {
    "sofa": 900, "armchair": 350, "coffee-table": 200, "tv-unit": 300, "dining-table": 500, "chair": 90,
    "double-bed": 700, "single-bed": 350, "wardrobe": 600, "desk": 250,
    "kitchen-counter": 2500, "kitchen-island": 2000, "sink": 250, "stove": 500, "fridge": 800,
    "toilet": 250, "bathtub": 700, "shower": 600, "vanity": 400,
}
MATERIAL_PRICES_USD = {
    "oak-floor": 70, "walnut-floor": 95, "polished-concrete": 60, "porcelain-stone": 45, "terracotta-tile": 50,
    "white-paint": 8, "sage-paint": 9, "navy-paint": 9, "lime-plaster": 25, "black-metal": 120,
}
# Very rough multipliers so the defaults land in the project's currency; the user still edits every price.
CURRENCY_FACTOR = {"USD": 1.0, "EUR": 0.9, "GBP": 0.8, "ILS": 3.6}
WALL_HEIGHT_M = 2.5
CABINET_M2 = 3.0  # starting quantity for a cabinets surface; there is no geometry to measure
