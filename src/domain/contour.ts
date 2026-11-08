// Shape of a pitch track in semitones: spread, sweeps, jumps and phrases.
import type { PitchPoint } from "./session";
import {
  percentile,
  robustStandardDeviation,
  semitonesBetween,
} from "./statistics";

const REFERENCE_HZ = 100;

export function toSemitones(points: readonly PitchPoint[]): number[] {
  return points.map((p) => semitonesBetween(REFERENCE_HZ, p.hz));
}

/** Span of the middle 90% of the track, in semitones. One glitch cannot move it. */
export function spanSemitones(points: readonly PitchPoint[]): number {
  const semitones = toSemitones(points);
  return percentile(semitones, 95) - percentile(semitones, 5);
}

/** Spread of the track as a standard deviation in cents, ignoring the outer 10% each side. */
export function robustSpreadCents(points: readonly PitchPoint[]): number {
  return 100 * robustStandardDeviation(toSemitones(points));
}

interface Zigzag {
  /** 0 until the track has moved `minTravel` once. */
  readonly direction: -1 | 0 | 1;
  /** The furthest value in the current direction (the starting value while direction is 0). */
  readonly extreme: number;
  readonly legs: number;
}

function startLeg(state: Zigzag, value: number, minTravel: number): Zigzag {
  const moved = value - state.extreme;
  if (Math.abs(moved) < minTravel) return state;
  return { direction: moved > 0 ? 1 : -1, extreme: value, legs: 1 };
}

function advance(state: Zigzag, value: number, minTravel: number): Zigzag {
  if (state.direction === 0) return startLeg(state, value, minTravel);
  const retreat = state.direction * (state.extreme - value);
  if (retreat >= minTravel) {
    return {
      direction: state.direction === 1 ? -1 : 1,
      extreme: value,
      legs: state.legs + 1,
    };
  }
  if (retreat < 0) return { ...state, extreme: value };
  return state;
}

/** Number of straight runs up or down that each travel at least `minTravel` semitones. */
export function countSweeps(
  semitones: readonly number[],
  minTravel: number,
): number {
  const first = semitones[0];
  if (first === undefined) return 0;
  const start: Zigzag = { direction: 0, extreme: first, legs: 0 };
  return semitones.reduce(
    (state, value) => advance(state, value, minTravel),
    start,
  ).legs;
}

/**
 * Sweeps counted inside each continuous run of voice and added up. A new note after a pause
 * starts a new run, so hopping between notes never adds up to a sweep.
 */
export function countSweepsInRuns(
  points: readonly PitchPoint[],
  minTravel: number,
  maxGapS: number,
): number {
  return splitPhrases(points, maxGapS, Number.POSITIVE_INFINITY).reduce(
    (total, run) => total + countSweeps(toSemitones(run), minTravel),
    0,
  );
}

/** Steps between neighbouring points that jump by more than `minJump` semitones. */
export function countJumps(
  points: readonly PitchPoint[],
  minJump: number,
  maxGapS: number,
): number {
  let jumps = 0;
  for (let i = 1; i < points.length; i++) {
    const before = points[i - 1];
    const after = points[i];
    if (before === undefined || after === undefined) continue;
    const consecutive = after.tS - before.tS <= maxGapS;
    if (
      consecutive &&
      Math.abs(semitonesBetween(before.hz, after.hz)) > minJump
    )
      jumps++;
  }
  return jumps;
}

/** Cuts a track at pauses longer than `maxPauseS` and at `maxLengthS`. */
export function splitPhrases(
  points: readonly PitchPoint[],
  maxPauseS: number,
  maxLengthS: number,
): PitchPoint[][] {
  const phrases: PitchPoint[][] = [];
  let current: PitchPoint[] = [];
  for (const point of points) {
    const first = current[0];
    const last = current[current.length - 1];
    const paused = last !== undefined && point.tS - last.tS > maxPauseS;
    const tooLong = first !== undefined && point.tS - first.tS > maxLengthS;
    if (paused || tooLong) {
      phrases.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) phrases.push(current);
  return phrases;
}

export function durationS(points: readonly PitchPoint[]): number {
  const first = points[0];
  const last = points[points.length - 1];
  return first === undefined || last === undefined ? 0 : last.tS - first.tS;
}
