import { describe, expect, it, vi } from "vitest";
import type { PitchFrame } from "../domain/contract";
import { FRAME_MS, voiced } from "../domain/testFrames";
import {
  startTimingProbe,
  timingEnabled,
  TimingProbe,
  type TimingEnv,
} from "./timingProbe";

describe("TimingProbe", () => {
  it("frames that arrive as fast as the audio was heard are not behind", () => {
    const probe = new TimingProbe();
    for (let i = 0; i < 50; i++)
      probe.frame(i * FRAME_MS, 1_000 + i * FRAME_MS);
    const report = probe.take();
    expect(report.frames).toBe(50);
    expect(report.behindMs).toBeCloseTo(0, 6);
  });

  it("a constant delay is the floor, not lateness", () => {
    const probe = new TimingProbe();
    for (let i = 0; i < 50; i++) probe.frame(i * FRAME_MS, 80 + i * FRAME_MS);
    expect(probe.take().worstBehindMs).toBeCloseTo(0, 6);
  });

  it("frames that fall further behind the audio show how far", () => {
    const probe = new TimingProbe();
    for (let i = 0; i < 100; i++)
      probe.frame(i * FRAME_MS, 1_000 + i * (FRAME_MS + 5));
    const report = probe.take();
    expect(report.behindMs).toBeCloseTo(99 * 5, 6);
    expect(report.worstBehindMs).toBeCloseTo(99 * 5, 6);
  });

  it("a burst after a stall counts as late, then catches up", () => {
    const probe = new TimingProbe();
    for (let i = 0; i < 20; i++) probe.frame(i * FRAME_MS, i * FRAME_MS);
    probe.frame(20 * FRAME_MS, 20 * FRAME_MS + 300);
    expect(probe.take().worstBehindMs).toBeCloseTo(300, 6);
    probe.frame(21 * FRAME_MS, 20 * FRAME_MS + 301);
    expect(probe.take().behindMs).toBeCloseTo(301 - FRAME_MS, 6);
  });

  it("reports the longest silence between frames and between paints", () => {
    const probe = new TimingProbe();
    probe.frame(0, 100);
    probe.frame(FRAME_MS, 100 + FRAME_MS);
    probe.frame(2 * FRAME_MS, 100 + 2 * FRAME_MS + 90);
    probe.paint(10);
    probe.paint(27);
    probe.paint(277);
    expect(probe.take()).toMatchObject({
      longestGapMs: expect.closeTo(FRAME_MS + 90, 6) as number,
      longestPaintGapMs: 250,
    });
  });

  it("each report covers only what came since the last one", () => {
    const probe = new TimingProbe();
    probe.frame(0, 0);
    probe.frame(FRAME_MS, 200);
    probe.take();
    probe.frame(2 * FRAME_MS, 2 * FRAME_MS);
    expect(probe.take()).toMatchObject({ frames: 1, longestGapMs: 0 });
  });
});

describe("timingEnabled", () => {
  it("is off unless the flag is set to 1", () => {
    const store = (value: string | null) => ({ getItem: () => value });
    expect(timingEnabled(store(null))).toBe(false);
    expect(timingEnabled(store("0"))).toBe(false);
    expect(timingEnabled(store("1"))).toBe(true);
  });

  it("is off when storage cannot be read", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    expect(timingEnabled(broken)).toBe(false);
  });
});

function fakeEnv(enabled: boolean) {
  let frameCallback: ((t: number) => void) | null = null;
  let tick: (() => void) | null = null;
  let clock = 0;
  const env: TimingEnv = {
    enabled,
    reducedMotion: true,
    now: () => clock,
    log: vi.fn(),
    requestFrame: (cb) => {
      frameCallback = cb;
      return 1;
    },
    cancelFrame: vi.fn(),
    every: (cb) => {
      tick = cb;
      return vi.fn();
    },
  };
  return {
    env,
    at: (ms: number) => {
      clock = ms;
    },
    paint: (ms: number) => frameCallback?.(ms),
    secondPasses: () => tick?.(),
  };
}

function fakeFeed() {
  let listener: ((frame: PitchFrame) => void) | null = null;
  const unsubscribe = vi.fn();
  return {
    feed: {
      onFrame: (l: (frame: PitchFrame) => void) => {
        listener = l;
        return unsubscribe;
      },
    },
    send: (frame: PitchFrame) => listener?.(frame),
    unsubscribe,
    subscribed: () => listener !== null,
  };
}

describe("startTimingProbe", () => {
  it("does nothing when it is off", () => {
    const { env } = fakeEnv(false);
    const { feed, subscribed } = fakeFeed();
    const stop = startTimingProbe(feed, env);
    expect(subscribed()).toBe(false);
    expect(env.log).not.toHaveBeenCalled();
    stop();
  });

  it("prints one line a second and stops when asked", () => {
    const { env, at, paint, secondPasses } = fakeEnv(true);
    const { feed, send, unsubscribe } = fakeFeed();
    const stop = startTimingProbe(feed, env);

    at(100);
    send({ ...voiced(200), tMs: 0 });
    paint(110);
    at(100 + FRAME_MS + 60);
    send({ ...voiced(200), tMs: FRAME_MS });
    secondPasses();

    expect(env.log).toHaveBeenCalledTimes(1);
    const line = vi.mocked(env.log).mock.calls[0]?.[0] ?? "";
    expect(line).toContain("2 frames");
    expect(line).toContain("behind 60 ms");
    expect(line).toContain("reduced motion on");
    stop();
    expect(unsubscribe).toHaveBeenCalled();
    expect(env.cancelFrame).toHaveBeenCalled();
  });
});
