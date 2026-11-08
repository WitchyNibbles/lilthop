import { describe, expect, it, vi } from "vitest";
import type { PitchFrame } from "../domain/contract";
import {
  concat,
  endMs,
  FRAME_MS,
  hiss,
  silent,
  steadyHz,
  stream,
  voiced,
} from "../domain/testFrames";
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

function countViews(feed: LiveFeed): () => number {
  const seen = vi.fn();
  feed.subscribe(seen);
  return () => seen.mock.calls.length;
}

describe("LiveFeed readout", () => {
  it("starts with nothing to show", () => {
    expect(new LiveFeed().getView().hz).toBeNull();
  });

  it("shows the voice in whole Hz", () => {
    const feed = runningFeed();
    play(feed, steadyHz(1, 200.4));
    expect(feed.getView().hz).toBe(200);
  });

  it("publishes at most about six views a second however fast frames come", () => {
    const feed = runningFeed();
    const views = countViews(feed);
    play(
      feed,
      stream(10, (tS) => voiced(190 + 15 * Math.sin(tS * 3))),
    );
    expect(views()).toBeLessThanOrEqual(62);
    expect(views()).toBeGreaterThan(20);
  });

  it("publishes nothing while silence changes nothing", () => {
    const feed = runningFeed();
    const voice = steadyHz(1, 200);
    play(feed, voice);
    play(feed, silent(3, endMs(voice)));
    const views = countViews(feed);
    play(feed, silent(5, endMs(voice) + 3000));
    expect(views()).toBe(0);
  });

  it("holds the last value through a pause, then dims it, and never drops it", () => {
    const feed = runningFeed();
    const voice = steadyHz(1, 200);
    play(feed, voice);
    const shortPause = silent(0.4, endMs(voice));
    play(feed, shortPause);
    expect(feed.getView()).toMatchObject({ hz: 200, pitchDimmed: false });
    play(feed, silent(2, endMs(shortPause)));
    expect(feed.getView()).toMatchObject({ hz: 200, pitchDimmed: true });
  });

  it("undims as soon as the voice returns", () => {
    const feed = runningFeed();
    const first = steadyHz(1, 200);
    const pause = silent(2, endMs(first));
    play(feed, concat(first, pause, steadyHz(0.5, 200, endMs(pause))));
    expect(feed.getView().pitchDimmed).toBe(false);
  });

  it("ignores a one-frame octave slip", () => {
    const feed = runningFeed();
    const voice = steadyHz(1, 200);
    play(feed, voice);
    feed.push({ tMs: endMs(voice), ...voiced(400) });
    play(feed, steadyHz(0.2, 200, endMs(voice) + FRAME_MS));
    expect(feed.getView().hz).toBe(200);
  });

  it("drops frames that arrive after the mic stopped", () => {
    const feed = runningFeed();
    const voice = steadyHz(0.5, 200);
    play(feed, voice);
    feed.stop();
    play(feed, steadyHz(1, 240, endMs(voice)));
    expect(feed.getView().hz).toBeNull();
  });

  it("has no numbers to show once the mic is off", () => {
    const feed = runningFeed();
    play(
      feed,
      stream(1, () => voiced(200, 1800)),
    );
    feed.stop();
    expect(feed.getView()).toMatchObject({
      hz: null,
      levelDb: null,
      brightnessHz: null,
    });
  });

  it("dims when the mic stops", () => {
    const feed = runningFeed();
    play(feed, steadyHz(0.5, 200));
    feed.stop();
    expect(feed.getView()).toMatchObject({ pitchDimmed: true, zone: "quiet" });
  });
});

describe("LiveFeed zone", () => {
  it("says in band for a voice in the band", () => {
    const feed = runningFeed();
    play(feed, steadyHz(1, 200));
    expect(feed.getView().zone).toBe("in");
  });

  it("says below and above outside it", () => {
    const low = runningFeed();
    play(low, steadyHz(1, 120));
    expect(low.getView().zone).toBe("below");
    const high = runningFeed();
    play(high, steadyHz(1, 320));
    expect(high.getView().zone).toBe("above");
  });

  it("does not flip through the gaps between words", () => {
    const feed = runningFeed();
    const zones = new Set<string>();
    play(feed, steadyHz(1, 200));
    let start = 1000;
    for (let i = 0; i < 4; i++) {
      const gap = silent(0.4, start);
      const word = steadyHz(1.8, 200, endMs(gap));
      for (const frame of concat(gap, word)) {
        feed.push(frame);
        zones.add(feed.getView().zone);
      }
      start = endMs(word);
    }
    expect([...zones]).toEqual(["in"]);
  });

  it("goes quiet after a real silence", () => {
    const feed = runningFeed();
    const voice = steadyHz(1, 200);
    play(feed, concat(voice, silent(2, endMs(voice))));
    expect(feed.getView().zone).toBe("quiet");
  });

  it("has no in-band zone without a band", () => {
    const feed = new LiveFeed();
    feed.start(null);
    play(feed, steadyHz(1, 200));
    expect(feed.getView().zone).toBe("voice");
  });
});

