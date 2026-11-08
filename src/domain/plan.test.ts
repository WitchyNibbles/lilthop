import { describe, expect, it } from "vitest";
import { EXERCISES } from "./exercises";
import { GOAL_IDS, dailyPlan, isGoalId } from "./plan";
import { MESSAGES } from "../i18n";

describe("dailyPlan", () => {
  it("is empty with no goals, at any hour", () => {
    expect(dailyPlan([], 9)).toEqual([]);
    expect(dailyPlan([], 20)).toEqual([]);
  });

  it("ignores goals it does not know", () => {
    expect(dailyPlan(["nonsense"], 14)).toEqual([]);
  });

  it("maps goals to exercises in the order of the goals, without repeats", () => {
    expect(dailyPlan(["stability", "pitch", "stability"], 14)).toEqual([
      "sustained_tone",
      "pitch_awareness",
      "pitch_raising",
    ]);
  });

  it("starts the morning with the hum warm-up, once", () => {
    expect(dailyPlan(["stability"], 8)).toEqual([
      "warmup_hum",
      "sustained_tone",
    ]);
  });

  it("the pitch goal plans awareness then raising", () => {
    expect(dailyPlan(["pitch"], 14)).toEqual([
      "pitch_awareness",
      "pitch_raising",
    ]);
  });

  it("the resonance goal plans the forward hum then forward vowels", () => {
    expect(dailyPlan(["resonance"], 14)).toEqual([
      "resonance",
      "forward_vowels",
    ]);
  });

  it("never plans anything that lowers the pitch", () => {
    for (const hour of [8, 14, 20])
      for (const id of dailyPlan([...GOAL_IDS], hour))
        expect(id).not.toMatch(/lower|bajar/i);
  });

  it("never plans more than four exercises", () => {
    expect(
      dailyPlan(
        ["pitch", "stability", "resonance", "range", "intonation", "endurance"],
        8,
      ),
    ).toEqual([
      "warmup_hum",
      "pitch_awareness",
      "pitch_raising",
      "sustained_tone",
    ]);
    expect(
      dailyPlan(
        ["pitch", "stability", "resonance", "range", "intonation", "endurance"],
        14,
      ),
    ).toEqual([
      "pitch_awareness",
      "pitch_raising",
      "sustained_tone",
      "resonance",
    ]);
  });
});

describe("goals", () => {
  it("knows its goal ids and has a label for each", () => {
    expect(isGoalId("pitch")).toBe(true);
    expect(isGoalId("other")).toBe(false);
    for (const id of GOAL_IDS) expect(MESSAGES.en[`goal.${id}`]).toBeTruthy();
  });

  it("only maps goals to exercises that exist", () => {
    const ids = new Set(EXERCISES.map((e) => e.id));
    for (const goal of GOAL_IDS) {
      for (const id of dailyPlan([goal], 14)) expect(ids.has(id)).toBe(true);
    }
  });
});
