// Shared by the safety tests: run a frame stream through the monitor and see what was shown.
import type { PitchFrame } from "./contract";
import { SafetyMonitor, type NoticeId } from "./safety";
import { stream, voiced } from "./testFrames";

export const CONTEXT = { targetMaxHz: 255 };

export interface Shown {
  readonly tMs: number;
  readonly notice: NoticeId | null;
}

export function run(frames: readonly PitchFrame[], context = CONTEXT): Shown[] {
  const monitor = new SafetyMonitor(context);
  return frames.map((frame) => ({
    tMs: frame.tMs,
    notice: monitor.push(frame),
  }));
}

export const noticesSeen = (shown: readonly Shown[]): Set<NoticeId> =>
  new Set(shown.flatMap((s) => (s.notice === null ? [] : [s.notice])));

export function firstShown(
  shown: readonly Shown[],
  id: NoticeId,
): number | undefined {
  return shown.find((s) => s.notice === id)?.tMs;
}

/** Voiced at `rms`, with the pitch and peak of ordinary speech. */
export const speak = (seconds: number, rms: number, startMs = 0, f0 = 200) =>
  stream(seconds, () => ({ ...voiced(f0), rms }), startMs);
