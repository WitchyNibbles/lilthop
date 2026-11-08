import { describe, expect, it } from "vitest";
import type { PitchFrame } from "../domain/contract";
import { endMs, FRAME_MS, steadyHz, voiced } from "../domain/testFrames";
import { LiveFeed } from "./liveFeed";

const BAND = { minHz: 165, maxHz: 255 };

function runningFeed(): LiveFeed {
  const feed = new LiveFeed();
  feed.start(BAND);
  return feed;
}

function play(feed: LiveFeed, frames: readonly PitchFrame[]): void {
  for (const frame of frames) feed.push(frame);
}

/**
 * How long after the first sample of a new tone the trace holds a point at the new pitch, in
 * stream time (from samples, so the test needs no clock). The frames are what the detector
 * really gives for a step at 48 kHz: the window that straddles the step ends 24 ms after it
 * and reads garbage, then every hop gives the new pitch (measured with the Rust pipeline).
 */
function msUntilTraceReaches(
  fromHz: number,
  reached: (hz: number) => boolean,
  toHz: number,
  straddleHz: number,
): number {
  const feed = runningFeed();
  const before = steadyHz(1, fromHz);
  const stepMs = endMs(before);
  const tone = (offsetMs: number, f0: number): PitchFrame => ({
    ...voiced(f0),
    tMs: stepMs + offsetMs,
  });
  play(feed, before);
  const after = [
    tone(24, straddleHz),
    ...Array.from({ length: 12 }, (_, i) => tone(45.3 + i * FRAME_MS, toHz)),
  ];
  let found: number | null = null;
  for (const frame of after) {
    feed.push(frame);
    feed.trace.forEachPoint((tMs, hz) => {
      if (found === null && tMs >= stepMs && reached(hz)) found = tMs - stepMs;
    });
  }
  if (found === null) throw new Error("the trace never reached the new pitch");
  return found;
}

describe("LiveFeed trace delay", () => {
  // The trace draws what the detector says. A move under 3 semitones shows with the first clean
  // frame (45 ms after the step: the window must hold only the new tone). A jump also waits for
  // one more frame to agree, so an octave slip never shows: 45 + 21 = 67 ms.
  it("a jump from 150 to 250 Hz is on the trace one frame after the first clean frame", () => {
    const at = msUntilTraceReaches(
      150,
      (hz) => Math.abs(hz - 250) < 5,
      250,
      744,
    );
    expect(at).toBeLessThanOrEqual(70);
  });

  it("a move of under 3 semitones is on the trace with the first clean frame", () => {
    const at = msUntilTraceReaches(150, (hz) => hz >= 164, 165, 150);
    expect(at).toBeLessThanOrEqual(50);
  });

  it("the trace line carries the detector's wobble, not an average of it", () => {
    const feed = runningFeed();
    play(feed, steadyHz(0.5, 200));
    const t = endMs(steadyHz(0.5, 200));
    feed.push({ ...voiced(206), tMs: t });
    let newest = 0;
    feed.trace.forEachPoint((_t, hz) => {
      newest = hz;
    });
    expect(newest).toBe(206);
  });

  it("a one-frame octave slip still never reaches the trace", () => {
    const feed = runningFeed();
    const steady = steadyHz(1, 200);
    play(feed, steady);
    feed.push({ ...voiced(400), tMs: endMs(steady) });
    play(feed, steadyHz(0.3, 200, endMs(steady) + FRAME_MS));
    let highest = 0;
    feed.trace.forEachPoint((_t, hz) => {
      if (!Number.isNaN(hz)) highest = Math.max(highest, hz);
    });
    expect(highest).toBeLessThan(205);
  });
});
