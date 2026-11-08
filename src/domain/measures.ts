// One rule per kind of exercise. Each turns a recorded session into 0..100 plus the numbers
// behind it. Thresholds are starting values, pinned by the known-answer tests.
import type { ScoredMeasure } from "./exercises";
import {
  countJumps,
  countSweeps,
  countSweepsInRuns,
  durationS,
  robustSpreadCents,
  spanSemitones,
  splitPhrases,
  toSemitones,
} from "./contour";
import { VOLUME_GATE_RMS, type PitchPoint, type SessionData } from "./session";
import {
  median,
  percentile,
  rampDown,
  rampUp,
  robustStandardDeviation,
} from "./statistics";

export interface ScoringContext {
  readonly targetMinHz: number;
  readonly targetMaxHz: number;
  /** The person's own level from calibration, if they have one. Sets the quietest breath that counts. */
  readonly baselineRms?: number;
}

export interface MeasureResult {
  /** 0..100, not rounded. */
  readonly score: number;
  /** The numbers the score came from, for display. */
  readonly detail: Readonly<Record<string, number>>;
}

export type MeasureRule = (
  data: SessionData,
  context: ScoringContext,
) => MeasureResult;

/** Spread (cents) at or under which a held note counts as perfectly steady, and at which it scores 0. */
const HELD_NOTE_CENTS = { full: 15, zero: 75 } as const;
/** Share of voiced frames the display turned away: a few slips are normal, many are not steady. */
const REJECTED_SHARE = { full: 0.03, zero: 0.2 } as const;
/** Reading aloud moves more; the same idea with a wider allowance. */
const SPEECH_CENTS = { full: 100, zero: 400 } as const;

/** A glide should cover about a fifth and a half to count fully. */
const GLIDE_SPAN_GOAL_SEMITONES = 8;
/** A run up or down must travel this far to count as a sweep. */
const SWEEP_MIN_SEMITONES = 3;
const SWEEPS_FOR_FULL_CREDIT = 3;
/** Between two neighbouring frames, a move bigger than this is a jump, not a glide. */
const JUMP_SEMITONES = 1.5;
/** A new pitch after a pause shorter than this is still a jump; a longer pause is a breath. */
const JUMP_MAX_GAP_S = 0.3;
/** Voice with a pause longer than this between is two runs; a sweep lives inside one run. */
const RUN_MAX_GAP_S = 0.1;
/** Jumps per minute of voice that are still smooth, and the rate that is not smooth at all. */
const JUMPS_PER_MIN = { full: 1, zero: 6 } as const;
/** Register breaks in a mixed-voice siren: none is full credit, this many is none. */
const BREAKS_FOR_ZERO = 4;

const PHRASE_MAX_PAUSE_S = 0.25;
const PHRASE_MAX_LENGTH_S = 6;
const PHRASE_MIN_LENGTH_S = 0.5;
/** Movement within a phrase (p10-p90, semitones): none below `flat`, natural from `natural` to `wide`. */
const PHRASE_MOVEMENT = {
  flat: 0.5,
  natural: 2,
  wide: 8,
  tooWide: 14,
} as const;
const PHRASE_MIN_TRAVEL_SEMITONES = 1;
/** Rises and falls per second in a phrase: speech does about one to two, a wobble does more. */
const PHRASE_LEGS_PER_S = { full: 2, zero: 3.5 } as const;
/** Short phrases are not held to a faster rate than this many seconds allow. */
const PHRASE_RATE_MIN_S = 1;

/** Quietest level (rms) a breath can have: about three times the volume gate. */
const BREATH_MIN_RMS = 0.01;
/** The same, as a share of the person's own calibration level, when they have one. */
const BREATH_MIN_SHARE_OF_BASELINE = 0.15;
/** Relative spread of the level (p10-p90 over the median) that is steady, and that is not. */
const LEVEL_SPREAD = { full: 0.2, zero: 0.8 } as const;

function percentOf(share: number): number {
  return 100 * share;
}

function stabilityOf(
  data: SessionData,
  bounds: { full: number; zero: number },
) {
  const spreadCents = robustSpreadCents(data.pitch);
  const slips = rampDown(
    data.rejectedShare,
    REJECTED_SHARE.full,
    REJECTED_SHARE.zero,
  );
  return {
    spreadCents,
    stability: rampDown(spreadCents, bounds.full, bounds.zero) * slips,
  };
}

function shareWhere(
  points: readonly PitchPoint[],
  test: (hz: number) => boolean,
): number {
  if (points.length === 0) return 0;
  return points.filter((p) => test(p.hz)).length / points.length;
}

function inBandShare(
  points: readonly PitchPoint[],
  context: ScoringContext,
): number {
  return shareWhere(
    points,
    (hz) => hz >= context.targetMinHz && hz <= context.targetMaxHz,
  );
}

const steady: MeasureRule = (data) => {
  const { spreadCents, stability } = stabilityOf(data, HELD_NOTE_CENTS);
  return { score: percentOf(stability), detail: { spreadCents } };
};

