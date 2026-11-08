import { describe, expect, it } from "vitest";
import { SCORING_VERSION, buildNewResult, scoreSession } from "./scoring";
import { CONTEXT, outcomeOf, scoreOf } from "./scoringTestKit";
import {
  concat,
  endMs,
  hiss,
  recordFrames,
  silent,
  steadyHz,
  stream,
  voiced,
} from "./testFrames";

describe("the audit's table: scores that were gamed or missed the point", () => {
  it("Sustained Tone, steady 90 Hz far below the 165-255 band, is not 100", () => {
    expect(scoreOf("sustained", steadyHz(10, 90))).toBeLessThan(5);
  });

  it("Pitch Raising, a 400 Hz squeak the whole time, is not 100", () => {
    expect(scoreOf("raise", steadyHz(10, 400))).toBeLessThan(5);
  });

  it("Glides, flat 180 Hz plus one 275 Hz glitch, scores low (through the tracker)", () => {
    const frames = stream(30, (t) => voiced(t > 15 && t < 15.02 ? 275 : 180));
    expect(scoreOf("glide", frames)).toBeLessThan(10);
  });

  it("Glides, flat 180 Hz plus one 275 Hz glitch, scores low (glitch forced into the data)", () => {
    const base = recordFrames(steadyHz(30, 180));
    const points = base.pitch.map((p, i) =>
      i === 700 ? { ...p, hz: 275 } : p,
    );
    const outcome = scoreSession("glide", { ...base, pitch: points }, CONTEXT);
    expect(outcome.status === "scored" ? outcome.score : 100).toBeLessThan(10);
  });

  it("Mixed Voice, one held note wobbling 1 Hz, scores low", () => {
    const frames = stream(30, (t) => voiced(180 + (Math.round(t * 47) % 2)));
    expect(scoreOf("mixed", frames)).toBeLessThan(10);
  });

  it("Intonation, a textbook rise and fall with 1 Hz jitter, scores high", () => {
    const frames = stream(6.4, (t) =>
      voiced(
        170 +
          80 * Math.sin((Math.PI * t) / 6.4) +
          (Math.round(t * 47) % 2 ? 1 : -1),
      ),
    );
    expect(scoreOf("intonation", frames)).toBeGreaterThanOrEqual(80);
  });

  it("Intonation, one flat pitch, scores low", () => {
    expect(scoreOf("intonation", steadyHz(8, 180))).toBeLessThan(10);
  });

  it("Breath, a hiss with no pitch, is scored instead of thrown away", () => {
    const outcome = outcomeOf(
      "breath",
      stream(20, () => hiss(0.05)),
    );
    expect(outcome.status).toBe("scored");
    expect(
      outcome.status === "scored" ? outcome.score : 0,
    ).toBeGreaterThanOrEqual(90);
  });

  it("Sustained Tone, 1 s of voice then 8.5 s of silence, is not enough voice and not 100", () => {
    const voice = steadyHz(1, 200);
    const outcome = outcomeOf(
      "sustained",
      concat(voice, silent(8.5, endMs(voice))),
    );
    expect(outcome.status).toBe("not_enough_voice");
    expect(
      outcome.status === "not_enough_voice" ? outcome.voicedS : 0,
    ).toBeCloseTo(1, 1);
  });
});

describe("enough voice", () => {
  const withVoice = (voiceS: number, totalS: number) => {
    const voice = steadyHz(voiceS, 200);
    return concat(voice, silent(totalS - voiceS, endMs(voice)));
  };

  it("needs at least 3 s of voice even when that is most of the session", () => {
    expect(outcomeOf("range", withVoice(2.8, 3.5)).status).toBe(
      "not_enough_voice",
    );
    expect(outcomeOf("range", withVoice(3.2, 3.5)).status).toBe("scored");
  });

  it("needs voice for at least 30% of the elapsed time", () => {
    expect(outcomeOf("range", withVoice(3.4, 12)).status).toBe(
      "not_enough_voice",
    );
    expect(outcomeOf("range", withVoice(3.4, 10)).status).toBe("scored");
  });

  it("never scores an empty session", () => {
    expect(scoreSession("range", recordFrames([]), CONTEXT).status).toBe(
      "not_enough_voice",
    );
  });

  it("breath needs sound, not pitch: 2 s of hiss is not enough, voice alone is not breath", () => {
    expect(
      outcomeOf(
        "breath",
        stream(2, () => hiss(0.05)),
      ).status,
    ).toBe("not_enough_voice");
    expect(
      outcomeOf(
        "breath",
        stream(10, () => hiss(0.05)),
      ).status,
    ).toBe("scored");
  });
});

