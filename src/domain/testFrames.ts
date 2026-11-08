// Fake frame streams with known pitch, shared by the domain tests. Nothing here is app code.
import type { PitchFrame } from "./contract";
import { SessionRecorder, type SessionData } from "./session";

/** One hop of 1024 samples at 48 kHz. */
export const FRAME_MS = (1024 / 48000) * 1000;

export type FrameMaker = (tS: number) => Omit<PitchFrame, "tMs">;

export function voiced(f0: number, centroid = 1800): Omit<PitchFrame, "tMs"> {
  return { f0, rms: 0.05, peak: 0.2, centroid };
}

export function silence(): Omit<PitchFrame, "tMs"> {
  return { f0: 0, rms: 0.0005, peak: 0.002, centroid: 0 };
}

/** Sound with no pitch, like "sss": above the volume gate, f0 = 0. */
export function hiss(rms: number): Omit<PitchFrame, "tMs"> {
  return { f0: 0, rms, peak: Math.min(1, rms * 4), centroid: 4500 };
}

/** Frames every FRAME_MS for `seconds`, starting at `startMs`. */
export function stream(
  seconds: number,
  make: FrameMaker,
  startMs = 0,
): PitchFrame[] {
  const count = Math.floor((seconds * 1000) / FRAME_MS);
  return Array.from({ length: count }, (_, i) => {
    const tMs = startMs + i * FRAME_MS;
    return { tMs, ...make(i * (FRAME_MS / 1000)) };
  });
}

export function steadyHz(
  seconds: number,
  hz: number,
  startMs = 0,
): PitchFrame[] {
  return stream(seconds, () => voiced(hz), startMs);
}

export function silent(seconds: number, startMs = 0): PitchFrame[] {
  return stream(seconds, silence, startMs);
}

/** Next frame time after a stream, so streams can be chained. */
export function endMs(frames: readonly PitchFrame[]): number {
  const last = frames[frames.length - 1];
  return last === undefined ? 0 : last.tMs + FRAME_MS;
}

export function concat(...parts: PitchFrame[][]): PitchFrame[] {
  return parts.flat();
}

/** Hz of a pitch `semitones` above `hz`. */
export function shiftedHz(hz: number, semitones: number): number {
  return hz * 2 ** (semitones / 12);
}

export function recordFrames(frames: readonly PitchFrame[]): SessionData {
  const recorder = new SessionRecorder();
  for (const frame of frames) recorder.add(frame);
  return recorder.snapshot();
}

/** A triangle wave in pitch: `legs` straight sweeps of `semitones` each, `legSeconds` long. */
export function sirenFrames(
  baseHz: number,
  semitones: number,
  legSeconds: number,
  legs: number,
): PitchFrame[] {
  return stream(legSeconds * legs, (t) => {
    const phase = (t / legSeconds) % 2;
    const up = phase < 1 ? phase : 2 - phase;
    return voiced(shiftedHz(baseHz, semitones * up));
  });
}

/** A phrase that rises and falls like a spoken sentence, `seconds` long. */
export function archFrames(
  seconds: number,
  lowHz: number,
  highHz: number,
  startMs = 0,
): PitchFrame[] {
  return stream(
    seconds,
    (t) => voiced(lowHz + (highHz - lowHz) * Math.sin((Math.PI * t) / seconds)),
    startMs,
  );
}

/** Repeatable pseudo-random numbers in [0, 1), so noisy fake streams give the same answer every run. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Frames numbered 0, 1, 2 ... for tests that change the pitch by frame count. */
export function framesBy(
  seconds: number,
  make: (index: number) => Omit<PitchFrame, "tMs">,
  startMs = 0,
): PitchFrame[] {
  const count = Math.floor((seconds * 1000) / FRAME_MS);
  return Array.from({ length: count }, (_, i) => ({
    tMs: startMs + i * FRAME_MS,
    ...make(i),
  }));
}