describe("LiveFeed level and brightness", () => {
  it("shows level in decibels below full scale", () => {
    const feed = runningFeed();
    play(
      feed,
      stream(1, () => hiss(0.1)),
    );
    expect(feed.getView().levelDb).toBe(-20);
  });

  it("holds the level through a pause and dims it", () => {
    const feed = runningFeed();
    const sound = stream(1, () => hiss(0.1));
    play(feed, concat(sound, silent(2, endMs(sound))));
    expect(feed.getView()).toMatchObject({ levelDb: -20, soundDimmed: true });
  });

  it("shows brightness from voiced frames only", () => {
    const feed = runningFeed();
    play(
      feed,
      stream(1, () => voiced(200, 2400)),
    );
    expect(feed.getView().brightnessHz).toBe(2400);
  });
});

describe("LiveFeed notices", () => {
  it("raises the clipping notice", () => {
    const feed = runningFeed();
    play(
      feed,
      stream(0.5, () => ({ ...voiced(200), peak: 1 })),
    );
    expect(feed.getView().notice).toBe("clipping");
  });

  it("starts fresh with each mic session", () => {
    const feed = runningFeed();
    play(
      feed,
      stream(0.5, () => ({ ...voiced(200), peak: 1 })),
    );
    feed.stop();
    feed.start(BAND);
    expect(feed.getView().notice).toBeNull();
  });
});

describe("LiveFeed raw frames", () => {
  it("hands every frame to listeners until they leave", () => {
    const feed = runningFeed();
    const listener = vi.fn();
    const leave = feed.onFrame(listener);
    const voice = steadyHz(0.1, 200);
    play(feed, voice);
    expect(listener).toHaveBeenCalledTimes(voice.length);
    leave();
    play(feed, steadyHz(0.1, 200, endMs(voice)));
    expect(listener).toHaveBeenCalledTimes(voice.length);
  });

  it("stops telling subscribers once they leave", () => {
    const feed = runningFeed();
    const listener = vi.fn();
    feed.subscribe(listener)();
    play(feed, steadyHz(1, 200));
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("LiveFeed trace", () => {
  it("keeps a gap as a gap: the held value never becomes a point", () => {
    const feed = runningFeed();
    const voice = steadyHz(0.5, 200);
    play(feed, concat(voice, silent(0.2, endMs(voice))));
    const hz: number[] = [];
    feed.trace.forEachPoint((_t, value) => hz.push(value));
    const firstGap = hz.findIndex(Number.isNaN);
    expect(firstGap).toBeGreaterThan(0);
    expect(hz.slice(firstGap).every(Number.isNaN)).toBe(true);
  });

  it("clears when a new mic session starts", () => {
    const feed = runningFeed();
    play(feed, steadyHz(0.5, 200));
    feed.stop();
    feed.start(BAND);
    let points = 0;
    feed.trace.forEachPoint(() => points++);
    expect(points).toBe(0);
  });
});

describe("LiveFeed rest break", () => {
  const MINUTE_S = 60;
  const talk = (seconds: number) => stream(seconds, () => voiced(200));

  it("keeps counting the sitting across a mic restart", () => {
    const feed = runningFeed();
    play(feed, talk(14 * MINUTE_S));
    feed.stop();
    feed.start(BAND);
    play(feed, talk(MINUTE_S + 5));
    expect(feed.getView().notice).toBe("restBreak");
  });

  it("still reminds when a short mic-off gap runs past the moment it was due", () => {
    vi.useFakeTimers();
    const feed = runningFeed();
    play(feed, talk(14 * MINUTE_S + 55));
    feed.stop();
    vi.advanceTimersByTime(25_000);
    feed.start(BAND);
    play(feed, talk(1));
    vi.useRealTimers();
    expect(feed.getView().notice).toBe("restBreak");
  });

  it("counts a long stretch with the mic off as a rest", () => {
    vi.useFakeTimers();
    const feed = runningFeed();
    play(feed, talk(14 * MINUTE_S));
    feed.stop();
    vi.advanceTimersByTime(6 * MINUTE_S * 1000);
    feed.start(BAND);
    play(feed, talk(MINUTE_S + 5));
    vi.useRealTimers();
    expect(feed.getView().notice).toBeNull();
  });

  it("keeps counting when the band changes", () => {
    const feed = runningFeed();
    const first = talk(14 * MINUTE_S);
    play(feed, first);
    feed.start({ minHz: 170, maxHz: 260 });
    const offset = endMs(first);
    play(
      feed,
      talk(MINUTE_S + 5).map((frame) => ({
        ...frame,
        tMs: frame.tMs + offset,
      })),
    );
    expect(feed.getView().notice).toBe("restBreak");
  });
});
