import type { SavedResult } from "../domain/contract";
import { SCORING_VERSION } from "../domain/scoring";

export interface ChartFrame {
  readonly width: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** Old sessions are drawn but never joined to the line; unscored ones sit on the baseline. */
export type MarkKind = "current" | "old" | "unscored";

export interface ChartMark {
  readonly result: SavedResult;
  readonly kind: MarkKind;
  readonly x: number;
  readonly y: number;
}

const byTime = (a: SavedResult, b: SavedResult) =>
  a.createdAt - b.createdAt || a.id - b.id;

export function sessionsOf(
  results: readonly SavedResult[],
  exerciseId: string,
): SavedResult[] {
  return results.filter((r) => r.exerciseId === exerciseId).sort(byTime);
}

/** Each exercise that has a session, the most recently practised first. */
export function practisedExercises(
  results: readonly SavedResult[],
): readonly string[] {
  const latestFirst = [...results].sort(byTime).reverse();
  return [...new Set(latestFirst.map((r) => r.exerciseId))];
}

export function markKind(result: SavedResult): MarkKind {
  if (result.scoringVersion < SCORING_VERSION) return "old";
  return result.score === null ? "unscored" : "current";
}

export function chartMarks(
  rows: readonly SavedResult[],
  frame: ChartFrame,
): ChartMark[] {
  const { width, height, left, right, top, bottom } = frame;
  const plotWidth = width - left - right;
  const baseline = height - bottom;
  const first = rows[0]?.createdAt ?? 0;
  const span = (rows[rows.length - 1]?.createdAt ?? 0) - first;
  const xOf = (time: number) =>
    span === 0
      ? left + plotWidth / 2
      : left + ((time - first) / span) * plotWidth;
  const yOf = (score: number | null) =>
    baseline - ((score ?? 0) / 100) * (baseline - top);
  return rows.map((result) => ({
    result,
    kind: markKind(result),
    x: xOf(result.createdAt),
    y: yOf(result.score),
  }));
}

export function linePath(marks: readonly ChartMark[]): string {
  return marks
    .filter((mark) => mark.kind === "current")
    .map((mark, i) => `${i === 0 ? "M" : "L"}${mark.x} ${mark.y}`)
    .join("");
}
