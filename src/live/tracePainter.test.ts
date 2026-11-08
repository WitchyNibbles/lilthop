import { describe, expect, it } from "vitest";
import { canvasContext } from "../test/fakeBrowser";
import { paintTrace, type TraceScene } from "./tracePainter";
import { TraceBuffer } from "./traceBuffer";
import { pitchScale } from "./traceScale";

const BAND = { minHz: 165, maxHz: 255 };
const COLOURS = {
  line: "gold",
  band: "bandfill",
  bandFade: "bandfade",
  bandEdge: "bandedge",
  grid: "grid",
  label: "label",
  tip: "tip",
  glow: "glow",
  glowFade: "glowfade",
  fontFamily: "mono",
};

function scene(part: Partial<TraceScene> = {}): TraceScene {
  return {
    width: 800,
    height: 300,
    scale: pitchScale(BAND),
    series: "pitch",
    band: BAND,
    colours: COLOURS,
    ...part,
  };
}

function bufferOf(points: readonly [number, number][]): TraceBuffer {
  const buffer = new TraceBuffer();
  for (const [tMs, hz] of points) buffer.push(tMs, hz, -20);
  return buffer;
}

const paint = (buffer: TraceBuffer, part?: Partial<TraceScene>) => {
  paintTrace(canvasContext, buffer, scene(part));
};

describe("paintTrace", () => {
  it("draws the band whether or not there is a voice", () => {
    paint(new TraceBuffer());
    expect(canvasContext.times("fillRect")).toBe(1);
  });

  it("lights the band from its centre and fades to nothing at the sides", () => {
    paint(new TraceBuffer());
    expect(canvasContext.gradientStops).toEqual(["bandfill", "bandfade"]);
    expect(canvasContext.times("save")).toBe(canvasContext.times("restore"));
  });

  it("draws no band when there is none", () => {
    paint(new TraceBuffer(), { band: null });
    expect(canvasContext.times("fillRect")).toBe(0);
  });

  it("joins neighbouring points into one line", () => {
    paint(
      bufferOf([
        [100, 200],
        [121, 201],
        [142, 202],
      ]),
    );
    expect(canvasContext.lines.filter((p) => p.x < 800)).toHaveLength(2);
  });

  it("leaves a gap where there was no voice", () => {
    paint(
      bufferOf([
        [100, 200],
        [121, 201],
        [142, Number.NaN],
        [163, Number.NaN],
        [184, 200],
        [205, 201],
      ]),
    );
    expect(canvasContext.moves.filter((p) => p.x > 0)).toHaveLength(2);
  });

  it("draws through a single missing frame, so a one-frame dropout or slip does not break the line", () => {
    paint(
      bufferOf([
        [100, 200],
        [121, 201],
        [142, Number.NaN],
        [163, 200],
        [184, 201],
      ]),
    );
    expect(canvasContext.moves.filter((p) => p.x > 0)).toHaveLength(1);
    expect(canvasContext.lines.filter((p) => p.x < 800)).toHaveLength(3);
  });

  it("breaks the line when frames stopped coming", () => {
    paint(
      bufferOf([
        [100, 200],
        [121, 201],
        [900, 200],
        [921, 201],
      ]),
    );
    expect(canvasContext.moves.filter((p) => p.x > 0)).toHaveLength(2);
  });

  it("does not draw a line back across the chart when the sweep wraps", () => {
    paint(
      bufferOf([
        [7980, 200],
        [8001, 200],
        [8022, 200],
      ]),
    );
    const restarted = canvasContext.moves.filter((p) => p.x > 0 && p.x < 1);
    expect(restarted).toHaveLength(1);
  });

  it("fades the glow on its own colour, never through a grey transparent", () => {
    paint(bufferOf([[100, 200]]));
    expect(canvasContext.gradientStops).toContain("glowfade");
    expect(canvasContext.gradientStops).not.toContain("transparent");
  });

  it("gives the tip a soft glow only inside the band", () => {
    paint(bufferOf([[100, 200]]));
    expect(canvasContext.gradientStops).toContain("glow");
    canvasContext.reset();
    paint(bufferOf([[100, 320]]));
    expect(canvasContext.gradientStops).not.toContain("glow");
  });

  it("draws no tip during a gap", () => {
    paint(
      bufferOf([
        [100, 200],
        [121, Number.NaN],
      ]),
    );
    expect(canvasContext.times("arc")).toBe(0);
  });

  it("forgets everything older than the window", () => {
    paint(
      bufferOf([
        [100, 200],
        [121, 200],
        [20_000, 200],
      ]),
    );
    expect(canvasContext.lines.filter((p) => p.x < 12)).toHaveLength(0);
  });

  it("labels the axis", () => {
    paint(new TraceBuffer());
    expect(canvasContext.times("fillText")).toBeGreaterThan(2);
  });

  it("can draw the level instead of the pitch", () => {
    const buffer = new TraceBuffer();
    buffer.push(100, Number.NaN, -20);
    buffer.push(121, Number.NaN, -21);
    paint(buffer, { series: "level", band: null });
    expect(canvasContext.times("arc")).toBe(1);
  });
});
