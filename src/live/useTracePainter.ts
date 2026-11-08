import { useEffect, type RefObject } from "react";
import type { Theme } from "../domain/contract";
import {
  paintTrace,
  type TraceColours,
  type TraceSeries,
} from "./tracePainter";
import type { TraceBuffer } from "./traceBuffer";
import { levelScale, pitchScale, type Band } from "./traceScale";
import { useReducedMotion } from "./useReducedMotion";

/** Reduced motion steps the trace about four times a second. */
const REDUCED_MOTION_PAINT_MS = 250;

export interface TraceSetup {
  readonly buffer: TraceBuffer;
  readonly series: TraceSeries;
  readonly band: Band | null;
  /** Colours come from tokens.css, so a change of theme has to read them again. */
  readonly theme: Theme;
  /** Holds what is drawn, whatever arrives: a finished session keeps its thread on screen. */
  readonly frozen?: boolean;
}

function readColours(element: HTMLElement): TraceColours {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    line: token("--trace-line"),
    band: token("--trace-band"),
    bandFade: token("--trace-band-fade"),
    bandEdge: token("--trace-band-edge"),
    grid: token("--trace-grid"),
    label: token("--trace-label"),
    tip: token("--trace-tip"),
    glow: token("--trace-glow"),
    glowFade: token("--trace-glow-fade"),
    fontFamily: token("--font-mono"),
  };
}

/** Draws from the buffer on animation frames. Nothing here goes through React. */
export function useTracePainter(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  { buffer, series, band, theme, frozen }: TraceSetup,
): void {
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return undefined;
    const scale = series === "pitch" ? pitchScale(band) : levelScale();
    const colours = readColours(canvas);
    const minGapMs = reducedMotion ? REDUCED_MOTION_PAINT_MS : 0;
    let ratio = 0;
    let paintedVersion = -1;
    let paintedAt = Number.NEGATIVE_INFINITY;
    let frame = 0;

    const fit = () => {
      ratio = window.devicePixelRatio;
      canvas.width = Math.round(canvas.clientWidth * ratio);
      canvas.height = Math.round(canvas.clientHeight * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      paintedVersion = -1;
    };

    const paint = () => {
      paintTrace(ctx, buffer, {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        scale,
        series,
        band,
        colours,
      });
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (window.devicePixelRatio !== ratio) fit();
      if (frozen === true && paintedVersion !== -1) return;
      if (buffer.version === paintedVersion || now - paintedAt < minGapMs)
        return;
      paintedVersion = buffer.version;
      paintedAt = now;
      paint();
    };

    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [band, buffer, canvasRef, frozen, reducedMotion, series, theme]);
}
