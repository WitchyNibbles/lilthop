import type { SavedResult } from "../domain/contract";
import { findExercise, type Exercise } from "../domain/exercises";
import { dailyPlan } from "../domain/plan";

/** From this hour the day counts as evening: the greeting and the rail both say so. */
export const EVENING_FROM_HOUR = 18;

export interface RoutineItem {
  readonly exercise: Exercise;
  readonly done: boolean;
}

export interface Routine {
  readonly items: readonly RoutineItem[];
  /** The first item not done yet. */
  readonly next: Exercise | null;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

export function todaysRoutine(
  goals: readonly string[],
  results: readonly SavedResult[],
  now: Date,
): Routine {
  const doneToday = new Set(
    results
      .filter((r) => isSameDay(new Date(r.createdAt * 1000), now))
      .map((r) => r.exerciseId),
  );
  const items = dailyPlan(goals, now.getHours()).flatMap((id) => {
    const exercise = findExercise(id);
    return exercise === undefined
      ? []
      : [{ exercise, done: doneToday.has(id) }];
  });
  return {
    items,
    next: items.find((item) => !item.done)?.exercise ?? null,
  };
}

/** The least of a moon, for practice that was not on today's routine. */
const SLIVER = 0.12;

/** Today's moon, 0 to 1: it waxes by the share of the routine done. */
export function moonPhaseToday(
  routine: Routine,
  practisedToday: boolean,
): number {
  const { items } = routine;
  if (items.length === 0) return practisedToday ? 1 : 0;
  const share = items.filter((item) => item.done).length / items.length;
  return practisedToday ? Math.max(share, SLIVER) : share;
}
