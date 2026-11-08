// The score reads the raw pitch (median only), never the smoothed display value.
import type { PitchFrame } from "./contract";
import { describe, expect, it } from "vitest";
import { scoreSession } from "./scoring";
import { CONTEXT, scoreOf } from "./scoringTestKit";
import {
  concat,
  endMs,
  framesBy,
  recordFrames,
  seededRandom,
  shiftedHz,
  silent,
  stream,
  voiced,
} from "./testFrames";

describe("steadiness reads the raw pitch", () => {
  it("random wobble of 60 cents either way is not a steady hum", () => {
    const random = seededRandom(7);
    const wobble = stream(10, () =>
      voiced(shiftedHz(200, (random() * 2 - 1) * 0.6)),
    );
    expect(scoreOf("steady", wobble)).toBeLessThan(80);
    expect(scoreOf("sustained", wobble)).toBeLessThan(80);
  });

  it("a note that flips by 5 semitones every second frame is not steady", () => {
    const flips = framesBy(10, (i) =>
      voiced(shiftedHz(200, i % 4 < 2 ? 0 : 5)),
    );
    expect(scoreOf("steady", flips)).toBeLessThan(20);
    expect(scoreOf("sustained", flips)).toBeLessThan(20);
  });

  it("a note that flips by 12 semitones every third frame is not steady", () => {
    const flips = framesBy(10, (i) =>
      voiced(shiftedHz(200, i % 6 < 3 ? 0 : 12)),
    );
    expect(scoreOf("steady", flips)).toBeLessThan(20);
    expect(scoreOf("sustained", flips)).toBeLessThan(20);
  });

  it("a note that flips by 12 semitones every second frame is not steady", () => {
    const flips = framesBy(10, (i) =>
      voiced(shiftedHz(200, i % 4 < 2 ? 0 : 12)),
    );
    expect(scoreOf("steady", flips)).toBeLessThan(20);
    expect(scoreOf("articulation", flips)).toBeLessThan(40);
  });

  it("an octave slip every seventh frame costs steadiness even though each slip is a single frame", () => {
    const slips = framesBy(10, (i) => voiced(i % 7 === 3 ? 400 : 200));
    expect(scoreOf("steady", slips)).toBeLessThan(80);
    expect(scoreOf("steady", slips)).toBeGreaterThan(30);
  });

  it("one glitch in ten seconds costs next to nothing", () => {
    const glitch = framesBy(10, (i) => voiced(i === 200 ? 400 : 200));
    expect(scoreOf("steady", glitch)).toBeGreaterThanOrEqual(95);
  });
});

describe("jumps are seen at their real size", () => {
  const withStep = (semitones: number) =>
    stream(60, (t) => {
      const phase = (t / 3) % 2;
      const up = phase < 1 ? phase : 2 - phase;
      return voiced(shiftedHz(140, 10 * up + (t > 30 ? semitones : 0)));
    });

  it.each([1.6, 2, 2.5, 2.9])(
    "an instant step of %s semitones is one break in mixed voice",
    (semitones) => {
      expect(scoreOf("glide", withStep(semitones))).toBe(100);
      expect(scoreOf("mixed", withStep(semitones))).toBe(75);
    },
  );

  it("a step of one semitone is not a break", () => {
    expect(scoreOf("mixed", withStep(1))).toBe(100);
  });
});

