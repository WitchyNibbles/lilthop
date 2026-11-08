import type { MessageKey } from "../i18n";

/** What an exercise is scored on. Each scored kind has its own rule in `measures.ts`. */
export type ScoredMeasure =
  | "steady"
  | "sustained"
  | "range"
  | "raise"
  | "glide"
  | "mixed"
  | "intonation"
  | "breath"
  | "articulation";

/**
 * "brightness" is practice only: the centroid is shown as a rough hint and never scored, because
 * a score for a brighter sound could reward pushing.
 */
export type Measure = ScoredMeasure | "brightness";

/** Unvoiced exercises have no pitch to show. */
export function showsPitch(measure: Measure): boolean {
  return measure !== "breath";
}

export type Category =
  | "warmup"
  | "pitch"
  | "resonance"
  | "range"
  | "register"
  | "intonation"
  | "articulation"
  | "breath";

export const CATEGORIES: readonly Category[] = [
  "warmup",
  "pitch",
  "resonance",
  "range",
  "register",
  "intonation",
  "articulation",
  "breath",
];

export type ExerciseId =
  | "warmup_hum"
  | "warmup_liptrill"
  | "warmup_siren"
  | "pitch_awareness"
  | "sustained_tone"
  | "glides"
  | "pitch_raising"
  | "resonance"
  | "forward_vowels"
  | "mixed_voice"
  | "intonation"
  | "articulation"
  | "breath";

export interface Exercise {
  readonly id: ExerciseId;
  readonly category: Category;
  readonly measure: Measure;
  readonly durationS: number;
  /** Starting tempo, for the exercises that are paced by a beat. */
  readonly metronomeBpm?: number;
}

/** First in the list, and where practice opens when there is no plan. */
export const FIRST_EXERCISE: Exercise = {
  id: "warmup_hum",
  category: "warmup",
  measure: "steady",
  durationS: 60,
};

export const EXERCISES: readonly Exercise[] = [
  FIRST_EXERCISE,
  {
    id: "warmup_liptrill",
    category: "warmup",
    measure: "glide",
    durationS: 60,
    metronomeBpm: 90,
  },
  { id: "warmup_siren", category: "warmup", measure: "glide", durationS: 60 },
  { id: "pitch_awareness", category: "pitch", measure: "range", durationS: 60 },
  {
    id: "sustained_tone",
    category: "pitch",
    measure: "sustained",
    durationS: 45,
  },
  {
    id: "glides",
    category: "range",
    measure: "glide",
    durationS: 60,
    metronomeBpm: 90,
  },
  { id: "pitch_raising", category: "pitch", measure: "raise", durationS: 90 },
  {
    id: "resonance",
    category: "resonance",
    measure: "brightness",
    durationS: 60,
  },
  {
    id: "forward_vowels",
    category: "resonance",
    measure: "brightness",
    durationS: 60,
  },
  { id: "mixed_voice", category: "register", measure: "mixed", durationS: 60 },
  {
    id: "intonation",
    category: "intonation",
    measure: "intonation",
    durationS: 60,
  },
  {
    id: "articulation",
    category: "articulation",
    measure: "articulation",
    durationS: 60,
    metronomeBpm: 90,
  },
  { id: "breath", category: "breath", measure: "breath", durationS: 45 },
];

export interface ExerciseText {
  readonly name: MessageKey;
  readonly description: MessageKey;
  readonly instructions: MessageKey;
}

export function exerciseText(id: ExerciseId): ExerciseText {
  return {
    name: `exercise.${id}.name`,
    description: `exercise.${id}.description`,
    instructions: `exercise.${id}.instructions`,
  };
}

export function findExercise(id: string): Exercise | undefined {
  return EXERCISES.find((exercise) => exercise.id === id);
}

export function exercisesIn(category: Category): readonly Exercise[] {
  return EXERCISES.filter((exercise) => exercise.category === category);
}
