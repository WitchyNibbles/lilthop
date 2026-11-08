import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudioContext } from "../test/fakeBrowser";
import { clampTempo, startMetronome } from "./metronome";

describe("clampTempo", () => {
  it("stays between 30 and 240", () => {
    expect(clampTempo(10)).toBe(30);
    expect(clampTempo(500)).toBe(240);
    expect(clampTempo(90)).toBe(90);
  });

  it("rounds to a whole beat", () => {
    expect(clampTempo(90.6)).toBe(91);
  });

  it("turns nonsense into the slowest tempo", () => {
    expect(clampTempo(Number.NaN)).toBe(30);
  });
});

describe("startMetronome", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const audio = () => {
    const context = FakeAudioContext.instances[0];
    if (context === undefined) throw new Error("no audio context");
    return context;
  };

  it("schedules clicks on the beat", () => {
    const stop = startMetronome(120);
    audio().currentTime = 1;
    vi.advanceTimersByTime(100);
    const clicks = audio().clicks;
    expect(clicks.slice(0, 3)).toEqual([0, 0.5, 1]);
    stop();
  });

  it("stops the clicks and closes the audio", () => {
    const stop = startMetronome(120);
    stop();
    const count = audio().clicks.length;
    audio().currentTime = 5;
    vi.advanceTimersByTime(1000);
    expect(audio().clicks).toHaveLength(count);
    expect(audio().closed).toBe(true);
  });

  it("clamps what it is given", () => {
    const stop = startMetronome(1000);
    audio().currentTime = 1;
    vi.advanceTimersByTime(100);
    expect(audio().clicks[1]).toBeCloseTo(0.25, 6);
    stop();
  });
});
