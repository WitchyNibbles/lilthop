import { describe, expect, it } from "vitest";
import { FRAME_MS } from "../domain/testFrames";
import { TraceFollower, type TracePoint } from "./traceFollower";

/** Feeds f0 values one hop apart (0 = unvoiced). Returns every point as it came out, per frame. */
function feed(values: readonly number[], startMs = 0): TracePoint[][] {
  const follower = new TraceFollower();
  return values.map((f0, i) =>
    follower.push(startMs + i * FRAME_MS, f0, f0 > 0 ? -20 : Number.NaN),
  );
}

const hzOf = (out: TracePoint[][]) => out.flat().map((p) => p.hz);

describe("TraceFollower", () => {
  it("draws a steady voice raw and at once, with no smoothing, after the first frame", () => {
    const out = feed([200, 201, 199, 203, 197]);
    expect(out.map((points) => points.map((p) => p.hz))).toEqual([
      [],
      [200, 201],
      [199],
      [203],
      [197],
    ]);
  });

  it("follows a move of under 3 semitones the frame it happens", () => {
    const out = feed([200, 200, 200, 230, 230]);
    expect(out[3]?.map((p) => p.hz)).toEqual([230]);
  });

  it("holds the very first voiced frame until the next one agrees", () => {
    const out = feed([200, 200]);
    expect(out[0]).toEqual([]);
    expect(out[1]?.map((p) => p.hz)).toEqual([200, 200]);
  });

  it("shows a real jump one frame late, both frames at their own times", () => {
    const out = feed([150, 150, 150, 250, 250, 250]);
    expect(out[3]).toEqual([]);
    const shown = out[4] ?? [];
    expect(shown.map((p) => p.hz)).toEqual([250, 250]);
    expect(shown.map((p) => p.tMs)).toEqual([3 * FRAME_MS, 4 * FRAME_MS]);
  });

  it("a one-frame octave slip never reaches the trace as a pitch", () => {
    const out = feed([200, 200, 200, 400, 200, 200]);
    expect(hzOf(out).filter((hz) => hz > 205)).toEqual([]);
    expect(out[4]?.map((p) => p.tMs)).toEqual([3 * FRAME_MS, 4 * FRAME_MS]);
    expect(out[4]?.map((p) => Number.isNaN(p.hz))).toEqual([true, false]);
  });

  it("the garbage frame of a real step is left out and the step lands one frame after its first clean frame", () => {
    const out = feed([150, 150, 150, 744, 250, 250, 250]);
    expect(hzOf(out).filter((hz) => hz > 260)).toEqual([]);
    expect(out[4]?.map((p) => p.hz)).toEqual([Number.NaN]);
    expect(out[5]?.map((p) => p.hz)).toEqual([250, 250]);
  });

  it("a one-frame dropout is passed on after the next frame, in order", () => {
    const out = feed([200, 200, 200, 0, 200, 200]);
    expect(out[3]).toEqual([]);
    expect(out[4]?.map((p) => p.tMs)).toEqual([3 * FRAME_MS, 4 * FRAME_MS]);
    expect(out[4]?.map((p) => Number.isNaN(p.hz))).toEqual([true, false]);
  });

  it("silence is passed on in time order, never more than one frame behind", () => {
    const out = feed([200, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const times = out.flat().map((p) => p.tMs);
    expect(times).toEqual([...times].sort((x, y) => x - y));
    let shown = 0;
    out.forEach((points, i) => {
      shown += points.length;
      expect(i + 1 - shown).toBeLessThanOrEqual(1);
    });
    expect(out.flat().filter((p) => !Number.isNaN(p.hz))).toHaveLength(2);
  });

  it("carries each frame's own level, also when it was held back", () => {
    const follower = new TraceFollower();
    follower.push(0, 200, -30);
    const out = follower.push(FRAME_MS, 200, -25);
    expect(out.map((p) => p.levelDb)).toEqual([-30, -25]);
  });

  it("starts over after a pause, and the first voiced frame waits for its neighbour again", () => {
    const out = feed([200, 200, ...new Array<number>(10).fill(0), 300, 300]);
    const last = out[out.length - 1] ?? [];
    expect(out[out.length - 2]).toEqual([]);
    expect(last.map((p) => p.hz)).toEqual([300, 300]);
  });
});
