import { describe, expect, it } from "vitest";
import { levelScale, pitchScale, sweepX, TRACE_WINDOW_MS } from "./traceScale";

const BAND = { minHz: 165, maxHz: 255 };

describe("pitchScale", () => {
  it("is logarithmic: every octave is the same height", () => {
    const scale = pitchScale(BAND);
    const octaveLow = scale.toUnit(200) - scale.toUnit(100);
    const octaveHigh = scale.toUnit(400) - scale.toUnit(200);
    expect(octaveLow).toBeCloseTo(octaveHigh, 6);
  });

  it("keeps the whole band on the chart with room around it", () => {
    const scale = pitchScale(BAND);
    expect(scale.toUnit(165)).toBeGreaterThan(0.1);
    expect(scale.toUnit(255)).toBeLessThan(0.9);
  });

  it("stays inside what the detector can hear", () => {
    const scale = pitchScale({ minHz: 70, maxHz: 900 });
    expect(scale.toUnit(60)).toBeCloseTo(0, 6);
    expect(scale.toUnit(1000)).toBeCloseTo(1, 6);
  });

  it("has a sensible chart with no band", () => {
    const scale = pitchScale(null);
    expect(scale.toUnit(100)).toBeGreaterThan(0);
    expect(scale.toUnit(400)).toBeLessThan(1);
  });

  it("labels only ticks on the chart", () => {
    const scale = pitchScale(BAND);
    expect(scale.ticks.length).toBeGreaterThan(2);
    for (const tick of scale.ticks) {
      expect(scale.toUnit(tick)).toBeGreaterThanOrEqual(0);
      expect(scale.toUnit(tick)).toBeLessThanOrEqual(1);
    }
  });
});

describe("levelScale", () => {
  it("runs from the volume gate to full scale", () => {
    const scale = levelScale();
    expect(scale.toUnit(-60)).toBeCloseTo(0, 6);
    expect(scale.toUnit(0)).toBeCloseTo(1, 6);
  });
});

describe("sweepX", () => {
  it("crosses the chart once every window", () => {
    expect(sweepX(0, 800)).toBe(0);
    expect(sweepX(TRACE_WINDOW_MS / 2, 800)).toBe(400);
    expect(sweepX(TRACE_WINDOW_MS + 1000, 800)).toBe(sweepX(1000, 800));
  });

  it("keeps an eight second window", () => {
    expect(TRACE_WINDOW_MS).toBe(8000);
  });
});
