"""Design styles and finish materials: the single source of truth for validation and for GET /v1/catalog."""

SURFACES = ("floor", "walls", "ceiling", "cabinets")

STYLES = [
    {"id": "modern", "label": "מודרני", "description": "קווים נקיים, צבעים ניטרליים ומעט קישוטים."},
    {"id": "scandinavian", "label": "סקנדינבי", "description": "עצים בהירים, קירות לבנים וטקסטיל נעים."},
    {"id": "industrial", "label": "תעשייתי", "description": "בטון חשוף, מתכת שחורה ומרקמים גלויים."},
    {"id": "mid-century", "label": "אמצע המאה", "description": "עץ טיק חם, רגליים מחודדות והדגשים נועזים."},
    {"id": "japandi", "label": "ג׳פנדי", "description": "מינימליזם רגוע עם חומרים טבעיים בעבודת יד."},
    {"id": "classic", "label": "קלאסי", "description": "סימטריה, קרניזים ורהיטים על־זמניים."},
    {"id": "mediterranean", "label": "ים־תיכוני", "description": "טרקוטה, טיח סיד וגוונים שטופי שמש."},
    {"id": "bohemian", "label": "בוהמייני", "description": "שכבות של דוגמאות, צמחים ופריטים שנאספו עם הזמן."},
]

# `surfaces`: where the material can be applied. `color`: swatch shown in the UI.
MATERIALS = [
    {"id": "oak-floor", "label": "אלון טבעי", "surfaces": ["floor", "cabinets"], "color": "#c9a46b"},
    {"id": "walnut-floor", "label": "אגוז", "surfaces": ["floor", "cabinets"], "color": "#6b4a32"},
    {"id": "polished-concrete", "label": "בטון מוחלק", "surfaces": ["floor", "walls"], "color": "#9a9a97"},
    {"id": "porcelain-stone", "label": "גרניט פורצלן דמוי אבן", "surfaces": ["floor", "walls"], "color": "#b8b2a7"},
    {"id": "terracotta-tile", "label": "אריחי טרקוטה", "surfaces": ["floor", "walls"], "color": "#b9573a"},
    {"id": "white-paint", "label": "צבע לבן חם", "surfaces": ["walls", "ceiling", "cabinets"], "color": "#f3efe6"},
    {"id": "sage-paint", "label": "צבע ירוק מרווה", "surfaces": ["walls", "cabinets"], "color": "#9caf88"},
    {"id": "navy-paint", "label": "צבע כחול נייבי עמוק", "surfaces": ["walls", "cabinets"], "color": "#26364f"},
    {"id": "lime-plaster", "label": "טיח סיד", "surfaces": ["walls"], "color": "#e4dccb"},
    {"id": "black-metal", "label": "מתכת שחורה", "surfaces": ["cabinets"], "color": "#2b2b2b"},
]

STYLE_IDS = frozenset(style["id"] for style in STYLES)
MATERIALS_BY_ID = {material["id"]: material for material in MATERIALS}
