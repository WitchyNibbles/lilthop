// Shared by the scoring tests: record a frame stream and score it against one fixed band.
import type { PitchFrame } from "./contract";
import type { Measure } from "./exercises";
import { scoreSession, type ScoreOutcome } from "./scoring";
import { recordFrames } from "./testFrames";

export const CONTEXT = { targetMinHz: 165, targetMaxHz: 255 };

export function outcomeOf(
  measure: Measure,
  frames: readonly PitchFrame[],
): ScoreOutcome {
  return scoreSession(measure, recordFrames(frames), CONTEXT);
}

export function scoreOf(
  measure: Measure,
  frames: readonly PitchFrame[],
): number {
  const outcome = outcomeOf(measure, frames);
  if (outcome.status !== "scored")
    throw new Error(`not scored: ${JSON.stringify(outcome)}`);
  return outcome.score;
}
