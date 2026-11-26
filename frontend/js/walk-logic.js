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
