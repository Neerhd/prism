"use client";

/**
 * Prism — webcam-based color picker driven by hand gestures.
 *
 * Flow:
 *   1. Sampling  — point your index finger at any surface; the dominant color
 *                  in the region under your fingertip is sampled live.
 *   2. Brightness — after the first pinch, the hue is locked. Rotate your
 *                   hand to dial brightness up or down.
 *   3. Done      — a second pinch locks the final color. Copy the hex value.
 *                  A third pinch resets to sampling.
 *
 * Gesture: hold middle finger and thumb together for ~400 ms to advance.
 * The pinch requires a full release before it can fire again, preventing
 * accidental rapid transitions.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { HandLandmarker, HandLandmarkerResult } from "@mediapipe/tasks-vision";
import { initHandLandmarker } from "@/lib/handTracker";
import { isMiddleThumbPinching, handRotation } from "@/lib/gestures";
import { sampleColorAt } from "@/lib/colorSampler";
import { rgbToHsv, hsvToHex } from "@/lib/color";
import ColorWheel from "@/components/ColorWheel";

// ── Types ─────────────────────────────────────────────────────────────────────

type Stage = "sampling" | "brightness" | "done";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Pinch must be held this long (ms) before it registers as intentional. */
const PINCH_SUSTAIN_MS = 400;

/** Minimum gap (ms) between consecutive pinch events. */
const DEBOUNCE_MS = 800;

/** Degrees of hand rotation that map to the full 0–1 brightness range. */
const ROTATION_RANGE_DEG = 180;

// ── Component ─────────────────────────────────────────────────────────────────

