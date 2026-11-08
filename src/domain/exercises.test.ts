import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  EXERCISES,
  exercisesIn,
  findExercise,
  showsPitch,
} from "./exercises";
import { MEASURE_RULES } from "./measures";
import { MESSAGES } from "../i18n";

describe("exercises", () => {
  it("has the 13 exercises, each id once, each in a known category", () => {
    expect(EXERCISES).toHaveLength(13);
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(13);
    for (const exercise of EXERCISES) {
      expect(CATEGORIES).toContain(exercise.category);
    }
  });

  it("every measure is either scored by a rule or is brightness, which is never scored", () => {
    for (const { measure } of EXERCISES) {
      expect(measure === "brightness" || measure in MEASURE_RULES).toBe(true);
    }
    expect(findExercise("resonance")?.measure).toBe("brightness");
    expect("brightness" in MEASURE_RULES).toBe(false);
  });

  it("only breath work has no pitch readout", () => {
    expect(showsPitch("breath")).toBe(false);
    for (const { measure } of EXERCISES) {
      expect(showsPitch(measure)).toBe(measure !== "breath");
    }
  });

  it("finds exercises by id and by category", () => {
    expect(findExercise("glides")?.category).toBe("range");
    expect(findExercise("nope")).toBeUndefined();
    expect(exercisesIn("warmup")).toHaveLength(3);
    expect(exercisesIn("resonance")).toHaveLength(2);
  });

  it("only ever goes up: nothing lowers the pitch, and raising is there", () => {
    for (const { id } of EXERCISES) {
      expect(id).not.toMatch(/lower|bajar/i);
      for (const language of ["en", "es"] as const)
        expect(MESSAGES[language][`exercise.${id}.name`]).not.toMatch(
          /lower|bajar/i,
        );
    }
    expect(findExercise("pitch_raising")?.measure).toBe("raise");
  });

  it("has forward vowels as resonance practice, shown as brightness and never scored", () => {
    expect(findExercise("forward_vowels")).toEqual({
      id: "forward_vowels",
      category: "resonance",
      measure: "brightness",
      durationS: 60,
    });
  });
});

describe("metronome", () => {
  it("only paced exercises have a beat, and it is in the tempo range", () => {
    const paced = EXERCISES.filter((e) => e.metronomeBpm !== undefined);
    expect(paced.map((e) => e.id)).toEqual([
      "warmup_liptrill",
      "glides",
      "articulation",
    ]);
    for (const exercise of paced) {
      expect(exercise.metronomeBpm).toBeGreaterThanOrEqual(30);
      expect(exercise.metronomeBpm).toBeLessThanOrEqual(240);
    }
  });
});