describe("glide and mixed need sweeps inside one breath of voice", () => {
  const notes = (semitones: readonly number[], noteS: number, pauseS: number) =>
    semitones.reduce((frames, st) => {
      const start = frames.length === 0 ? 0 : endMs(frames);
      const note = stream(noteS, () => voiced(shiftedHz(140, st)), start);
      return concat(frames, note, silent(pauseS, endMs(note)));
    }, [] as PitchFrame[]);
  const scale = [0, 1, 2, 3, 4, 5, 6, 7, 8, 7, 6, 5, 4, 3, 2, 1, 0];

  it("17 short notes across 9 semitones with pauses between are not a glide", () => {
    const frames = notes(scale, 0.3, 0.2);
    expect(scoreOf("glide", frames)).toBeLessThan(20);
    expect(scoreOf("mixed", frames)).toBeLessThan(20);
  });

  it("hopping between two notes with pauses between is not a glide and counts breaks", () => {
    const hops = notes([0, 6, 0, 6, 0, 6, 0, 6, 0, 6, 0, 6, 0, 6], 0.4, 0.2);
    expect(scoreOf("glide", hops)).toBeLessThan(20);
    expect(scoreOf("mixed", hops)).toBeLessThan(10);
  });

  const threeSirens = (pauseS: number) => {
    const siren = (start: number) =>
      stream(3, (t) => voiced(shiftedHz(140, 10 * Math.min(1, t / 3))), start);
    let frames = siren(0);
    for (let i = 0; i < 2; i++) {
      const pause = silent(pauseS, endMs(frames));
      frames = concat(frames, pause, siren(endMs(pause)));
    }
    return frames;
  };

  it("three sirens with a breath between them still score high", () => {
    expect(scoreOf("glide", threeSirens(0.7))).toBeGreaterThanOrEqual(90);
    expect(scoreOf("mixed", threeSirens(0.7))).toBeGreaterThanOrEqual(90);
  });

  it("the same sirens restarting after only a hair of a pause are breaks", () => {
    expect(scoreOf("mixed", threeSirens(0.2))).toBeLessThan(
      scoreOf("mixed", threeSirens(0.7)) - 40,
    );
  });
});

describe("intonation counts speech-rate movement only", () => {
  const oscillation = (hz: number) =>
    stream(2, (t) =>
      voiced(shiftedHz(180, 3 * Math.sin(2 * Math.PI * hz * t))),
    );
  const phrases = (make: () => PitchFrame[]) => {
    let frames = make();
    for (let i = 0; i < 4; i++) {
      const start = endMs(frames) + 600;
      frames = concat(
        frames,
        silent(0.6, endMs(frames)),
        shiftedFrom(make(), start),
      );
    }
    return frames;
  };
  const shiftedFrom = (frames: PitchFrame[], start: number) =>
    frames.map((f) => ({ ...f, tMs: f.tMs + start }));

  it("plus and minus 3 semitones twice a second is a wobble, not intonation", () => {
    expect(
      scoreOf(
        "intonation",
        phrases(() => oscillation(2)),
      ),
    ).toBeLessThan(25);
  });

  it("the same swing once a second is still fine", () => {
    expect(
      scoreOf(
        "intonation",
        phrases(() => oscillation(0.5)),
      ),
    ).toBeGreaterThanOrEqual(70);
  });
});

describe("breath needs a level clearly above the noise floor", () => {
  it("steady noise just over the volume gate is not a breath", () => {
    expect(
      scoreOf(
        "breath",
        stream(6, () => ({ f0: 0, rms: 0.0035, peak: 0.01, centroid: 4000 })),
      ),
    ).toBeLessThan(10);
  });

  it("a normal exhale is fine", () => {
    expect(
      scoreOf(
        "breath",
        stream(6, () => ({ f0: 0, rms: 0.02, peak: 0.08, centroid: 4000 })),
      ),
    ).toBeGreaterThanOrEqual(90);
  });

  it("uses the person's own calibration level when there is one", () => {
    const exhale = stream(6, () => ({
      f0: 0,
      rms: 0.02,
      peak: 0.08,
      centroid: 4000,
    }));
    const quietForThem = scoreSession("breath", recordFrames(exhale), {
      ...CONTEXT,
      baselineRms: 0.5,
    });
    expect(
      quietForThem.status === "scored" ? quietForThem.score : 100,
    ).toBeLessThan(40);
    expect(scoreOf("breath", exhale)).toBeGreaterThanOrEqual(90);
  });
});