export default function Home() {
  const videoRef      = useRef<HTMLVideoElement>(null);
  const canvasRef     = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const rafRef        = useRef<number>(0);

  // ── Sampling refs ──────────────────────────────────────────────────────────
  /** Exponentially-smoothed index-fingertip position (normalised 0–1). */
  const smoothedFingertipRef = useRef({ x: 0.5, y: 0.5 });
  /** Exponentially-smoothed sampled RGB. */
  const smoothedRgbRef = useRef({ r: 128, g: 128, b: 128 });

  // ── Locked color refs ──────────────────────────────────────────────────────
  const lockedHRef = useRef(0);   // hue locked on first pinch
  const lockedSRef = useRef(1);   // saturation locked on first pinch
  const lockedVRef = useRef(1);   // brightness locked on second pinch

  // ── Rotation / brightness refs ─────────────────────────────────────────────
  /** Cumulative rotation in degrees, accumulates across frames. */
  const cumulativeRotRef    = useRef(0);
  /** Previous raw angle — used to compute per-frame delta. */
  const prevRawRotRef       = useRef<number | null>(null);
  /** Low-pass filtered angle. */
  const smoothedRotRef      = useRef(0);
  /** Cumulative rotation at the moment brightness stage began. */
  const rotAnchorRef        = useRef(0);
  /** Brightness value at the moment brightness stage began. */
  const brightnessAnchorRef = useRef(1);
  /** Low-pass filtered brightness. */
  const smoothedBrightnessRef = useRef(1);

  // ── Stage ref (mirrored to React state for rendering) ─────────────────────
  const stageRef = useRef<Stage>("sampling");

  // ── Pinch tracking refs ────────────────────────────────────────────────────
  const currentPinchStateRef  = useRef(false);
  const pinchSustainRef       = useRef<number | null>(null);
  const lastPinchRef          = useRef(0);
  /**
   * Starts true so the first pinch only fires after the user has opened their
   * hand at least once. Prevents an accidental lock if fingers are already
   * close together when the hand first enters the frame.
   * Becomes false as soon as the pinch opens, then toggles normally thereafter.
   */
  const awaitingPinchReleaseRef = useRef(true);

  // ── React state (render only) ──────────────────────────────────────────────
  const [cameraError, setCameraError]   = useState<string | null>(null);
  const [trackerReady, setTrackerReady] = useState(false);
  const [handDetected, setHandDetected] = useState(false);
  const [displayHsv, setDisplayHsv]     = useState({ h: 0, s: 1, v: 1 });
  const [stage, setStage]               = useState<Stage>("sampling");
  const [copied, setCopied]             = useState(false);

  // ── Camera setup ───────────────────────────────────────────────────────────

  useEffect(() => {
    let stream: MediaStream | null = null;

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1280, height: 720, facingMode: "user" },
        });
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch (err) {
        if (err instanceof DOMException && err.name === "NotAllowedError")
          setCameraError("Camera access denied — allow camera permissions and reload.");
        else if (err instanceof DOMException && err.name === "NotFoundError")
          setCameraError("No camera found on this device.");
        else
          setCameraError("Could not start camera.");
      }
    }

    startCamera();
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  // ── MediaPipe initialisation ───────────────────────────────────────────────

  useEffect(() => {
    initHandLandmarker()
      .then((lm) => { landmarkerRef.current = lm; setTrackerReady(true); })
      .catch(() => setCameraError("Failed to load hand tracker model."));
  }, []);

  // ── Canvas overlay ─────────────────────────────────────────────────────────

  /**
   * Draws the hand skeleton and a cursor ring at the index fingertip.
   * Colour scheme changes with each stage so the user gets implicit feedback:
   *   sampling   → cyan
   *   brightness → purple
   *   done       → amber
   */
  const drawOverlay = useCallback((
    ctx: CanvasRenderingContext2D,
    result: HandLandmarkerResult,
    w: number,
    h: number,
    now: number,
    ftX: number,
    ftY: number,
    currentStage: Stage,
  ) => {
    ctx.clearRect(0, 0, w, h);
    if (!result.landmarks.length) return;

    // Draw cursor ring at fingertip — pulses gently during sampling
    const cx = ftX * w;
    const cy = ftY * h;
    const pulse  = currentStage === "sampling"
      ? 1 + 0.1 * Math.sin((now / 1000) * Math.PI * 2)
      : 1;
    const ringR  = 20 * pulse;
    const ringColor =
      currentStage === "sampling"   ? "rgba(255,255,255,0.5)" :
      currentStage === "brightness" ? "rgba(167,139,250,0.7)" :
      "rgba(252,211,77,0.7)";

    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, 2 * Math.PI);
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = currentStage === "sampling" ? 1.5 : 2;
    ctx.stroke();
  }, []);

  // ── Detection loop ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!trackerReady) return;
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function loop() {
      rafRef.current = requestAnimationFrame(loop);
      if (!video || video.readyState < 2) return;

      const w = video.videoWidth  || 1280;
      const h = video.videoHeight || 720;
      if (canvas!.width  !== w) canvas!.width  = w;
      if (canvas!.height !== h) canvas!.height = h;

      const now      = performance.now();
      const result   = landmarkerRef.current!.detectForVideo(video!, now);
      const curStage = stageRef.current;

      // No hand in frame — reset transient state and clear canvas
      if (!result.landmarks.length) {
        setHandDetected(false);
        ctx!.clearRect(0, 0, w, h);
        currentPinchStateRef.current      = false;
        pinchSustainRef.current           = null;
        awaitingPinchReleaseRef.current   = false;
        prevRawRotRef.current             = null;
        return;
      }

      setHandDetected(true);
      const lm = result.landmarks[0];

      // ── Smooth index fingertip (landmark 8) ──────────────────────────────
      smoothedFingertipRef.current = {
        x: smoothedFingertipRef.current.x * 0.8 + lm[8].x * 0.2,
        y: smoothedFingertipRef.current.y * 0.8 + lm[8].y * 0.2,
      };
      const { x: ftX, y: ftY } = smoothedFingertipRef.current;

      // ── Rotation accumulation (runs every frame, used in brightness stage) ─
      const rawRot = handRotation(lm);
      if (prevRawRotRef.current === null) {
        // First frame after hand appears — initialise without adding a delta
        smoothedRotRef.current = rawRot;
      } else {
        // Wraparound-aware low-pass on the raw angle
        let delta = rawRot - smoothedRotRef.current;
        if (delta >  180) delta -= 360;
        if (delta < -180) delta += 360;
        const newSmoothed = (smoothedRotRef.current + delta * 0.2 + 360) % 360;

        // Accumulate the smoothed delta into cumulative tracker
        let cDelta = newSmoothed - smoothedRotRef.current;
        if (cDelta >  180) cDelta -= 360;
        if (cDelta < -180) cDelta += 360;
        cumulativeRotRef.current += cDelta;
        smoothedRotRef.current    = newSmoothed;
      }
      prevRawRotRef.current = rawRot;

      // ── Compute display HSV per stage ────────────────────────────────────
      let displayH = lockedHRef.current;
      let displayS = lockedSRef.current;
      let displayV = lockedVRef.current;

      if (curStage === "sampling") {
        // Sample dominant color under fingertip and smooth it
        const raw  = sampleColorAt(video!, ftX * w, ftY * h);
        const prev = smoothedRgbRef.current;
        const sRgb = {
          r: prev.r * 0.85 + raw.r * 0.15,
          g: prev.g * 0.85 + raw.g * 0.15,
          b: prev.b * 0.85 + raw.b * 0.15,
        };
        smoothedRgbRef.current = sRgb;
        const hsv = rgbToHsv(sRgb.r, sRgb.g, sRgb.b);
        displayH = hsv.h; displayS = hsv.s; displayV = hsv.v;
      } else if (curStage === "brightness") {
        // Map cumulative rotation delta to a brightness offset from the anchor
        const rawV = Math.max(0.05, Math.min(1,
          brightnessAnchorRef.current +
          (cumulativeRotRef.current - rotAnchorRef.current) / ROTATION_RANGE_DEG
        ));
        smoothedBrightnessRef.current = smoothedBrightnessRef.current * 0.7 + rawV * 0.3;
        displayH = lockedHRef.current;
        displayS = 1;
        displayV = smoothedBrightnessRef.current;
      }
      // "done": refs already hold the locked values, nothing to recompute

      setDisplayHsv({ h: displayH, s: displayS, v: displayV });
      drawOverlay(ctx!, result, w, h, now, ftX, ftY, curStage);

      // ── Pinch detection ───────────────────────────────────────────────────

      const newPinch = isMiddleThumbPinching(lm, currentPinchStateRef.current);
      currentPinchStateRef.current = newPinch;

      // If we're waiting for a release, unblock as soon as the pinch opens
      if (awaitingPinchReleaseRef.current) {
        if (!newPinch) awaitingPinchReleaseRef.current = false;
        return; // don't start a new sustain until released
      }

      // Track how long the pinch has been continuously held
      if (newPinch) {
        if (pinchSustainRef.current === null) pinchSustainRef.current = now;
      } else {
        pinchSustainRef.current = null;
      }

      const pinchReady =
        newPinch &&
        pinchSustainRef.current !== null &&
        now - pinchSustainRef.current >= PINCH_SUSTAIN_MS &&
        now - lastPinchRef.current    >  DEBOUNCE_MS;

      if (!pinchReady) return;

      // ── Advance stage ─────────────────────────────────────────────────────
      lastPinchRef.current          = now;
      pinchSustainRef.current       = null;
      awaitingPinchReleaseRef.current = true; // block until user releases

      if (curStage === "sampling") {
        // Lock hue & saturation from current sampled color
        const { h: lh, s: ls, v: lv } = rgbToHsv(
          smoothedRgbRef.current.r,
          smoothedRgbRef.current.g,
          smoothedRgbRef.current.b,
        );
        lockedHRef.current            = lh;
        lockedSRef.current            = ls;
        brightnessAnchorRef.current   = lv;
        smoothedBrightnessRef.current = lv;
        rotAnchorRef.current          = cumulativeRotRef.current;
        stageRef.current = "brightness";
        setStage("brightness");

      } else if (curStage === "brightness") {
        // Lock brightness
        lockedVRef.current = smoothedBrightnessRef.current;
        stageRef.current = "done";
        setStage("done");

      } else {
        // Reset to sampling
        stageRef.current              = "sampling";
        smoothedBrightnessRef.current = 1;
        prevRawRotRef.current         = null;
        setStage("sampling");
      }
    }

    loop();
    return () => cancelAnimationFrame(rafRef.current);
  }, [trackerReady, drawOverlay]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const hex = hsvToHex(displayHsv.h, displayHsv.s, displayHsv.v);

  async function copyHex() {
    await navigator.clipboard.writeText(hex);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden">

      {/* Camera feed — CSS-mirrored so it feels like a mirror */}
      {!cameraError && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 w-full h-full object-cover"
          style={{ transform: "scaleX(-1)" }}
        />
      )}

      {/* Skeleton + cursor overlay — mirrored to match the video */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ transform: "scaleX(-1)" }}
      />

      {/* Camera / model error message */}
      {cameraError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
          <p className="text-red-400 text-lg font-medium">{cameraError}</p>
          <p className="text-zinc-500 text-sm mt-2">
            Grant camera access in your browser settings and refresh.
          </p>
        </div>
      )}

      {/* Model loading indicator */}
      {!trackerReady && !cameraError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur text-zinc-300 text-sm px-4 py-2 rounded-full">
          Loading hand tracker…
        </div>
      )}

      {/* Hand-presence pill */}
      {trackerReady && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2">
          <div className={`text-xs px-3 py-1 rounded-full bg-black/60 backdrop-blur transition-colors ${
            handDetected ? "text-white" : "text-zinc-500"
          }`}>
            {handDetected ? "✦ Hand detected" : "Show your hand"}
          </div>
        </div>
      )}

      {/* Color wheel + hex readout */}
      <div className="absolute bottom-6 right-6 flex flex-col items-center gap-3">
        <ColorWheel
          h={displayHsv.h}
          s={displayHsv.s}
          v={displayHsv.v}
          isDone={stage === "done"}
        />

        <div className={`flex items-center gap-3 bg-black/60 backdrop-blur rounded-2xl px-4 py-3 transition-all duration-200 ${
          stage === "done" ? "ring-2 ring-amber-400/70" : ""
        }`}>
          <div
            className="w-10 h-10 rounded-lg border border-white/20 shadow-inner flex-shrink-0"
            style={{ backgroundColor: hex }}
          />
          <span className="font-mono text-xl font-semibold text-white tracking-widest">
            {hex}
          </span>
          <button
            onClick={copyHex}
            className="ml-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm transition-colors active:scale-95"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}
