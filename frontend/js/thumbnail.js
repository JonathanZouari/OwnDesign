import { svg } from "./editor/render.js";
import { planBox } from "./plan.js";

const PAD = 0.08; // margin around the plan, as a share of its longer side

// A small read-only drawing of a plan (walls and furniture outlines), fitted to the plan's bounds.
export function planThumbnail(plan, label) {
  const bounds = planBox(plan);
  const pad = Math.max(bounds.w, bounds.h) * PAD;
  const viewBox = `${bounds.x - pad} ${bounds.y - pad} ${bounds.w + 2 * pad} ${bounds.h + 2 * pad}`;
  return svg(
    "svg",
    { viewBox, role: "img", "aria-label": label, class: "thumb" },
    plan.furniture.map((item) =>
      svg("rect", {
        x: item.x - item.w / 2,
        y: item.y - item.d / 2,
        width: item.w,
        height: item.d,
        transform: `rotate(${item.rotation ?? 0} ${item.x} ${item.y})`,
        class: "item",
      }),
    ),
    plan.walls.map((wall) =>
      svg("line", { x1: wall.x1, y1: wall.y1, x2: wall.x2, y2: wall.y2, "stroke-width": wall.thickness, class: `wall ${wall.kind}` }),
    ),
    // A saved plan with nothing drawn yet would otherwise be an unexplained blank tile.
    plan.walls.length + plan.furniture.length === 0 &&
      svg("text", { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2, "text-anchor": "middle" }, "Blank canvas"),
  );
}
