// Mock catalog (catalog_mvp.md §10). Pages reach products only through this module and shop-logic.js,
// so an API can replace it later.
export const CATEGORIES = [
  { id: "furniture", name: "Furniture" },
  { id: "lighting", name: "Lighting" },
  { id: "bathroom", name: "Bathroom" },
  { id: "decor", name: "Decor & Accessories" },
];

const box = (width, height, depth) => ({ width, height, depth });
const round = (diameter, height) => ({ diameter, height });
const size = (name, price, dimensions) => ({ id: name.toLowerCase().replaceAll(" ", "-"), name, price, dimensions });
const one = (price, dimensions) => [size("Standard", price, dimensions)];
const product = (id, name, category, image, description, colors, sizes) =>
  ({ id, name, category, image: `img/products/${image}.svg`, description, colors, sizes });

export const PRODUCTS = [
  product("FUR-001", "Modern Sofa", "furniture", "sofa", "Contemporary sofa with deep seats", ["Beige", "Brown", "Black", "Red"], [size("2-seater", 4000, box(180, 85, 90)), size("3-seater", 4500, box(220, 85, 95))]),
  product("FUR-002", "Lounge Armchair", "furniture", "armchair", "Curved armchair for reading corners", ["Beige", "Green", "Black"], one(1600, box(82, 80, 85))),
  product("FUR-003", "Oak Dining Table", "furniture", "table", "Solid-top table for everyday meals", ["Natural", "Walnut"], [size("4 seats", 2200, box(140, 75, 80)), size("8 seats", 3400, box(220, 75, 100))]),
  product("FUR-004", "Dining Chair", "furniture", "chair", "Light chair with a shaped back", ["Natural", "Black", "White"], one(420, box(46, 82, 50))),
  product("FUR-005", "Platform Bed", "furniture", "bed", "Low bed with an upholstered headboard", ["Beige", "Gray"], [size("Queen", 3200, box(165, 100, 210)), size("King", 3900, box(190, 100, 210))]),
  product("FUR-006", "Storage Cabinet", "furniture", "cabinet", "Two-door cabinet with shelves", ["White", "Walnut"], one(1900, box(100, 120, 40))),
  product("LIG-001", "Dome Pendant", "lighting", "pendant", "Pendant light for tables and islands", ["Black", "Gold", "White"], [size("Small", 350, round(30, 25)), size("Large", 520, round(50, 40))]),
  product("LIG-002", "Arc Floor Lamp", "lighting", "floor-lamp", "Reaching floor lamp with a weighted base", ["Black", "Gold"], one(890, box(110, 190, 35))),
  product("LIG-003", "Ceramic Table Lamp", "lighting", "table-lamp", "Warm bedside light with a fabric shade", ["White", "Terracotta"], one(280, round(28, 45))),
  product("LIG-004", "Wall Sconce", "lighting", "wall-light", "Soft up-and-down wall light", ["Gold", "Black"], one(240, box(12, 30, 15))),
  product("LIG-005", "Flush Ceiling Light", "lighting", "ceiling-light", "Low-profile light for hallways", ["White"], [size("Small", 190, round(30, 10)), size("Large", 310, round(50, 12))]),
  product("LIG-006", "Paper Lantern Pendant", "lighting", "pendant", "Diffused light from a paper shade", [], one(160, round(45, 45))),
  product("BTH-001", "Basin Mixer", "bathroom", "faucet", "Single-lever basin faucet", ["Chrome", "Black", "Gold"], one(390, box(5, 18, 14))),
  product("BTH-002", "Countertop Sink", "bathroom", "sink", "Ceramic vessel basin", ["White", "Black"], [size("40 cm", 450, round(40, 14)), size("60 cm", 640, box(60, 14, 40))]),
  product("BTH-003", "Freestanding Bathtub", "bathroom", "bathtub", "Oval soaking tub", ["White"], [size("160 cm", 4200, box(160, 60, 75)), size("180 cm", 4900, box(180, 60, 80))]),
  product("BTH-004", "Wall Mirror", "bathroom", "mirror", "Framed mirror for vanities", ["Aluminum", "White", "Black"], [size("80x120 cm", 450, box(80, 120, 3)), size("100x150 cm", 600, box(100, 150, 3))]),
  product("BTH-005", "Rain Shower Set", "bathroom", "shower", "Overhead and hand shower", ["Chrome", "Black"], one(980, box(25, 120, 45))),
  product("BTH-006", "Round Backlit Mirror", "bathroom", "mirror", "Mirror with an integrated halo light", [], [size("60 cm", 520, round(60, 4)), size("80 cm", 690, round(80, 4))]),
  product("DEC-001", "Woven Rug", "decor", "rug", "Flat-weave rug with a soft texture", ["Beige", "Terracotta", "Gray"], [size("160x230 cm", 780, box(160, 1, 230)), size("200x300 cm", 1250, box(200, 1, 300))]),
  product("DEC-002", "Linen Cushion", "decor", "cushion", "Washed linen cushion with filling", ["Beige", "Green", "Terracotta"], one(90, box(45, 45, 12))),
  product("DEC-003", "Stoneware Vase", "decor", "vase", "Hand-finished vase", ["White", "Terracotta", "Black"], [size("Small", 120, round(15, 25)), size("Tall", 210, round(20, 45))]),
  product("DEC-004", "Abstract Print", "decor", "art", "Framed art print", [], [size("50x70 cm", 240, box(50, 70, 3)), size("70x100 cm", 380, box(70, 100, 3))]),
  product("DEC-005", "Round Wall Mirror", "decor", "mirror", "Decorative mirror for entryways", ["Gold", "Black"], one(340, round(70, 3))),
  product("DEC-006", "Wool Throw Rug", "decor", "rug", "Small accent rug", ["Natural"], one(320, box(90, 1, 150))),
];

export const COLORS = [...new Set(PRODUCTS.flatMap((p) => p.colors))].sort();
export const PRODUCT_BY_ID = new Map(PRODUCTS.map((p) => [p.id, p]));
