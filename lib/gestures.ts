/**
 * Pure gesture functions — no side-effects, no DOM access.
 * All functions operate on a MediaPipe NormalizedLandmark array (21 points).
 *
 * Landmark indices used:
 *   0  wrist
 *   4  thumb tip
 *   8  index finger tip
 *   9  middle finger MCP (base)
 *   12 middle finger tip
 *   13 ring finger MCP
 *   17 pinky MCP
 *   5, 9, 13, 17  finger MCPs (for fist detection)
 */

import type { NormalizedLandmark } from "./handTracker";

/** Euclidean distance between two landmarks in normalised screen space. */
function dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * Normalised distance between the index fingertip (8) and thumb tip (4).
 * Divided by the wrist→middle-MCP span so the value is scale-independent.
 */
export function pinchDistance(landmarks: NormalizedLandmark[]): number {
  const handSize = dist(landmarks[0], landmarks[9]);
  if (handSize === 0) return 1;
  return dist(landmarks[4], landmarks[8]) / handSize;
}

/**
 * Hysteretic index-thumb pinch.
 * Enters pinch when distance < 0.12, exits when distance > 0.50.
 * The wide dead-zone prevents flickering near a single threshold.
 */
export function isPinching(
  landmarks: NormalizedLandmark[],
  currentlyPinching: boolean,
): boolean {
  const d = pinchDistance(landmarks);
  return currentlyPinching ? d <= 0.50 : d < 0.12;
}

/**
 * Normalised distance between the middle fingertip (12) and thumb tip (4).
 * Using the middle finger instead of index makes the gesture more deliberate —
 * the index can stay extended for pointing without accidentally triggering.
 */
export function middleThumbPinch(landmarks: NormalizedLandmark[]): number {
  const handSize = dist(landmarks[0], landmarks[9]);
  if (handSize === 0) return 1;
  return dist(landmarks[4], landmarks[12]) / handSize;
}

/**
 * Hysteretic middle-finger + thumb pinch.
 * Enters when distance < 0.18, exits when distance > 0.45.
 */
export function isMiddleThumbPinching(
  landmarks: NormalizedLandmark[],
  currentlyPinching: boolean,
): boolean {
  const d = middleThumbPinch(landmarks);
  return currentlyPinching ? d <= 0.45 : d < 0.18;
}

/**
 * Clockwise angle (0–360°) of the vector from wrist (0) to middle-MCP (9).
 * Used to detect hand rotation for the brightness control stage.
 * The y-axis is inverted because screen coordinates increase downward.
 */
export function handRotation(landmarks: NormalizedLandmark[]): number {
  const wrist = landmarks[0];
  const mid   = landmarks[9];
  const angle = Math.atan2(-(mid.y - wrist.y), mid.x - wrist.x);
  return ((angle * 180) / Math.PI + 360) % 360;
}

/**
 * Returns true when all four non-thumb fingers are curled into a fist.
 * Detection: each fingertip is closer to the wrist than its MCP joint,
 * meaning the finger has folded inward.
 * Hysteretic: requires 4 curled fingers to enter, 3 to stay in fist state.
 */
export function isFist(
  landmarks: NormalizedLandmark[],
  currentlyFisting: boolean,
): boolean {
  const wrist = landmarks[0];
  const fingers = [
    { tip: landmarks[8],  mcp: landmarks[5] },   // index
    { tip: landmarks[12], mcp: landmarks[9] },   // middle
    { tip: landmarks[16], mcp: landmarks[13] },  // ring
    { tip: landmarks[20], mcp: landmarks[17] },  // pinky
  ];
  const curledCount = fingers.filter(
    ({ tip, mcp }) => dist(tip, wrist) < dist(mcp, wrist) * 1.1
  ).length;
  return currentlyFisting ? curledCount >= 3 : curledCount >= 4;
}
