import { describe, expect, it } from "vitest";
import type { PitchFrame } from "./contract";
import { outcomeOf, scoreOf } from "./scoringTestKit";
import {
  archFrames,
  concat,
  endMs,
  hiss,
  shiftedHz,
  silent,
  sirenFrames,
  steadyHz,
  stream,
  voiced,
} from "./testFrames";

describe("steady (warm-up hum): stability only", () => {
  it("a steady hum scores 100 wherever it is", () => {
    expect(scoreOf("steady", steadyHz(10, 90))).toBe(100);
    expect(scoreOf("steady", steadyHz(10, 400))).toBe(100);
  });

  it("a hum that wanders by a few semitones scores low", () => {
    const frames = sirenFrames(150, 4, 2, 5);
    expect(scoreOf("steady", frames)).toBeLessThan(15);
  });

  it("a hum drifting by about 35 cents lands in the middle", () => {
    const frames = stream(10, (t) =>
      voiced(shiftedHz(200, 0.5 * Math.sin(t * 2 * Math.PI))),
    );
    const score = scoreOf("steady", frames);
    expect(score).toBeGreaterThan(40);
    expect(score).toBeLessThan(95);
  });
});

describe("sustained: in-band share times stability", () => {
  it("a steady note inside the band scores 100", () => {
    expect(scoreOf("sustained", steadyHz(10, 200))).toBe(100);
  });

  it("a wobbling note inside the band scores lower than a steady one", () => {
    const wobble = stream(10, (t) =>
      voiced(shiftedHz(200, 0.5 * Math.sin(t * 2 * Math.PI * 2))),
    );
    expect(scoreOf("sustained", wobble)).toBeLessThan(
      scoreOf("sustained", steadyHz(10, 200)) - 20,
    );
  });

  it("a steady note just under the band scores 0", () => {
    expect(scoreOf("sustained", steadyHz(10, 160))).toBe(0);
  });
});

describe("range: in-band share", () => {
  it("is the share of voiced time inside the target band", () => {
    const frames = concat(steadyHz(6, 200), steadyHz(4, 120, 6000));
    expect(scoreOf("range", frames)).toBeGreaterThan(55);
    expect(scoreOf("range", frames)).toBeLessThan(65);
  });

  it("does not credit silence in the band", () => {
    const voice = steadyHz(4, 120);
    const frames = concat(voice, silent(1, endMs(voice)));
    expect(scoreOf("range", frames)).toBe(0);
  });
});

describe("raise: share in the upper half of the band, not over the top", () => {
  it("scores 100 for a pitch in the upper half", () => {
    expect(scoreOf("raise", steadyHz(10, 230))).toBe(100);
  });

  it("scores 0 for a pitch in the lower half of the band", () => {
    expect(scoreOf("raise", steadyHz(10, 180))).toBe(0);
  });

  it("scores 0 just over targetMax", () => {
    expect(scoreOf("raise", steadyHz(10, 262))).toBe(0);
  });

  it("scores the share of time spent in the upper half", () => {
    const frames = concat(steadyHz(6, 230), steadyHz(4, 180, 6000));
    expect(scoreOf("raise", frames)).toBeGreaterThan(55);
    expect(scoreOf("raise", frames)).toBeLessThan(65);
  });
});

describe("glide: span, several sweeps, smooth movement", () => {
  it("three clean sweeps over 10 semitones score high", () => {
    expect(scoreOf("glide", sirenFrames(140, 10, 3, 4))).toBeGreaterThanOrEqual(
      90,
    );
  });

  it("a single sweep scores less than several", () => {
    const one = scoreOf("glide", sirenFrames(140, 10, 6, 1));
    const several = scoreOf("glide", sirenFrames(140, 10, 3, 4));
    expect(one).toBeLessThan(several - 10);
    expect(one).toBeGreaterThan(40);
  });

  it("sweeps over a small span score lower", () => {
    expect(scoreOf("glide", sirenFrames(140, 4, 3, 4))).toBeLessThan(60);
    expect(scoreOf("glide", sirenFrames(140, 4, 3, 4))).toBeGreaterThan(25);
  });

  it("movement too small to be a sweep scores nothing", () => {
    expect(scoreOf("glide", sirenFrames(140, 2, 3, 4))).toBeLessThan(10);
  });

  it("stepping between notes is not smooth and scores lower than gliding", () => {
    const steps = stream(12, (t) =>
      voiced(shiftedHz(140, 10 * (Math.floor(t / 1.5) % 2))),
    );
    expect(scoreOf("glide", steps)).toBeLessThan(
      scoreOf("glide", sirenFrames(140, 10, 3, 4)) - 20,
    );
  });
});

describe("mixed: as glide, plus few breaks", () => {
  it("clean sirens through the whole range score high", () => {
    expect(scoreOf("mixed", sirenFrames(140, 10, 3, 4))).toBeGreaterThanOrEqual(
      90,
    );
  });

  it("sirens that flip register again and again score lower than clean ones", () => {
    const flips = stream(12, (t) => {
      const base = (t / 3) % 2 < 1 ? (t / 3) % 1 : 1 - ((t / 3) % 1);
      const flip = Math.floor(t / 0.5) % 2 === 0 ? 0 : 4;
      return voiced(shiftedHz(140, 10 * base + flip));
    });
    expect(scoreOf("mixed", flips)).toBeLessThan(
      scoreOf("mixed", sirenFrames(140, 10, 3, 4)) - 25,
    );
  });
});

