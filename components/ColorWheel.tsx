"use client";

/**
 * ColorWheel — canvas-based HSV color wheel.
 *
 * Layout:
 *   - Outer ring: full hue spectrum at S=1, L=50%
 *   - Inner circle: filled with the current HSV color
 *   - Indicator dot: white circle on the ring at the current hue angle
 *   - isDone: shows a checkmark inside the circle and turns the dot amber
 */

import { useEffect, useRef } from "react";

interface ColorWheelProps {
  h: number;       // hue, 0–360
  s: number;       // saturation, 0–1
  v: number;       // value (brightness), 0–1
  isDone?: boolean;
}

const SIZE       = 300;
const RING_INNER = 100;
const RING_OUTER = 140;
const CENTER     = SIZE / 2;

export default function ColorWheel({ h, s, v, isDone = false }: ColorWheelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, SIZE, SIZE);

    // ── Hue ring ──────────────────────────────────────────────────────────────
    // Draw 360 thin arcs, each filled with a fully-saturated hue.
    for (let angle = 0; angle < 360; angle++) {
      const startRad = ((angle - 1) * Math.PI) / 180;
      const endRad   = ((angle + 1) * Math.PI) / 180;
      ctx.beginPath();
      ctx.arc(CENTER, CENTER, RING_OUTER, startRad, endRad);
      ctx.arc(CENTER, CENTER, RING_INNER, endRad, startRad, true);
      ctx.closePath();
      ctx.fillStyle = `hsl(${angle}, 100%, 50%)`;
      ctx.fill();
    }

    // ── Inner circle — current HSV color ──────────────────────────────────────
    // Convert HSV to CSS hsl: L = v * (1 - s/2), then back-compute S_css.
    const cssL = v * (1 - s / 2) * 100;
    const cssS = v * s === 0
      ? 0
      : ((v - cssL / 100) / Math.min(cssL / 100, 1 - cssL / 100)) * 100;

    ctx.beginPath();
    ctx.arc(CENTER, CENTER, RING_INNER - 4, 0, 2 * Math.PI);
    ctx.fillStyle = `hsl(${h}, ${cssS.toFixed(1)}%, ${cssL.toFixed(1)}%)`;
    ctx.fill();

    // ── Checkmark (shown when isDone) ─────────────────────────────────────────
    if (isDone) {
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth   = 6;
      ctx.lineCap     = "round";
      ctx.lineJoin    = "round";
      ctx.beginPath();
      ctx.moveTo(CENTER - 22, CENTER);
      ctx.lineTo(CENTER - 6,  CENTER + 18);
      ctx.lineTo(CENTER + 24, CENTER - 18);
      ctx.stroke();
    }

    // ── Hue indicator dot on ring ─────────────────────────────────────────────
    // The ring starts at the right (0°) and goes clockwise, so offset by -90°
    // to place hue=0 (red) at the top.
    const indicatorAngle = ((h - 90) * Math.PI) / 180;
    const indicatorR     = (RING_INNER + RING_OUTER) / 2;
    const ix = CENTER + indicatorR * Math.cos(indicatorAngle);
    const iy = CENTER + indicatorR * Math.sin(indicatorAngle);

    ctx.beginPath();
    ctx.arc(ix, iy, 9, 0, 2 * Math.PI);
    ctx.fillStyle   = isDone ? "#FCD34D" : "white";
    ctx.fill();
    ctx.strokeStyle = "black";
    ctx.lineWidth   = 2;
    ctx.stroke();
  }, [h, s, v, isDone]);

  return (
    <canvas
      ref={canvasRef}
      width={SIZE}
      height={SIZE}
      className="rounded-full drop-shadow-lg"
    />
  );
}
