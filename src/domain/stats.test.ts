import { describe, expect, it } from "vitest";
import type { SavedResult } from "./contract";
import * as stats from "./stats";
import { practiceDays, totals, trend } from "./stats";

const DAY = 86_400;
const NOON = Math.floor(new Date(2026, 10, 6, 12, 0, 0).getTime() / 1000);
const TODAY = new Date(2026, 10, 6, 15, 30);

let nextId = 1;
function result(overrides: Partial<SavedResult> = {}): SavedResult {
  const id = nextId++;
  return {
    id,
    createdAt: NOON,
    exerciseId: "pitch_awareness",
    score: 50,
    pitchMean: 180,
    pitchSd: 5,
    durationS: 60,
    voicedS: 40,
    scoringVersion: 2,
    ...overrides,
  };
}

/** Scores in the order they happened, one per day, ending today. */
function history(
  scores: readonly number[],
  overrides: Partial<SavedResult> = {},
): SavedResult[] {
  return scores.map((score, i) =>
    result({
      score,
      createdAt: NOON - (scores.length - 1 - i) * DAY,
      ...overrides,
    }),
  );
}

describe("trend", () => {
  it("someone improving from 10 to 100 goes up, whatever order the list comes in", () => {
    const scores = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const chronological = history(scores);
    const newestFirst = [...chronological].reverse();
    expect(trend(newestFirst).direction).toBe("up");
    expect(trend(chronological).direction).toBe("up");
    expect(trend(newestFirst).delta).toBeCloseTo(50);
  });

  it("someone getting worse goes down", () => {
    expect(trend(history([90, 80, 70, 30, 20, 10])).direction).toBe("down");
  });

  it("a change under 3 points is flat", () => {
    expect(trend(history([50, 51, 50, 52])).direction).toBe("flat");
  });

  it("compares the first half with the second half", () => {
    const { delta } = trend(history([10, 30, 60, 80]));
    expect(delta).toBeCloseTo(50);
  });

  it("needs four sessions before it says anything", () => {
    expect(trend(history([10, 90, 95])).direction).toBe("unknown");
    expect(trend([]).direction).toBe("unknown");
  });

  it("leaves out results from the old scoring", () => {
    const old = history([100, 100, 100, 100], { scoringVersion: 0 });
    const current = history([20, 20, 20, 20]);
    expect(trend([...old, ...current])).toEqual({
      direction: "flat",
      delta: 0,
    });
    expect(trend(old).direction).toBe("unknown");
  });
});

describe("practiceDays: the moon strip", () => {
  const onDay = (daysAgo: number, overrides: Partial<SavedResult> = {}) =>
    result({ createdAt: NOON - daysAgo * DAY, ...overrides });

  it("lists the last N days oldest first, today last", () => {
    const strip = practiceDays([onDay(0), onDay(2)], 5, TODAY);
    expect(strip.map((d) => d.daysAgo)).toEqual([4, 3, 2, 1, 0]);
    expect(strip.map((d) => d.practised)).toEqual([
      false,
      false,
      true,
      false,
      true,
    ]);
  });

  it("counts two sessions on one day as one day", () => {
    const strip = practiceDays([onDay(0), onDay(0)], 3, TODAY);
    expect(strip.filter((d) => d.practised)).toHaveLength(1);
  });

  it("a gap is just an empty day: older practice still shows", () => {
    const strip = practiceDays([onDay(6), onDay(5), onDay(1)], 7, TODAY);
    expect(strip.filter((d) => d.practised).map((d) => d.daysAgo)).toEqual([
      6, 5, 1,
    ]);
  });

  it("counts results of any scoring version", () => {
    const strip = practiceDays([onDay(0, { scoringVersion: 0 })], 1, TODAY);
    expect(strip[0]?.practised).toBe(true);
  });

  it("is all empty with no results, and empty for zero days", () => {
    expect(practiceDays([], 4, TODAY).every((d) => !d.practised)).toBe(true);
    expect(practiceDays([onDay(0)], 0, TODAY)).toEqual([]);
  });

  it("there is no streak to lose", () => {
    expect(stats).not.toHaveProperty("streak");
  });
});

describe("totals", () => {
  it("count every row, with no cap at 200", () => {
    const rows = Array.from({ length: 500 }, () => result({ durationS: 30 }));
    const all = totals(rows);
    expect(all.sessions).toBe(500);
    expect(all.totalDurationS).toBe(15_000);
  });

  it("group by exercise and average only the current scoring", () => {
    const all = totals([
      result({ exerciseId: "glides", score: 40 }),
      result({ exerciseId: "glides", score: 60 }),
      result({ exerciseId: "glides", score: 100, scoringVersion: 0 }),
      result({ exerciseId: "breath", score: 100, scoringVersion: 0 }),
    ]);
    expect(all.byExercise["glides"]).toEqual({ sessions: 3, averageScore: 50 });
    expect(all.byExercise["breath"]).toEqual({
      sessions: 1,
      averageScore: null,
    });
  });

  it("are zero for nothing", () => {
    expect(totals([])).toEqual({
      sessions: 0,
      totalDurationS: 0,
      byExercise: {},
    });
  });
});

describe("practice rows with no score (brightness)", () => {
  const unscored = (overrides: Partial<SavedResult> = {}) =>
    result({ score: null, exerciseId: "resonance", ...overrides });

  it("a day with only an unscored session still counts as practised", () => {
    const days = practiceDays([unscored()], 3, TODAY);
    expect(days.map((d) => d.practised)).toEqual([false, false, true]);
  });

  it("the trend ignores unscored rows instead of reading them as zero", () => {
    const scored = history([50, 50, 50, 50]);
    const extra = [0, 1, 2, 3].map((i) =>
      unscored({ createdAt: NOON - i * DAY }),
    );
    expect(trend([...scored, ...extra])).toEqual(trend(scored));
  });

  it("four unscored rows are not enough sessions for a trend", () => {
    const rows = history([1, 2, 3, 4]).map((r) => ({ ...r, score: null }));
    expect(trend(rows).direction).toBe("unknown");
  });

  it("averages skip unscored rows but sessions count them", () => {
    const rows = [
      result({ exerciseId: "resonance", score: 80 }),
      unscored(),
      unscored(),
    ];
    expect(totals(rows).byExercise.resonance).toEqual({
      sessions: 3,
      averageScore: 80,
    });
    expect(totals(rows).sessions).toBe(3);
  });

  it("an exercise with only unscored rows has no average", () => {
    expect(totals([unscored(), unscored()]).byExercise.resonance).toEqual({
      sessions: 2,
      averageScore: null,
    });
  });
});
