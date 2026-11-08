import type { NewResult } from "./contract";
import type { Measure } from "./exercises";
import { MEASURE_RULES, type ScoringContext } from "./measures";
import { median } from "./statistics";
import { pitchSummary, type SessionData } from "./session";

export type { ScoringContext } from "./measures";

/** Saved with every result so old and new scores are never compared. */
export const SCORING_VERSION = 2;

/** Voice (or sound, for breath) needed before a session can be scored at all. */
const MIN_PRESENT_S = 3;
const MIN_PRESENT_SHARE = 0.3;

export type ScoreOutcome =
  | {
      readonly status: "scored";
      /** Whole number, 0..100. */
      readonly score: number;
      readonly detail: Readonly<Record<string, number>>;
    }
  | {
      /** Practised, but nothing to score: brightness is shown as a hint, never rewarded. */
      readonly status: "practice_only";
      readonly voicedS: number;
      /** Median centroid of the voiced frames, in Hz. Information only. */
      readonly medianCentroidHz: number;
    }
  | {
      readonly status: "not_enough_voice";
      /** Seconds of voice, or of sound for breath, that the session had. */
      readonly voicedS: number;
    };

function assertValid(context: ScoringContext): void {
  const { targetMinHz, targetMaxHz } = context;
  if (!(targetMinHz > 0 && targetMaxHz > targetMinHz)) {
    throw new RangeError(
      `target band ${targetMinHz}-${targetMaxHz} Hz is not a band`,
    );
  }
}

/** Breath needs sound, every other exercise needs a pitch. */
export function presentSeconds(measure: Measure, data: SessionData): number {
  return measure === "breath" ? data.soundS : data.voicedS;
}

export function scoreSession(
  measure: Measure,
  data: SessionData,
  context: ScoringContext,
): ScoreOutcome {
  assertValid(context);
  const present = presentSeconds(measure, data);
  if (present < MIN_PRESENT_S || present < MIN_PRESENT_SHARE * data.elapsedS) {
    return { status: "not_enough_voice", voicedS: present };
  }
  if (measure === "brightness") {
    return {
      status: "practice_only",
      voicedS: present,
      medianCentroidHz: median(data.centroids),
    };
  }
  const { score, detail } = MEASURE_RULES[measure](data, context);
  return {
    status: "scored",
    score: Math.round(Math.min(100, Math.max(0, score))),
    detail,
  };
}

/**
 * What to save for a session. A scored one keeps its score; a practice-only one
 * (brightness) is saved with a null score so the day still counts. Nothing for a
 * session without enough voice.
 */
export function buildNewResult(
  exerciseId: string,
  data: SessionData,
  outcome: ScoreOutcome,
): NewResult | null {
  if (outcome.status === "not_enough_voice") return null;
  const { mean, sd } = pitchSummary(data);
  return {
    exerciseId,
    score: outcome.status === "scored" ? outcome.score : null,
    pitchMean: mean,
    pitchSd: sd,
    durationS: data.elapsedS,
    voicedS: data.voicedS,
    scoringVersion: SCORING_VERSION,
  };
}
