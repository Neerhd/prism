/**
 * MediaPipe HandLandmarker initialisation.
 *
 * Uses the Tasks Vision API (not the deprecated @mediapipe/hands package).
 * The landmarker is initialised once and cached — subsequent calls to
 * initHandLandmarker() return the same instance.
 *
 * Important: HAND_CONNECTIONS is a static property on the HandLandmarker
 * class itself, not a named export. Access it as HandLandmarker.HAND_CONNECTIONS.
 * Each connection is { start: number, end: number }, not a tuple.
 */

import {
  HandLandmarker,
  FilesetResolver,
  type HandLandmarkerResult,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

export type { HandLandmarkerResult, NormalizedLandmark };

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";

let landmarker: HandLandmarker | null = null;
let initPromise: Promise<HandLandmarker> | null = null;

/**
 * Initialise (or return the cached) HandLandmarker.
 * Safe to call multiple times — the model is only downloaded once.
 */
export async function initHandLandmarker(): Promise<HandLandmarker> {
  if (landmarker)   return landmarker;
  if (initPromise)  return initPromise;

  initPromise = (async () => {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "GPU",
      },
      numHands: 1,
      runningMode: "VIDEO",
    });
    return landmarker;
  })();

  return initPromise;
}