describe("context", () => {
  it("rejects a band that is not a band", () => {
    const data = recordFrames(steadyHz(5, 200));
    expect(() =>
      scoreSession("range", data, { ...CONTEXT, targetMinHz: 300 }),
    ).toThrow(RangeError);
    expect(() =>
      scoreSession("range", data, { ...CONTEXT, targetMaxHz: 165 }),
    ).toThrow(RangeError);
  });
});

describe("brightness is practice only: nothing rewards a brighter sound", () => {
  const bright = (centroid: number, seconds = 10) =>
    stream(seconds, () => voiced(200, centroid));

  it("is never scored, however bright or dull", () => {
    for (const centroid of [800, 2000, 4500]) {
      const outcome = outcomeOf("brightness", bright(centroid));
      expect(outcome.status).toBe("practice_only");
      expect(outcome).not.toHaveProperty("score");
    }
  });

  it("reports the brightness as information: the median centroid of voiced frames", () => {
    const outcome = outcomeOf("brightness", bright(2400));
    expect(outcome).toMatchObject({ medianCentroidHz: 2400 });
    expect(
      outcome.status === "practice_only" ? outcome.voicedS : 0,
    ).toBeCloseTo(10, 1);
  });

  it("hiss does not move the brightness, only voiced frames count", () => {
    const voice = bright(1800, 5);
    const frames = concat(
      voice,
      stream(5, () => hiss(0.05), endMs(voice)),
    );
    expect(outcomeOf("brightness", frames)).toMatchObject({
      medianCentroidHz: 1800,
    });
  });

  it("still needs voice to say anything", () => {
    expect(outcomeOf("brightness", bright(2000, 1)).status).toBe(
      "not_enough_voice",
    );
  });

  it("saves a row with no score, so the day still counts as practice", () => {
    const data = recordFrames(bright(2000));
    const outcome = scoreSession("brightness", data, CONTEXT);
    const result = buildNewResult("resonance", data, outcome);
    expect(result).toMatchObject({
      exerciseId: "resonance",
      score: null,
      scoringVersion: SCORING_VERSION,
    });
    expect(result?.voicedS).toBeCloseTo(10, 1);
    expect(result?.durationS).toBeCloseTo(10, 0);
  });

  it("saves 0 for pitch mean and spread when there is no pitch", () => {
    const data = recordFrames(bright(2000));
    const outcome = scoreSession("brightness", data, CONTEXT);
    const result = buildNewResult("resonance", { ...data, pitch: [] }, outcome);
    expect(result).toMatchObject({ score: null, pitchMean: 0, pitchSd: 0 });
  });
});

describe("buildNewResult", () => {
  it("keeps what the score was built from and the scoring version", () => {
    const data = recordFrames(concat(steadyHz(4, 200), silent(2, 4000)));
    const outcome = scoreSession("range", data, CONTEXT);
    const result = buildNewResult("pitch_awareness", data, outcome);
    expect(result).toMatchObject({
      exerciseId: "pitch_awareness",
      score: 100,
      scoringVersion: SCORING_VERSION,
    });
    expect(result?.pitchMean).toBeCloseTo(200, 3);
    expect(result?.pitchSd).toBeCloseTo(0, 3);
    expect(result?.durationS).toBeCloseTo(6, 0);
    expect(result?.voicedS).toBeCloseTo(4, 1);
  });

  it("returns nothing to save when there was not enough voice", () => {
    const data = recordFrames(steadyHz(1, 200));
    expect(
      buildNewResult(
        "pitch_awareness",
        data,
        scoreSession("range", data, CONTEXT),
      ),
    ).toBeNull();
  });

  it("scoring version is 2", () => {
    expect(SCORING_VERSION).toBe(2);
  });
});
