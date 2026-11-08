import { describe, expect, it } from "vitest";
import type { PitchFrame } from "./contract";
import { PitchTracker, type TrackerReading } from "./pitchTracker";
import {
  FRAME_MS,
  concat,
  endMs,
  seededRandom,
  shiftedHz,
  silence,
  silent,
  steadyHz,
  stream,
  voiced,
} from "./testFrames";
import { semitonesBetween } from "./statistics";

function run(
  frames: readonly PitchFrame[],
): { frame: PitchFrame; reading: TrackerReading | null }[] {
  const tracker = new PitchTracker();
  return frames.map((frame) => ({ frame, reading: tracker.push(frame) }));
}

function lastOf<T>(items: readonly T[]): T | undefined {
  return items[items.length - 1];
}

function hzAt(frames: readonly PitchFrame[], index: number): number {
  const reading = run(frames)[index]?.reading;
  if (!reading) throw new Error(`no reading at frame ${index}`);
  return reading.hz;
}

describe("steady voice", () => {
  it("shows the pitch being sung, not held", () => {
    const readings = run(steadyHz(1, 200));
    for (const { reading } of readings) {
      expect(reading?.held).toBe(false);
      expect(reading?.hz).toBeCloseTo(200, 6);
    }
  });

  it("shows nothing before the first voiced frame", () => {
    expect(run(silent(0.5)).every(({ reading }) => reading === null)).toBe(
      true,
    );
  });
});

describe("slips and real moves", () => {
  it("a one-frame octave slip never reaches the display", () => {
    const frames = stream(1, (t) => voiced(t > 0.5 && t < 0.52 ? 400 : 200));
    expect(frames.filter((f) => f.f0 === 400)).toHaveLength(1);
    for (const { reading } of run(frames)) {
      expect(reading?.hz).toBeCloseTo(200, 3);
    }
  });

  it("a two-frame slip also vanishes", () => {
    const frames = stream(1, (t) => voiced(t > 0.5 && t < 0.54 ? 400 : 200));
    expect(frames.filter((f) => f.f0 === 400)).toHaveLength(2);
    for (const { reading } of run(frames)) {
      expect(reading?.hz).toBeCloseTo(200, 3);
    }
  });

  it("slips that do not agree with each other never land", () => {
    const wild = [300, 420, 260, 500, 330, 450];
    const frames = concat(
      steadyHz(0.5, 200),
      wild.map((f0, i) => ({ tMs: 500 + i * FRAME_MS, ...voiced(f0) })),
    );
    for (const { reading } of run(frames)) {
      expect(reading?.hz).toBeCloseTo(200, 3);
    }
  });

  it("agreeing slips split by a silent frame are not three in a row", () => {
    const pieces = [400, 400, 0, 400].map((f0, i) => ({
      tMs: 500 + i * FRAME_MS,
      ...(f0 === 0 ? silence() : voiced(f0)),
    }));
    const frames = concat(steadyHz(0.5, 200), pieces);
    for (const { reading } of run(frames)) {
      expect(Math.abs(semitonesBetween(200, reading?.hz ?? 0))).toBeLessThan(
        0.01,
      );
    }
  });

  it("a real move from 110 to 230 Hz arrives within 3 frames (under 100 ms) and stays", () => {
    const first = steadyHz(0.5, 110);
    const jumpAt = endMs(first);
    const frames = concat(first, steadyHz(1, 230, jumpAt));
    const readings = run(frames);
    const arrived = readings.filter(({ frame }) => frame.tMs >= jumpAt + 50);
    expect(arrived.length).toBeGreaterThan(30);
    expect(arrived[0]?.frame.tMs).toBeLessThan(jumpAt + 100);
    for (const { reading } of arrived) {
      expect(Math.abs(semitonesBetween(230, reading?.hz ?? 0))).toBeLessThan(
        0.2,
      );
    }
  });

  it("a one-frame blip of 2 semitones does not move the display", () => {
    const frames = stream(1, (t) =>
      voiced(t > 0.5 && t < 0.52 ? shiftedHz(200, 2) : 200),
    );
    expect(frames.filter((f) => f.f0 !== 200)).toHaveLength(1);
    for (const { reading } of run(frames)) {
      expect(reading?.hz).toBeCloseTo(200, 3);
    }
  });

  it("a step of 2 semitones is eased in over several frames, not taken at once", () => {
    const frames = concat(
      steadyHz(0.5, 200),
      steadyHz(1, shiftedHz(200, 2), 500),
    );
    const afterStep = run(frames).filter(({ frame }) => frame.tMs >= 500);
    const shifts = afterStep.map(({ reading }) =>
      semitonesBetween(200, reading?.hz ?? 0),
    );
    expect(shifts[0]).toBeCloseTo(0, 3);
    const eased = shifts.filter((s) => s > 0.1 && s < 1.9);
    expect(eased.length).toBeGreaterThanOrEqual(3);
    expect(shifts[shifts.length - 1]).toBeGreaterThan(1.95);
  });

  it("a move of less than 3 semitones is followed without a gate", () => {
    const frames = concat(
      steadyHz(0.5, 200),
      steadyHz(1, shiftedHz(200, 2), 500),
    );
    const last = lastOf(run(frames))?.reading;
    expect(
      Math.abs(semitonesBetween(shiftedHz(200, 2), last?.hz ?? 0)),
    ).toBeLessThan(0.05);
  });

  it("a slow glide is followed with a small lag and never goes backwards", () => {
    const frames = stream(3, (t) => voiced(shiftedHz(150, t * 4)));
    const shown = run(frames).map(({ reading }) => reading?.hz ?? 0);
    for (let i = 1; i < shown.length; i++) {
      expect(shown[i] ?? 0).toBeGreaterThanOrEqual(shown[i - 1] ?? 0);
    }
    const lastFrame = lastOf(frames);
    const lag = semitonesBetween(lastOf(shown) ?? 0, lastFrame?.f0 ?? 0);
    expect(lag).toBeGreaterThan(0);
    expect(lag).toBeLessThan(1);
  });
});

