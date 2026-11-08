import { describe, expect, it } from "vitest";
import type { PitchFrame } from "./contract";
import { SessionRecorder, VOLUME_GATE_RMS, pitchSummary } from "./session";
import { semitonesBetween } from "./statistics";
import {
  concat,
  endMs,
  framesBy,
  hiss,
  shiftedHz,
  silent,
  steadyHz,
  stream,
  voiced,
} from "./testFrames";

function record(
  frames: readonly PitchFrame[],
): ReturnType<SessionRecorder["snapshot"]> {
  const recorder = new SessionRecorder();
  for (const frame of frames) recorder.add(frame);
  return recorder.snapshot();
}

describe("time", () => {
  it("1 s of voice then 8.5 s of silence is 9.5 s elapsed and 1 s voiced", () => {
    const voice = steadyHz(1, 200);
    const data = record(concat(voice, silent(8.5, endMs(voice))));
    expect(data.elapsedS).toBeCloseTo(9.5, 1);
    expect(data.voicedS).toBeCloseTo(1, 1);
  });

  it("silence adds no pitch samples", () => {
    const voice = steadyHz(1, 200);
    const data = record(concat(voice, silent(8.5, endMs(voice))));
    expect(data.pitch).toHaveLength(steadyHz(1, 200).length);
    expect(data.pitch.every((p) => Math.abs(p.hz - 200) < 0.001)).toBe(true);
  });

  it("keeps every frame of a 60 s run: no 2000 frame cap, duration 60 s", () => {
    const data = record(steadyHz(60, 200));
    expect(data.pitch.length).toBeGreaterThan(2800);
    expect(data.elapsedS).toBeCloseTo(60, 1);
    expect(data.voicedS).toBeCloseTo(60, 1);
  });

  it("takes time from tMs, not from a frame length: 10 ms frames last 10 s per 1000 frames", () => {
    const frames = Array.from({ length: 1001 }, (_, i) => ({
      tMs: i * 10,
      ...voiced(180),
    }));
    const data = record(frames);
    expect(data.elapsedS).toBeCloseTo(10, 6);
    expect(data.voicedS).toBeCloseTo(10, 6);
  });

  it("does not count a long dropout between frames as voiced time", () => {
    const first = steadyHz(1, 200);
    const data = record(concat(first, steadyHz(1, 200, endMs(first) + 5000)));
    expect(data.elapsedS).toBeGreaterThan(6.9);
    expect(data.elapsedS).toBeLessThan(7.1);
    expect(data.voicedS).toBeGreaterThan(1.85);
    expect(data.voicedS).toBeLessThan(2.01);
  });

  it("starts the clock at the first frame, whatever the stream time was", () => {
    const data = record(steadyHz(2, 200, 90_000));
    expect(data.elapsedS).toBeCloseTo(2, 1);
  });
});

describe("what counts as voice", () => {
  it("a pitch below the volume gate is not voiced", () => {
    const quiet = stream(5, () => ({
      f0: 75.9,
      rms: VOLUME_GATE_RMS / 3,
      peak: 0.002,
      centroid: 300,
    }));
    const data = record(quiet);
    expect(data.voicedS).toBe(0);
    expect(data.pitch).toHaveLength(0);
  });

  it("a hiss counts as sound time but not as voiced time or pitch", () => {
    const data = record(stream(4, () => hiss(0.05)));
    expect(data.soundS).toBeCloseTo(4, 1);
    expect(data.voicedS).toBe(0);
    expect(data.pitch).toHaveLength(0);
    expect(data.soundRms.length).toBeGreaterThan(150);
  });

  it("silence is not sound time", () => {
    expect(record(silent(5)).soundS).toBe(0);
  });

  it("pitch held on screen after the voice stops is never recorded", () => {
    const voice = steadyHz(0.5, 200);
    const data = record(concat(voice, silent(0.25, endMs(voice))));
    expect(data.pitch).toHaveLength(voice.length);
  });

  it("a one-frame octave slip is not recorded as pitch", () => {
    const data = record(
      stream(1, (t) => voiced(t > 0.5 && t < 0.52 ? 400 : 200)),
    );
    expect(Math.max(...data.pitch.map((p) => p.hz))).toBeLessThan(201);
  });

  it("collects centroids only from voiced frames", () => {
    const data = record(
      concat(
        steadyHz(1, 200),
        stream(1, () => hiss(0.05), 1100),
      ),
    );
    expect(data.centroids.length).toBe(data.pitch.length);
    expect(data.centroids.every((c) => c === 1800)).toBe(true);
  });
});

