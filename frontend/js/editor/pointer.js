// Mouse, pen and touch interaction on the canvas: select, drag, draw walls, place openings and
// furniture, pan, two-finger pan with pinch zoom, wheel zoom. Every edit goes through the pure functions in plan.js.
import { FURNITURE_BY_TYPE } from "../catalog.js";
import * as P from "../plan.js";
import { visibleArea } from "./render.js";

const AXIS_LOCK = 15; // cm: a nearly straight wall snaps to exactly horizontal or vertical
const WALL_REACH_PX = 24; // how close a click must be to a wall to drop a door or window on it
const MIN_VIEW = 150;
const MAX_VIEW = 30_000;

export const zoomAt = (view, point, factor) => {
  const w = Math.min(Math.max(view.w * factor, MIN_VIEW), MAX_VIEW);
  const applied = w / view.w;
  return { x: point.x - (point.x - view.x) * applied, y: point.y - (point.y - view.y) * applied, w, h: view.h * applied };
};

// A pinch zooms around the point first held, then follows the fingers. `shift` is how far their midpoint
// moved, in plan units of the starting view.
export const pinchView = (view, centre, factor, shift) => {
  const next = zoomAt(view, centre, factor);
  const applied = next.w / view.w;
  return { ...next, x: next.x - shift.x * applied, y: next.y - shift.y * applied };
};

const axisLock = (from, to) => ({
  x: Math.abs(to.x - from.x) < AXIS_LOCK ? from.x : to.x,
  y: Math.abs(to.y - from.y) < AXIS_LOCK ? from.y : to.y,
});

export function attachPointer(canvas, editor) {
  const pointers = new Map(); // active touches, for pinch zoom
  let drag = null;
  let pinch = null;

  const toPlan = (event, inverse = canvas.getScreenCTM().inverse()) =>
    new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
  const snapped = (point) => ({ x: P.snap(point.x), y: P.snap(point.y) });
  const midpoint = ([a, b]) => ({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 });

  function place(point) {
    const { tool, plan } = editor;
    if (tool === "door" || tool === "window") {
      const hit = P.nearestWall(plan, point, WALL_REACH_PX * visibleArea(canvas).scale);
      if (!hit) return editor.toast("Click on a wall to place it there.");
      const next = P.addOpening(plan, hit.wall.id, tool, hit.along);
      editor.commit(next, { kind: "openings", id: next.openings.at(-1).id });
    } else {
      const next = P.addFurniture(plan, FURNITURE_BY_TYPE.get(tool.slice("furniture:".length)), point.x, point.y);
      editor.commit(next, { kind: "furniture", id: next.furniture.at(-1).id });
    }
    editor.setTool("select");
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button > 1) return;
    // The drawing is rebuilt during this handler, so let the canvas own focus instead of a node about to be replaced.
    event.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, event);
    if (pointers.size > 2) return; // extra fingers during a pinch are ignored
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const inverse = canvas.getScreenCTM().inverse();
      const centre = toPlan(midpoint([a, b]), inverse);
      pinch = { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), view: editor.view, centre, inverse };
      editor.preview(null);
      editor.setPreviewLine(null);
      drag = null;
      return;
    }
    const inverse = canvas.getScreenCTM().inverse();
    const point = toPlan(event, inverse);
    const target = event.target.closest("[data-kind]");
    const { tool } = editor;

    if (event.button === 1 || (tool === "select" && !target)) {
      if (!target) editor.select(null);
      drag = { type: "pan", inverse, start: point, view: editor.view };
    } else if (tool === "select") {
      const { kind, id, end } = target.dataset;
      if (kind === "handle") {
        drag = { type: "end", id: editor.selection.id, end: Number(end), origin: editor.plan };
      } else {
        editor.select({ kind, id });
        drag = { type: "move", kind, id, start: point, origin: editor.plan };
      }
    } else if (tool === "exterior" || tool === "partition") {
      drag = { type: "draw", kind: tool, start: snapped(point) };
    } else {
      drag = { type: "place", start: point }; // placed on lift, so the first finger of a pinch places nothing
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, event);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (distance > 0) {
        const now = toPlan(midpoint([a, b]), pinch.inverse);
        const shift = { x: now.x - pinch.centre.x, y: now.y - pinch.centre.y };
        editor.setView(pinchView(pinch.view, pinch.centre, pinch.distance / distance, shift));
      }
      return;
    }
    if (!drag || drag.type === "place") return;
    if (drag.type === "pan") {
      const now = toPlan(event, drag.inverse);
      editor.setView({ ...drag.view, x: drag.view.x - (now.x - drag.start.x), y: drag.view.y - (now.y - drag.start.y) });
      return;
    }
    const point = toPlan(event);
    if (drag.type === "draw") {
      const end = axisLock(drag.start, snapped(point));
      drag.end = end;
      editor.setPreviewLine({ x1: drag.start.x, y1: drag.start.y, x2: end.x, y2: end.y });
    } else if (drag.type === "end") {
      const wall = drag.origin.walls.find((candidate) => candidate.id === drag.id);
      const fixed = drag.end === 1 ? { x: wall.x2, y: wall.y2 } : { x: wall.x1, y: wall.y1 };
      const to = axisLock(fixed, snapped(point));
      editor.preview(P.moveWallEnd(drag.origin, drag.id, drag.end, to.x, to.y));
    } else if (drag.kind === "openings") {
      const opening = drag.origin.openings.find((candidate) => candidate.id === drag.id);
      const wall = drag.origin.walls.find((candidate) => candidate.id === opening.wallId);
      const offset = P.snap(P.projectOnWall(wall, point).along - opening.width / 2);
      editor.preview(P.patch(drag.origin, "openings", drag.id, { offset }));
    } else {
      editor.preview(P.translate(drag.origin, drag.kind, drag.id, P.snap(point.x - drag.start.x), P.snap(point.y - drag.start.y)));
    }
  });

  function finish(event, cancelled) {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!drag) return;
    const finished = drag;
    drag = null;
    if (finished.type === "place") {
      if (!cancelled) place(finished.start);
    } else if (finished.type === "draw") {
      editor.setPreviewLine(null);
      if (cancelled || !finished.end) return;
      const next = P.addWall(editor.plan, finished.start, finished.end, finished.kind);
      if (next !== editor.plan) editor.commit(next, { kind: "walls", id: next.walls.at(-1).id });
    } else if (finished.type !== "pan") {
      if (cancelled) editor.preview(null);
      else editor.commitPreview();
    }
  }
  canvas.addEventListener("pointerup", (event) => finish(event, false));
  canvas.addEventListener("pointercancel", (event) => finish(event, true));

  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (event.deltaY === 0) return; // sideways trackpad swipe
      editor.setView(zoomAt(editor.view, toPlan(event), event.deltaY > 0 ? 1.12 : 1 / 1.12));
    },
    { passive: false },
  );
}
