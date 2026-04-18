/**
 * Dominant-color sampler.
 *
 * Rather than averaging all pixels in a patch (which muddies mixed regions),
 * we quantise every pixel into coarse RGB buckets, find the most-populated
 * bucket, and return the mean of only those pixels. Pointing at a green sofa
 * with a white cushion nearby returns the dominant green, not a washed-out mix.
 *
 * Mirror note:
 *   The <video> element is visually flipped via CSS `scaleX(-1)`, but the
 *   underlying pixel data is not. Landmark x is in raw (unmirrored) frame
 *   coordinates, so pixel coordinates map directly:
 *     pixelX = landmark.x * videoWidth
 *     pixelY = landmark.y * videoHeight
 */

// Single reusable offscreen canvas — allocated once, resized as needed.
let offscreen: HTMLCanvasElement | null = null;
let offCtx: CanvasRenderingContext2D | null = null;

function getOffscreen(width: number, height: number): CanvasRenderingContext2D {
  if (!offscreen) offscreen = document.createElement("canvas");
  if (offscreen.width  !== width)  offscreen.width  = width;
  if (offscreen.height !== height) offscreen.height = height;
  if (!offCtx) offCtx = offscreen.getContext("2d", { willReadFrequently: true })!;
  return offCtx;
}

/**
 * Returns the dominant RGB color in a square patch centred on (x, y).
 *
 * @param videoEl    The source <video> element.
 * @param x          Pixel x in raw (unmirrored) frame coordinates.
 * @param y          Pixel y in raw frame coordinates.
 * @param size       Side length of the sampling patch in pixels (default 60).
 * @param bucketStep Quantisation step per channel (default 32 = 8 levels).
 *                   Smaller = finer buckets, more sensitive to variation.
 *                   Larger  = coarser buckets, more forgiving of texture/noise.
 */
export function sampleColorAt(
  videoEl: HTMLVideoElement,
  x: number,
  y: number,
  size = 60,
  bucketStep = 32,
): { r: number; g: number; b: number } {
  const w = videoEl.videoWidth;
  const h = videoEl.videoHeight;
  if (!w || !h) return { r: 0, g: 0, b: 0 };

  const ctx = getOffscreen(w, h);
  ctx.drawImage(videoEl, 0, 0, w, h);

  // Clamp patch to frame bounds
  const half = Math.floor(size / 2);
  const sx = Math.max(0, Math.min(w - size, Math.round(x) - half));
  const sy = Math.max(0, Math.min(h - size, Math.round(y) - half));

  const { data: pixels } = ctx.getImageData(sx, sy, size, size); // RGBA

  // Accumulate pixel counts and channel sums per quantised bucket
  const buckets = new Map<number, { count: number; rSum: number; gSum: number; bSum: number }>();

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];

    // Floor each channel to the nearest bucketStep boundary
    const qr = Math.floor(r / bucketStep) * bucketStep;
    const qg = Math.floor(g / bucketStep) * bucketStep;
    const qb = Math.floor(b / bucketStep) * bucketStep;

    // Pack the three quantised values into a single integer key
    const key = (qr << 16) | (qg << 8) | qb;

    const entry = buckets.get(key);
    if (entry) {
      entry.count++;
      entry.rSum += r;
      entry.gSum += g;
      entry.bSum += b;
    } else {
      buckets.set(key, { count: 1, rSum: r, gSum: g, bSum: b });
    }
  }

  // Find the bucket with the most votes
  let best = { count: 0, rSum: 0, gSum: 0, bSum: 0 };
  for (const bucket of buckets.values()) {
    if (bucket.count > best.count) best = bucket;
  }

  return {
    r: best.rSum / best.count,
    g: best.gSum / best.count,
    b: best.bSum / best.count,
  };
}
