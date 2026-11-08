import type { ExerciseId } from "./exercises";

export type GoalId =
  "pitch" | "stability" | "resonance" | "range" | "intonation" | "endurance";

export const GOAL_IDS: readonly GoalId[] = [
  "pitch",
  "stability",
  "resonance",
  "range",
  "intonation",
  "endurance",
];

export const GOAL_EXERCISES: Readonly<Record<GoalId, readonly ExerciseId[]>> = {
  // The app's one direction is up, so the pitch goal raises. Awareness comes first: its target,
  // the whole range, is wider and easier than the upper half that raising asks for.
  pitch: ["pitch_awareness", "pitch_raising"],
  stability: ["sustained_tone"],
  resonance: ["resonance", "forward_vowels"],
  range: ["glides"],
  intonation: ["intonation"],
  endurance: ["breath"],
};

const MAX_DAILY_EXERCISES = 4;
const MORNING_BEFORE_HOUR = 12;

export function isGoalId(value: string): value is GoalId {
  return GOAL_IDS.some((id) => id === value);
}

function exercisesForGoals(goals: readonly string[]): ExerciseId[] {
  const ids = goals.filter(isGoalId).flatMap((goal) => GOAL_EXERCISES[goal]);
  return [...new Set(ids)];
}

/** Today's exercises: mornings open with the hum warm-up. */
export function dailyPlan(
  goals: readonly string[],
  hour: number,
): ExerciseId[] {
  const ids = exercisesForGoals(goals);
  if (ids.length === 0) return [];
  if (hour < MORNING_BEFORE_HOUR && !ids.includes("warmup_hum"))
    ids.unshift("warmup_hum");
  return ids.slice(0, MAX_DAILY_EXERCISES);
}
