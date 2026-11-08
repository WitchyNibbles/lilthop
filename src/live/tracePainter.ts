import type { TraceBuffer } from "./traceBuffer";
import {
  sweepX,
  TRACE_WINDOW_MS,
  type Band,
  type TraceScale,
} from "./traceScale";

export interface TraceColours {
  readonly line: string;
  readonly band: string;
  readonly bandFade: string;
  readonly bandEdge: string;
  readonly grid: string;
  readonly label: string;
  readonly tip: string;
  readonly glow: string;
  readonly glowFade: string;
  readonly fontFamily: string;
}

export type TraceSeries = "pitch" | "level";

export interface TraceScene {
  readonly width: number;
  readonly height: number;
  readonly scale: TraceScale;
  readonly series: TraceSeries;
  readonly band: Band | null;
  readonly colours: TraceColours;
}

/** The parts of a 2D context the trace uses. */
export type TraceContext = Pick<
  CanvasRenderingContext2D,
  | "clearRect"
  | "fillRect"
  | "fillText"
  | "beginPath"
  | "stroke"
  | "fill"
  | "arc"
  | "moveTo"
  | "lineTo"
  | "createRadialGradient"
  | "save"
  | "restore"
  | "translate"
  | "scale"
  | "fillStyle"
  | "strokeStyle"
  | "globalAlpha"
  | "lineWidth"
  | "lineCap"
  | "lineJoin"
  | "font"
  | "textAlign"
  | "textBaseline"
>;

/**
 * Points further apart than this are a dropout, not a line. Two frames apart (one frame missing,
 * 43 to 47 ms) is still drawn through: a single slip or dropout must not break the line.
 */
const MAX_JOIN_GAP_MS = 50;
/** Clear space kept ahead of the tip, so the sweep is easy to find. */
const CLEAR_AHEAD_MS = 320;
const LINE_WIDTH = 2.5;
const PREVIOUS_SWEEP_ALPHA = 0.32;
const TIP_RADIUS = 3.5;
const GLOW_RADIUS = 16;
const LABEL_INSET = 8;
const LABEL_SIZE_PX = 11;
/** How far the light reaches, past the band's own half-width and half-height. */
const BAND_LIGHT_REACH = 1.15;

const toY = (scene: TraceScene, value: number): number =>
  scene.height * (1 - scene.scale.toUnit(value));

/** One gradient in one fill: an ellipse of light, brightest at the centre, clipped to the band. */
function paintBandLight(
  ctx: TraceContext,
  scene: TraceScene,
  top: number,
  bottom: number,
): void {
  const halfWidth = scene.width / 2;
  const halfHeight = (bottom - top) / 2;
  const reach = halfWidth * BAND_LIGHT_REACH;
  const squash = (halfHeight * BAND_LIGHT_REACH) / reach;
  const light = ctx.createRadialGradient(0, 0, 0, 0, 0, reach);
  light.addColorStop(0, scene.colours.band);
  light.addColorStop(1, scene.colours.bandFade);
  ctx.save();
  ctx.translate(halfWidth, top + halfHeight);
  ctx.scale(1, squash);
  ctx.fillStyle = light;
  const tall = halfHeight / squash;
  ctx.fillRect(-halfWidth, -tall, scene.width, tall * 2);
  ctx.restore();
}

function paintBand(ctx: TraceContext, scene: TraceScene): void {
  if (scene.band === null) return;
  const top = toY(scene, scene.band.maxHz);
  const bottom = toY(scene, scene.band.minHz);
  paintBandLight(ctx, scene, top, bottom);
  ctx.strokeStyle = scene.colours.bandEdge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const y of [top, bottom]) {
    ctx.moveTo(0, y);
    ctx.lineTo(scene.width, y);
  }
  ctx.stroke();
}

function paintGrid(ctx: TraceContext, scene: TraceScene): void {
  ctx.strokeStyle = scene.colours.grid;
  ctx.fillStyle = scene.colours.label;
  ctx.lineWidth = 1;
  ctx.font = `${LABEL_SIZE_PX}px ${scene.colours.fontFamily}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.beginPath();
  for (const tick of scene.scale.ticks) {
    const y = toY(scene, tick);
    ctx.moveTo(0, y);
    ctx.lineTo(scene.width, y);
    ctx.fillText(String(tick), LABEL_INSET, y - 2);
  }
  ctx.stroke();
}

function strokeLine(
  ctx: TraceContext,
  buffer: TraceBuffer,
  scene: TraceScene,
  keep: (tMs: number) => boolean,
): void {
  let lastMs: number | null = null;
  let lastX = 0;
  ctx.beginPath();
  buffer.forEachPoint((tMs, hz, levelDb) => {
    const value = scene.series === "pitch" ? hz : levelDb;
    if (!keep(tMs)) {
      lastMs = null;
      return;
    }
    if (Number.isNaN(value)) return;
    const x = sweepX(tMs, scene.width);
    const joined =
      lastMs !== null && tMs - lastMs <= MAX_JOIN_GAP_MS && x >= lastX;
    if (joined) ctx.lineTo(x, toY(scene, value));
    else ctx.moveTo(x, toY(scene, value));
    lastMs = tMs;
    lastX = x;
  });
  ctx.stroke();
}

function paintLine(
  ctx: TraceContext,
  buffer: TraceBuffer,
  scene: TraceScene,
  tipMs: number,
): void {
  const sweepStartMs = tipMs - (tipMs % TRACE_WINDOW_MS);
  const oldestMs = tipMs - TRACE_WINDOW_MS + CLEAR_AHEAD_MS;
  ctx.strokeStyle = scene.colours.line;
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = PREVIOUS_SWEEP_ALPHA;
  strokeLine(ctx, buffer, scene, (t) => t >= oldestMs && t < sweepStartMs);
  ctx.globalAlpha = 1;
  strokeLine(ctx, buffer, scene, (t) => t >= sweepStartMs);
}

function latestValue(buffer: TraceBuffer, series: TraceSeries): number {
  let latest = Number.NaN;
  buffer.forEachPoint((_tMs, hz, levelDb) => {
    latest = series === "pitch" ? hz : levelDb;
  });
  return latest;
}

function isInBand(scene: TraceScene, value: number): boolean {
  const { band } = scene;
  return band !== null && value >= band.minHz && value <= band.maxHz;
}

function paintGlow(
  ctx: TraceContext,
  x: number,
  y: number,
  { glow: from, glowFade: to }: TraceColours,
) {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, GLOW_RADIUS);
  glow.addColorStop(0, from);
  glow.addColorStop(1, to);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, GLOW_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

function paintTip(
  ctx: TraceContext,
  buffer: TraceBuffer,
  scene: TraceScene,
  tipMs: number,
): void {
  const value = latestValue(buffer, scene.series);
  if (Number.isNaN(value)) return;
  const x = sweepX(tipMs, scene.width);
  const y = toY(scene, value);
  if (isInBand(scene, value)) paintGlow(ctx, x, y, scene.colours);
  ctx.fillStyle = scene.colours.tip;
  ctx.beginPath();
  ctx.arc(x, y, TIP_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

export function paintTrace(
  ctx: TraceContext,
  buffer: TraceBuffer,
  scene: TraceScene,
): void {
  ctx.clearRect(0, 0, scene.width, scene.height);
  paintBand(ctx, scene);
  paintGrid(ctx, scene);
  const tipMs = buffer.lastMs;
  if (tipMs === null) return;
  paintLine(ctx, buffer, scene, tipMs);
  paintTip(ctx, buffer, scene, tipMs);
}
