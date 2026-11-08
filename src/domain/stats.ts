import type { SavedResult } from "./contract";
import { SCORING_VERSION } from "./scoring";
import { mean } from "./statistics";

/** Fewest current-scoring sessions that make a trend. */
const TREND_MIN_SESSIONS = 4;
/** Points between the first and second half that count as a change. */
const TREND_MIN_DELTA = 3;

export type TrendDirection = "up" | "down" | "flat" | "unknown";

export interface Trend {
  readonly direction: TrendDirection;
  /** Second-half average minus first-half average. 0 when unknown. */
  readonly delta: number;
}

type ScoredResult = SavedResult & { readonly score: number };

/** Current scoring and an actual score: unscored practice never counts as 0. */
const isCurrentScored = (r: SavedResult): r is ScoredResult =>
  r.scoringVersion === SCORING_VERSION && r.score !== null;

function chronological(results: readonly SavedResult[]): ScoredResult[] {
  return results
    .filter(isCurrentScored)
    .sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
}

/** First half of the sessions against the second, oldest to newest, current scoring only. */
export function trend(results: readonly SavedResult[]): Trend {
  const ordered = chronological(results);
  if (ordered.length < TREND_MIN_SESSIONS)
    return { direction: "unknown", delta: 0 };
  const half = Math.floor(ordered.length / 2);
  const first = mean(ordered.slice(0, half).map((r) => r.score));
  const second = mean(ordered.slice(ordered.length - half).map((r) => r.score));
  const delta = second - first;
  if (delta >= TREND_MIN_DELTA) return { direction: "up", delta };
  if (delta <= -TREND_MIN_DELTA) return { direction: "down", delta };
  return { direction: "flat", delta };
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export interface PracticeDay {
  /** 0 is today. */
  readonly daysAgo: number;
  readonly practised: boolean;
}

/**
 * The last `days` calendar days (local time), oldest first, each marked if any session was saved (scored or not).
 * A gap is just an empty day: nothing counts down and nothing resets.
 */
export function practiceDays(
  results: readonly SavedResult[],
  days: number,
  now: Date,
): PracticeDay[] {
  const practisedKeys = new Set(
    results.map((r) => dayKey(new Date(r.createdAt * 1000))),
  );
  return Array.from({ length: Math.max(0, days) }, (_, i) => {
    const daysAgo = days - 1 - i;
    const day = new Date(now);
    day.setDate(day.getDate() - daysAgo);
    return { daysAgo, practised: practisedKeys.has(dayKey(day)) };
  });
}

export interface ExerciseTotals {
  readonly sessions: number;
  /** Average of current-scoring scored results; null when there are none. */
  readonly averageScore: number | null;
}

export interface Totals {
  readonly sessions: number;
  readonly totalDurationS: number;
  readonly byExercise: Readonly<Record<string, ExerciseTotals>>;
}

function averageOfCurrent(results: readonly SavedResult[]): number | null {
  const current = results.filter(isCurrentScored);
  return current.length === 0 ? null : mean(current.map((r) => r.score));
}

/** Counts every row. Averages use current scoring only, so old and new are never mixed. */
export function totals(results: readonly SavedResult[]): Totals {
  const groups = new Map<string, SavedResult[]>();
  for (const r of results)
    groups.set(r.exerciseId, [...(groups.get(r.exerciseId) ?? []), r]);
  const byExercise: Record<string, ExerciseTotals> = {};
  for (const [id, rows] of groups) {
    byExercise[id] = {
      sessions: rows.length,
      averageScore: averageOfCurrent(rows),
    };
  }
  return {
    sessions: results.length,
    totalDurationS: results.reduce((sum, r) => sum + r.durationS, 0),
    byExercise,
  };
}
