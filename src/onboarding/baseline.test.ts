import { describe, expect, it } from "vitest";
import { SessionRecorder } from "../domain/session";
import { steadyHz, stream, voiced, silent } from "../domain/testFrames";
import { measureBaseline, startingRange, toDecibels } from "./baseline";

function recorded(frames: Parameters<SessionRecorder["add"]>[0][]) {
  const recorder = new SessionRecorder();
  for (const frame of frames) recorder.add(frame);
  return recorder.snapshot();
}

describe("measureBaseline", () => {
  it("reads the pitch, brightness and level out of the frames", () => {
    const baseline = measureBaseline(
      recorded(stream(10, () => voiced(182, 1900))),
    );
    expect(baseline?.hz).toBeCloseTo(182, 0);
    expect(baseline?.centroid).toBeCloseTo(1900, 0);
    expect(baseline?.rms).toBeGreaterThan(0);
  });

  it("gives nothing when there was too little voice to measure", () => {
    expect(measureBaseline(recorded(steadyHz(2, 180)))).toBeNull();
    expect(measureBaseline(recorded(silent(10)))).toBeNull();
  });
});

describe("startingRange", () => {
  const up = (hz: number, semitones: number) => hz * 2 ** (semitones / 12);
  const semitonesBetween = (low: number, high: number) =>
    12 * Math.log2(high / low);
  /** Every half Hz from 60 to 400: low voices, high voices and the 175 Hz seam. */
  const BASELINES = Array.from({ length: 681 }, (_, i) => 60 + i / 2);
  /** Each edge is rounded to a whole Hz, so it can sit up to this far from the rule. */
  const ROUNDING_HZ = 0.5;

  it.each([
    [90, 95, 120, "lifted"],
    [100, 106, 133, "lifted"],
    [120, 127, 160, "lifted"],
    [130, 138, 174, "lifted"],
    [160, 170, 214, "lifted"],
    [170, 175, 220, "lifted"],
    [180, 175, 220, "around"],
    [200, 178, 238, "around"],
    [220, 196, 262, "around"],
    [250, 223, 297, "around"],
  ] as const)("from %d Hz suggests %d to %d Hz, %s", (hz, min, max, start) => {
    expect(startingRange(hz)).toEqual({ minHz: min, maxHz: max, start });
  });

  it("never lowers either edge as the baseline rises", () => {
    for (const hz of BASELINES) {
      const before = startingRange(hz - 0.5);
      const now = startingRange(hz);
      expect(now.minHz).toBeGreaterThanOrEqual(before.minHz);
      expect(now.maxHz).toBeGreaterThanOrEqual(before.maxHz);
    }
  });

  it("is always at least 3.9 semitones wide, give or take the rounding", () => {
    for (const hz of BASELINES) {
      const { minHz, maxHz } = startingRange(hz);
      expect(
        semitonesBetween(minHz - ROUNDING_HZ, maxHz + ROUNDING_HZ),
        `${hz} Hz`,
      ).toBeGreaterThanOrEqual(3.9);
    }
  });

  it("never starts more than 2 semitones under the baseline", () => {
    for (const hz of BASELINES)
      expect(startingRange(hz).minHz + ROUNDING_HZ).toBeGreaterThanOrEqual(
        up(hz, -2),
      );
  });

  it("only goes past 220 Hz to sit around a voice that is already there", () => {
    for (const hz of BASELINES)
      expect(startingRange(hz).maxHz - ROUNDING_HZ).toBeLessThanOrEqual(
        Math.max(220, up(hz, 3)),
      );
  });

  it("lifts exactly the baselines under 175 Hz", () => {
    for (const hz of BASELINES)
      expect(startingRange(hz).start, `${hz} Hz`).toBe(
        hz < 175 ? "lifted" : "around",
      );
  });
});

describe("toDecibels", () => {
  it("is 0 at full scale and negative below it", () => {
    expect(toDecibels(1)).toBe(0);
    expect(toDecibels(0.1)).toBeCloseTo(-20, 5);
  });
});