describe("mixed against glide: breaks count", () => {
  it("one register break in a minute costs mixed voice a quarter but costs glides nothing", () => {
    const withBreak = stream(60, (t) => {
      const phase = (t / 3) % 2;
      const up = phase < 1 ? phase : 2 - phase;
      return voiced(shiftedHz(140, 10 * up + (t > 30 ? 4 : 0)));
    });
    expect(scoreOf("glide", withBreak)).toBe(100);
    expect(scoreOf("mixed", withBreak)).toBe(75);
  });
});

describe("intonation: variation per phrase in a natural range", () => {
  const phrases = (count: number, make: (startMs: number) => PitchFrame[]) => {
    let frames: PitchFrame[] = [];
    for (let i = 0; i < count; i++) {
      const start = frames.length === 0 ? 0 : endMs(frames);
      const phrase = make(start);
      frames = concat(frames, phrase, silent(0.6, endMs(phrase)));
    }
    return frames;
  };

  it("short phrases that rise and fall score high", () => {
    expect(
      scoreOf(
        "intonation",
        phrases(5, (s) => archFrames(2, 170, 250, s)),
      ),
    ).toBeGreaterThanOrEqual(85);
  });

  it("flat phrases score low", () => {
    expect(
      scoreOf(
        "intonation",
        phrases(5, (s) => steadyHz(2, 190, s)),
      ),
    ).toBeLessThan(10);
  });

  it("a nearly flat voice with a semitone of movement scores low", () => {
    const frames = phrases(5, (s) =>
      archFrames(2, 190, 190 * 2 ** (0.5 / 12), s),
    );
    expect(scoreOf("intonation", frames)).toBeLessThan(30);
  });

  it("swings of two octaves in each phrase are not natural and score lower", () => {
    const wide = phrases(5, (s) => archFrames(2, 120, 480, s));
    expect(scoreOf("intonation", wide)).toBeLessThan(
      scoreOf(
        "intonation",
        phrases(5, (s) => archFrames(2, 170, 250, s)),
      ) - 20,
    );
  });

  it("a rise with no fall scores lower than a rise and a fall", () => {
    const rise = phrases(5, (s) =>
      stream(2, (t) => voiced(shiftedHz(170, 6 * (t / 2))), s),
    );
    const arch = phrases(5, (s) => archFrames(2, 170, 250, s));
    expect(scoreOf("intonation", rise)).toBeLessThan(
      scoreOf("intonation", arch),
    );
  });

  it("a slow drift of 4 semitones over 30 s is not expressive speech", () => {
    const drift = stream(30, (t) => voiced(shiftedHz(180, (4 * t) / 30)));
    expect(scoreOf("intonation", drift)).toBeLessThan(30);
  });

  it("is not fooled by long speech without pauses: a long monotone stays low", () => {
    expect(scoreOf("intonation", steadyHz(30, 190))).toBeLessThan(10);
  });
});

describe("breath: steadiness of level only, no pitch needed, never length", () => {
  it("a long steady hiss scores high", () => {
    expect(
      scoreOf(
        "breath",
        stream(20, () => hiss(0.05)),
      ),
    ).toBeGreaterThanOrEqual(90);
  });

  it("a short steady hiss scores the same as a long one: no contest to last longest", () => {
    const short = scoreOf(
      "breath",
      stream(4, () => hiss(0.05)),
    );
    const long = scoreOf(
      "breath",
      stream(40, () => hiss(0.05)),
    );
    expect(short).toBe(long);
    expect(short).toBeGreaterThanOrEqual(90);
  });

  it("a hiss that swells and fades scores less than a steady one", () => {
    const uneven = stream(20, (t) =>
      hiss(0.02 + 0.18 * (Math.sin(t * 2 * Math.PI * 0.5) + 1) * 0.5),
    );
    expect(scoreOf("breath", uneven)).toBeLessThan(
      scoreOf(
        "breath",
        stream(20, () => hiss(0.05)),
      ) - 40,
    );
  });

  it("silence in the middle does not count as sound", () => {
    const first = stream(4, () => hiss(0.05));
    const frames = concat(first, silent(12, endMs(first)));
    expect(outcomeOf("breath", frames).status).toBe("not_enough_voice");
  });
});

describe("articulation: pitch steadiness while reading", () => {
  it("steady reading scores high", () => {
    expect(scoreOf("articulation", steadyHz(10, 200))).toBe(100);
  });

  it("natural speech movement of a couple of semitones still scores well", () => {
    expect(
      scoreOf("articulation", sirenFrames(180, 3, 1.5, 6)),
    ).toBeGreaterThan(60);
  });

  it("pitch all over the place scores low", () => {
    expect(scoreOf("articulation", sirenFrames(120, 14, 1.5, 6))).toBeLessThan(
      40,
    );
  });
});
