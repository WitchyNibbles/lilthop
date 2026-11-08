import { describe, expect, it } from "vitest";
import { savedResult } from "../test/fakeBackend";
import { chartMarks, practisedExercises, sessionsOf } from "./sessionChartData";

const DAY = 86_400;
const FRAME = {
  width: 400,
  height: 200,
  left: 30,
  right: 10,
  top: 10,
  bottom: 20,
};

describe("sessionsOf", () => {
  it("keeps one exercise, oldest first", () => {
    const rows = sessionsOf(
      [
        savedResult({ id: 2, exerciseId: "glides", createdAt: 2 * DAY }),
        savedResult({ id: 3, exerciseId: "other", createdAt: 3 * DAY }),
        savedResult({ id: 1, exerciseId: "glides", createdAt: DAY }),
      ],
      "glides",
    );
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
  });
});

describe("practisedExercises", () => {
  it("lists each exercise once, the latest first", () => {
    expect(
      practisedExercises([
        savedResult({ exerciseId: "a", createdAt: DAY }),
        savedResult({ exerciseId: "b", createdAt: 3 * DAY }),
        savedResult({ exerciseId: "a", createdAt: 2 * DAY }),
      ]),
    ).toEqual(["b", "a"]);
  });
});

describe("chartMarks", () => {
  const rows = [
    savedResult({ id: 1, score: 40, scoringVersion: 1, createdAt: DAY }),
    savedResult({ id: 2, score: 100, createdAt: 2 * DAY }),
    savedResult({ id: 3, score: null, createdAt: 3 * DAY }),
    savedResult({ id: 4, score: 0, createdAt: 4 * DAY }),
  ];

  it("names what each session is", () => {
    expect(chartMarks(rows, FRAME).map((m) => m.kind)).toEqual([
      "old",
      "current",
      "unscored",
      "current",
    ]);
  });

  it("puts time left to right and score bottom to top", () => {
    const [old, top, , bottom] = chartMarks(rows, FRAME);
    expect(old?.x).toBe(30);
    expect(bottom?.x).toBe(390);
    expect(top?.y).toBe(10);
    expect(bottom?.y).toBe(180);
  });

  it("rests an unscored session on the baseline", () => {
    expect(chartMarks(rows, FRAME)[2]?.y).toBe(180);
  });

  it("centres a lone session", () => {
    expect(chartMarks(rows.slice(0, 1), FRAME)[0]?.x).toBe(210);
  });
});
