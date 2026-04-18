/**
 * Color conversion utilities.
 * All functions are pure — no side-effects, no DOM access.
 */

/** Convert HSV (h: 0–360, s: 0–1, v: 0–1) to RGB (0–255 per channel). */
export function hsvToRgb(
  h: number,
  s: number,
  v: number,
): { r: number; g: number; b: number } {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0, g = 0, b = 0;
  if      (h < 60)  { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/** Convert RGB (0–255 per channel) to HSV (h: 0–360, s: 0–1, v: 0–1). */
export function rgbToHsv(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; v: number } {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d   = max - min;

  let h = 0;
  if (d !== 0) {
    if      (max === rn) h = ((gn - bn) / d + 6) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else                 h = (rn - gn) / d + 4;
    h *= 60;
  }

  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** Convert RGB (0–255 per channel) to a hex string, e.g. "#FF6B35". */
export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b]
    .map((c) => Math.round(c).toString(16).padStart(2, "0").toUpperCase())
    .join("");
}

/** Convert HSV (h: 0–360, s: 0–1, v: 0–1) to a hex string, e.g. "#FF6B35". */
export function hsvToHex(h: number, s: number, v: number): string {
  const { r, g, b } = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}
