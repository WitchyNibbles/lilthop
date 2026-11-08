import type { SessionData } from "../domain/session";
import { median } from "../domain/statistics";

/** Less voice than this is not a measurement. */
const MIN_VOICED_S = 5;
/**
 * The suggested range, in semitones from the baseline. A voice under the top of the ambiguous
 * zone (175 Hz) gets a range lifted a little above it, its top capped at the feminine average's
 * top (220 Hz); a voice already there gets a range around it. The steps are a judgement call: no
 * source gives a step size. See docs/research/voice-safety.md.
 */
const LIFT = { low: 1, high: 5 } as const;
const AROUND = { low: -2, high: 3 } as const;
const LIFTED_LOW_CEILING_HZ = 175;
const LIFTED_HIGH_CEILING_HZ = 220;

export interface Baseline {
  readonly hz: number;
  readonly centroid: number;
  readonly rms: number;
}

export function measureBaseline(data: SessionData): Baseline | null {
  if (data.voicedS < MIN_VOICED_S) return null;
  return {
    hz: median(data.pitch.map((point) => point.hz)),
    centroid: median(data.centroids),
    rms: median(data.soundRms),
  };
}

/** Whether the suggested range starts above the baseline or sits around it. */
export type RangeStart = "lifted" | "around";

export interface StartingRange {
  readonly minHz: number;
  readonly maxHz: number;
  readonly start: RangeStart;
}

const shifted = (hz: number, semitones: number) => hz * 2 ** (semitones / 12);

/** Rises with the baseline and has no jumps: each edge moves from lifted to around smoothly. */
export function startingRange(baselineHz: number): StartingRange {
  const minHz = Math.max(
    shifted(baselineHz, AROUND.low),
    Math.min(shifted(baselineHz, LIFT.low), LIFTED_LOW_CEILING_HZ),
  );
  const maxHz = Math.max(
    shifted(baselineHz, AROUND.high),
    Math.min(shifted(baselineHz, LIFT.high), LIFTED_HIGH_CEILING_HZ),
  );
  return {
    minHz: Math.round(minHz),
    maxHz: Math.round(maxHz),
    start: minHz > baselineHz ? "lifted" : "around",
  };
}

export function toDecibels(rms: number): number {
  return 20 * Math.log10(rms);
}