const sustained: MeasureRule = (data, context) => {
  const { spreadCents, stability } = stabilityOf(data, HELD_NOTE_CENTS);
  const inBand = inBandShare(data.pitch, context);
  return {
    score: percentOf(inBand * stability),
    detail: { inBandShare: inBand, spreadCents },
  };
};

const range: MeasureRule = (data, context) => {
  const inBand = inBandShare(data.pitch, context);
  return { score: percentOf(inBand), detail: { inBandShare: inBand } };
};

const raise: MeasureRule = (data, context) => {
  const middle = (context.targetMinHz + context.targetMaxHz) / 2;
  const share = shareWhere(
    data.pitch,
    (hz) => hz >= middle && hz <= context.targetMaxHz,
  );
  return { score: percentOf(share), detail: { upperHalfShare: share } };
};

function glideParts(data: SessionData) {
  const span = spanSemitones(data.pitch);
  const sweeps = countSweepsInRuns(
    data.pitch,
    SWEEP_MIN_SEMITONES,
    RUN_MAX_GAP_S,
  );
  const jumps = countJumps(data.pitch, JUMP_SEMITONES, JUMP_MAX_GAP_S);
  const jumpsPerMin = data.voicedS > 0 ? jumps / (data.voicedS / 60) : 0;
  const smooth = rampDown(jumpsPerMin, JUMPS_PER_MIN.full, JUMPS_PER_MIN.zero);
  const spanCredit = rampUp(span, 0, GLIDE_SPAN_GOAL_SEMITONES);
  const sweepCredit = rampUp(sweeps, 0, SWEEPS_FOR_FULL_CREDIT);
  return {
    span,
    sweeps,
    jumps,
    // Smoothness of nothing is worth nothing: it only counts when there was a sweep.
    glide:
      spanCredit * (0.4 * sweepCredit + 0.6 * smooth * Math.min(1, sweeps)),
  };
}

const glide: MeasureRule = (data) => {
  const { span, sweeps, jumps, glide: credit } = glideParts(data);
  return {
    score: percentOf(credit),
    detail: { spanSemitones: span, sweeps, jumps },
  };
};

const mixed: MeasureRule = (data) => {
  const { span, sweeps, jumps, glide: credit } = glideParts(data);
  const breakFree = rampDown(jumps, 0, BREAKS_FOR_ZERO);
  return {
    score: percentOf(credit * breakFree),
    detail: { spanSemitones: span, sweeps, breaks: jumps },
  };
};

function movementCredit(movement: number): number {
  const { flat, natural, wide, tooWide } = PHRASE_MOVEMENT;
  return Math.min(
    rampUp(movement, flat, natural),
    rampDown(movement, wide, tooWide),
  );
}

function phraseScore(phrase: readonly PitchPoint[]): number {
  const semitones = toSemitones(phrase);
  const movement = percentile(semitones, 90) - percentile(semitones, 10);
  const legs = countSweeps(semitones, PHRASE_MIN_TRAVEL_SEMITONES);
  const contour = rampUp(legs, 0, 2);
  const legsPerS = legs / Math.max(PHRASE_RATE_MIN_S, durationS(phrase));
  const speechRate = rampDown(
    legsPerS,
    PHRASE_LEGS_PER_S.full,
    PHRASE_LEGS_PER_S.zero,
  );
  return (0.7 * movementCredit(movement) + 0.3 * contour) * speechRate;
}

const intonation: MeasureRule = (data) => {
  const phrases = splitPhrases(
    data.pitch,
    PHRASE_MAX_PAUSE_S,
    PHRASE_MAX_LENGTH_S,
  ).filter((phrase) => durationS(phrase) >= PHRASE_MIN_LENGTH_S);
  const totalS = phrases.reduce((sum, phrase) => sum + durationS(phrase), 0);
  if (totalS === 0) return { score: 0, detail: { phrases: 0 } };
  const weighted = phrases.reduce(
    (sum, phrase) => sum + durationS(phrase) * phraseScore(phrase),
    0,
  );
  return {
    score: percentOf(weighted / totalS),
    detail: { phrases: phrases.length },
  };
};

/** Steadiness of the level only. Length earns nothing: breath work is not a contest. */
const breath: MeasureRule = (data, context) => {
  const level = median(data.soundRms);
  const spread = level > 0 ? robustStandardDeviation(data.soundRms) / level : 0;
  const steadiness = rampDown(spread, LEVEL_SPREAD.full, LEVEL_SPREAD.zero);
  const floor = Math.max(
    BREATH_MIN_RMS,
    BREATH_MIN_SHARE_OF_BASELINE * (context.baselineRms ?? 0),
  );
  const loudEnough = rampUp(level, VOLUME_GATE_RMS, floor);
  return {
    score: percentOf(steadiness * loudEnough),
    detail: { soundS: data.soundS, levelSpread: spread, level, floor },
  };
};

const articulation: MeasureRule = (data) => {
  const { spreadCents, stability } = stabilityOf(data, SPEECH_CENTS);
  return { score: percentOf(stability), detail: { spreadCents } };
};

export const MEASURE_RULES: Readonly<Record<ScoredMeasure, MeasureRule>> = {
  steady,
  sustained,
  range,
  raise,
  glide,
  mixed,
  intonation,
  breath,
  articulation,
};
