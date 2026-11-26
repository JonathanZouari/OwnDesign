// Pure logic for "How we move": turns per-frame person detections into one walking path.
// No DOM here, so it runs under node --test.

export const MAX_POINTS = 600; // the API's limit
const MIN_SCORE = 0.5; // detections below this are noise
const MAX_JUMP = 0.25; // a step longer than a quarter of the frame between samples is another person or a false hit
const MIN_STEP = 0.005; // points closer than this add nothing to the drawing

const round = (value) => Math.round(value * 10000) / 10000;

// The point on the floor under a person: the middle of the bottom edge of their box ([x, y, w, h] in pixels).
export const footPoint = ([x, y, w, h], width, height) => [
  Math.min(1, Math.max(0, (x + w / 2) / width)),
  Math.min(1, Math.max(0, (y + h) / height)),
];

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * frames: one array of detections per sampled frame, each { class, score, bbox: [x, y, w, h] }.
 * Returns [[x, y], ...] in frame fractions (0..1), in walking order.
 * One person is followed: in each frame, the person closest to the last point (the most confident one at the start).
 */
export function buildPath(frames, width, height) {
  const path = [];
  for (const detections of frames) {
    const people = detections
      .filter((d) => d.class === "person" && d.score >= MIN_SCORE)
      .map((d) => ({ score: d.score, point: footPoint(d.bbox, width, height) }));
    if (!people.length) continue;
    const last = path.at(-1);
    const pick = last
      ? people.reduce((best, p) => (distance(p.point, last) < distance(best.point, last) ? p : best))
      : people.reduce((best, p) => (p.score > best.score ? p : best));
    if (last && distance(pick.point, last) > MAX_JUMP) continue;
    if (last && distance(pick.point, last) < MIN_STEP) continue;
    path.push(pick.point.map(round));
  }
  return thin(path, MAX_POINTS);
}

// Keeps at most `max` points, evenly spread, always keeping the first and the last.
export function thin(points, max) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}

// The highest person score in a frame; the background frame is the one where nobody is clearly visible.
export const personScore = (detections) =>
  Math.max(0, ...detections.filter((d) => d.class === "person").map((d) => d.score));

// SVG polyline "points" attribute for a path drawn in a viewBox of width x height.
export const polylinePoints = (points, width, height) => points.map(([x, y]) => `${round(x * width)},${round(y * height)}`).join(" ");

// ---- YOLOv8 ----------------------------------------------------------------------------------------
// The model takes a 640x640 picture. The frame is scaled to fit and padded (letterbox), then decoded back.
export const YOLO_SIZE = 640;
const PERSON = 0; // COCO class 0
const IOU_LIMIT = 0.45;

export function letterbox(width, height, size = YOLO_SIZE) {
  const scale = Math.min(size / width, size / height);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  return { scale, w, h, padX: Math.floor((size - w) / 2), padY: Math.floor((size - h) / 2) };
}

// RGBA pixels of the size x size letterboxed picture -> Float32 planar RGB in 0..1 (the model's NCHW input).
export function toTensorData(rgba, size = YOLO_SIZE) {
  const area = size * size;
  const data = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    data[i] = rgba[i * 4] / 255;
    data[area + i] = rgba[i * 4 + 1] / 255;
    data[2 * area + i] = rgba[i * 4 + 2] / 255;
  }
  return data;
}

const iou = (a, b) => {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a[2] * a[3] + b[2] * b[3] - inter || 1);
};

/**
 * output: the model's Float32 output [1, 84, n] flattened (rows: cx, cy, w, h, then 80 class scores).
 * Returns person detections { class, score, bbox: [x, y, w, h] } in the original frame's pixels,
 * after non-maximum suppression, so one person gives one box.
 */
export function decodeYolo(output, n, box, minScore = 0.5) {
  const found = [];
  for (let i = 0; i < n; i++) {
    const score = output[(4 + PERSON) * n + i];
    if (score < minScore) continue;
    const [cx, cy, w, h] = [0, 1, 2, 3].map((row) => output[row * n + i]);
    found.push({
      class: "person",
      score,
      bbox: [(cx - w / 2 - box.padX) / box.scale, (cy - h / 2 - box.padY) / box.scale, w / box.scale, h / box.scale],
    });
  }
  found.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const candidate of found) if (kept.every((k) => iou(k.bbox, candidate.bbox) < IOU_LIMIT)) kept.push(candidate);
  return kept;
}
