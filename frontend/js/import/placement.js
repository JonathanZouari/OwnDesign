// Pure helpers for placing the imported drawing under the walls (all lengths in cm). No DOM.
// Walls from walls.js are in "plan cm": page cm minus originCm. Recalibrating multiplies every
// coordinate by `factor` (see rescale), so the page image has to be moved and scaled the same way.

const round1 = (v) => Math.round(v * 10) / 10;

// Where the page image sits in plan cm. `page` is { width, height } in PDF units, `cmPerUnit` the scale
// used for detection, `originCm` the detection's origin, `factor` the calibration multiplier (1 = none).
export function imagePlacement(page, cmPerUnit, originCm, factor = 1) {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const k = cmPerUnit * f;
  return {
    x: round1(-(originCm?.x ?? 0) * f),
    y: round1(-(originCm?.y ?? 0) * f),
    width: round1(page.width * k),
    height: round1(page.height * k),
  };
}

// The multiplier that turns a measured distance into the real one. `distanceCm` is what two clicked
// points measure now, `realCm` what the user says it really is. Returns null for unusable input.
export function calibrationFactor(distanceCm, realCm) {
  if (!(distanceCm > 0) || !(realCm > 0) || !Number.isFinite(distanceCm) || !Number.isFinite(realCm)) return null;
  const factor = realCm / distanceCm;
  return factor >= 0.01 && factor <= 100 ? factor : null;
}

// Parses "4.5", "4,5" or "450" with a unit ("m" | "cm") into cm; null when it is not a positive number.
export function parseLength(text, unit) {
  const value = Number(String(text ?? "").trim().replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  return unit === "m" ? value * 100 : value;
}