describe("bad frames", () => {
  it("ignores frames that go back in time or are not numbers", () => {
    const good = steadyHz(1, 200);
    const bad: PitchFrame[] = [
      { tMs: endMs(good) - 100, ...voiced(900) },
      { tMs: Number.NaN, ...voiced(900) },
      { tMs: endMs(good), ...voiced(Number.NaN) },
    ];
    const data = record(concat(good, bad));
    expect(data.pitch).toHaveLength(good.length);
    expect(data.elapsedS).toBeCloseTo(1, 1);
  });

  it("an empty session has nothing", () => {
    const data = record([]);
    expect(data).toMatchObject({ elapsedS: 0, voicedS: 0, soundS: 0 });
    expect(data.pitch).toHaveLength(0);
  });
});

describe("a stream that restarts", () => {
  it("keeps counting after tMs goes back to zero", () => {
    const first = steadyHz(3, 200);
    const data = record(concat(first, steadyHz(3, 200)));
    expect(data.voicedS).toBeGreaterThan(5.5);
    expect(data.elapsedS).toBeGreaterThan(6);
    expect(data.pitch.length).toBeGreaterThan(2 * first.length - 10);
    expect(data.pitch[data.pitch.length - 1]?.tS).toBeCloseTo(data.elapsedS, 1);
  });

  it("does not credit the time lost in the restart", () => {
    const data = record(concat(steadyHz(1, 200), steadyHz(1, 200)));
    expect(data.voicedS).toBeLessThan(2.01);
    expect(data.elapsedS).toBeGreaterThan(data.voicedS);
  });

  it("can restart more than once", () => {
    const data = record(
      concat(steadyHz(2, 200), steadyHz(2, 200), steadyHz(2, 200)),
    );
    expect(data.voicedS).toBeGreaterThan(5.5);
  });

  it("a frame that is only a little late is still dropped, not taken as a restart", () => {
    const good = steadyHz(2, 200);
    const late: PitchFrame = { tMs: endMs(good) - 120, ...voiced(200) };
    const data = record(concat(good, [late]));
    expect(data.pitch).toHaveLength(good.length);
  });
});

describe("what the score reads", () => {
  it("is the raw pitch, median of three: the smoothing of the display never reaches it", () => {
    const frames = concat(
      steadyHz(1, 200),
      steadyHz(1, shiftedHz(200, 2.5), 1000),
    );
    const step = record(frames).pitch.filter((p) => p.tS > 0.9 && p.tS < 1.2);
    const jumps = step.filter(
      (p, i) =>
        i > 0 && Math.abs(semitonesBetween(step[i - 1]?.hz ?? 0, p.hz)) > 2,
    );
    expect(jumps).toHaveLength(1);
  });

  it("counts the frames the display turned away", () => {
    const slips = framesBy(5, (i) => voiced(i % 10 === 5 ? 400 : 200));
    const data = record(slips);
    expect(data.rejectedShare).toBeGreaterThan(0.08);
    expect(data.rejectedShare).toBeLessThan(0.12);
  });

  it("counts nothing on a clean hum", () => {
    expect(record(steadyHz(3, 200)).rejectedShare).toBe(0);
  });

  it("a quiet frame the gate ignores is not counted as rejected", () => {
    const quiet = framesBy(3, (i) => ({
      ...voiced(i % 2 ? 400 : 200),
      rms: VOLUME_GATE_RMS / 2,
    }));
    expect(record(quiet).rejectedShare).toBe(0);
  });
});

describe("snapshots", () => {
  it("a snapshot does not change when more frames arrive", () => {
    const recorder = new SessionRecorder();
    for (const frame of steadyHz(1, 200)) recorder.add(frame);
    const before = recorder.snapshot();
    const count = before.pitch.length;
    for (const frame of steadyHz(1, 200, 2000)) recorder.add(frame);
    expect(before.pitch).toHaveLength(count);
    expect(recorder.snapshot().pitch.length).toBeGreaterThan(count);
  });
});

describe("pitchSummary", () => {
  it("gives the mean and standard deviation in Hz", () => {
    const frames = stream(2, (t) => voiced(t < 1 ? 100 : 110));
    const { mean, sd } = pitchSummary(record(frames));
    expect(mean).toBeGreaterThan(100);
    expect(mean).toBeLessThan(110);
    expect(sd).toBeGreaterThan(3);
    expect(sd).toBeLessThan(6);
  });

  it("is zeros with no pitch", () => {
    expect(pitchSummary(record(silent(2)))).toEqual({ mean: 0, sd: 0 });
  });
});