describe("gaps", () => {
  const before = steadyHz(0.5, 200);
  const gapStart = endMs(before);

  it("holds the last value, flagged held, for 300 ms of silence", () => {
    const readings = run(concat(before, silent(0.3, gapStart)));
    const inGap = readings.filter(
      ({ frame }) => frame.tMs - gapStart < 280 && frame.f0 === 0,
    );
    expect(inGap.length).toBeGreaterThan(5);
    for (const { reading } of inGap) {
      expect(reading?.held).toBe(true);
      expect(reading?.hz).toBeCloseTo(200, 6);
    }
  });

  it("shows nothing once the silence is longer than 300 ms", () => {
    const readings = run(concat(before, silent(1, gapStart)));
    const late = readings.filter(({ frame }) => frame.tMs - gapStart > 360);
    expect(late.length).toBeGreaterThan(20);
    expect(late.every(({ reading }) => reading === null)).toBe(true);
  });

  it("keeps smoothing across a gap shorter than 150 ms", () => {
    const frames = concat(
      before,
      silent(0.1, gapStart),
      steadyHz(0.2, shiftedHz(200, 2), gapStart + 100 + FRAME_MS),
    );
    const after = run(frames).filter(
      ({ frame }) => frame.f0 > 0 && frame.tMs > gapStart,
    );
    const shift = semitonesBetween(200, after[3]?.reading?.hz ?? 0);
    expect(shift).toBeGreaterThan(0.05);
    expect(shift).toBeLessThan(1.5);
  });

  it("starts fresh after 150 ms of silence, so a new note lands at once", () => {
    const resume = gapStart + 200;
    const frames = concat(
      before,
      silent(0.2, gapStart),
      steadyHz(0.2, shiftedHz(200, 2), resume),
    );
    const firstAfter = run(frames).find(
      ({ frame }) => frame.f0 > 0 && frame.tMs >= resume,
    );
    expect(firstAfter?.reading?.hz).toBeCloseTo(shiftedHz(200, 2), 6);
    expect(firstAfter?.reading?.held).toBe(false);
  });

  it("a new note after a long silence does not need three agreeing frames", () => {
    const resume = gapStart + 2000;
    const frames = concat(
      before,
      silent(2, gapStart),
      steadyHz(0.2, 330, resume),
    );
    const firstAfter = run(frames).find(
      ({ frame }) => frame.f0 > 0 && frame.tMs >= resume,
    );
    expect(firstAfter?.reading?.hz).toBeCloseTo(330, 6);
  });
});

describe("bad numbers", () => {
  it.each([Number.POSITIVE_INFINITY, Number.NaN, Number.NEGATIVE_INFINITY])(
    "a frame with f0 %s is not a pitch and does not poison what follows",
    (bad) => {
      const frames = concat(steadyHz(0.5, 200), [
        { tMs: 500, ...voiced(bad) },
        { tMs: 500 + FRAME_MS, ...voiced(200) },
        { tMs: 500 + 2 * FRAME_MS, ...voiced(200) },
      ]);
      for (const { reading } of run(frames)) {
        expect(reading?.hz).toBeCloseTo(200, 6);
      }
    },
  );
});

describe("a first frame that is not a number", () => {
  it.each([Number.POSITIVE_INFINITY, Number.NaN])(
    "f0 %s at the start shows nothing and the next real note lands",
    (bad) => {
      const frames = concat(
        [{ tMs: 0, ...voiced(bad) }],
        steadyHz(0.3, 200, FRAME_MS),
      );
      const readings = run(frames);
      expect(readings[0]?.reading).toBeNull();
      for (const { reading } of readings.slice(1)) {
        expect(reading?.hz).toBeCloseTo(200, 6);
      }
    },
  );
});

describe("display lag and shake", () => {
  const stepFrames = (semitones: number) =>
    concat(steadyHz(0.5, 200), steadyHz(1, shiftedHz(200, semitones), 500));

  it("a step of one semitone is within 20 cents of the new pitch inside 100 ms", () => {
    const after = run(stepFrames(1)).filter(
      ({ frame }) => frame.tMs >= 500 + 100,
    );
    const first = after[0]?.reading?.hz ?? 0;
    expect(Math.abs(semitonesBetween(shiftedHz(200, 1), first))).toBeLessThan(
      0.2,
    );
  });

  it("40 cents of random wobble in the raw pitch still shows as under 70 cents peak to peak", () => {
    const random = seededRandom(11);
    const wobble = stream(3, () =>
      voiced(shiftedHz(200, (random() * 2 - 1) * 0.4)),
    );
    const shown = run(wobble)
      .slice(10)
      .map(({ reading }) => semitonesBetween(200, reading?.hz ?? 0));
    expect(Math.max(...shown) - Math.min(...shown)).toBeLessThan(0.7);
  });
});

describe("reading at an index", () => {
  it("the first voiced frame shows its own pitch", () => {
    expect(hzAt(steadyHz(0.1, 173), 0)).toBeCloseTo(173, 6);
  });
});
