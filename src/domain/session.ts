import type { PitchFrame } from "./contract";
import { PitchTracker, RawMedian } from "./pitchTracker";
import { mean, standardDeviation } from "./statistics";

/** About -50 dBFS. Matches the gate on the Rust side: below it nothing counts as sound. */
export const VOLUME_GATE_RMS = 0.003;
/**
 * Frames further apart than this mean the stream dropped out; that time is not credited. A frame
 * that arrives this much earlier than the last one means the stream restarted (tMs began again).
 */
const MAX_FRAME_GAP_MS = 250;

export interface PitchPoint {
  /** Seconds since the first frame of the session. */
  readonly tS: number;
  /** Raw pitch, median of three voiced frames, Hz. Not the smoothed display value. */
  readonly hz: number;
}

export interface SessionData {
  /** First frame to last frame, from the frames' own timestamps. */
  readonly elapsedS: number;
  /** Time with a voiced frame above the volume gate. */
  readonly voicedS: number;
  /** Time with any sound above the volume gate, pitched or not. */
  readonly soundS: number;
  readonly pitch: readonly PitchPoint[];
  /** Centroid (Hz) of each voiced frame. */
  readonly centroids: readonly number[];
  /** Level of each frame with sound, whether pitched or not. */
  readonly soundRms: readonly number[];
  /** Share (0..1) of voiced frames the display turned away as slips. Counts against steadiness. */
  readonly rejectedShare: number;
}

function isUsable(frame: PitchFrame): boolean {
  return [frame.tMs, frame.f0, frame.rms, frame.centroid].every(
    Number.isFinite,
  );
}

/** Collects frames while an exercise runs. Only voiced frames feed pitch and centroid. */
export class SessionRecorder {
  private readonly tracker = new PitchTracker();
  private readonly raw = new RawMedian();
  private firstMs: number | null = null;
  private lastMs: number | null = null;
  /** Added to the stream's tMs; grows each time the stream restarts from zero. */
  private offsetMs = 0;
  private rejected = 0;
  private voicedMs = 0;
  private soundMs = 0;
  private readonly pitch: PitchPoint[] = [];
  private readonly centroids: number[] = [];
  private readonly soundRms: number[] = [];

  add(frame: PitchFrame): void {
    if (!isUsable(frame)) return;
    const tMs = this.alignTime(frame.tMs);
    if (tMs === null) return;
    const credit = this.creditFor(tMs);
    this.firstMs ??= tMs;
    this.lastMs = tMs;
    const reading = this.tracker.push({ ...frame, tMs });
    if (frame.rms < VOLUME_GATE_RMS) return;
    this.soundMs += credit;
    this.soundRms.push(frame.rms);
    if (frame.f0 <= 0) return;
    this.voicedMs += credit;
    if (reading?.rejected) this.rejected++;
    this.pitch.push({
      tS: (tMs - (this.firstMs ?? tMs)) / 1000,
      hz: this.raw.push(frame.f0, tMs),
    });
    this.centroids.push(frame.centroid);
  }

  snapshot(): SessionData {
    const elapsedMs =
      this.firstMs === null || this.lastMs === null
        ? 0
        : this.lastMs - this.firstMs;
    return {
      elapsedS: elapsedMs / 1000,
      voicedS: this.voicedMs / 1000,
      soundS: this.soundMs / 1000,
      pitch: [...this.pitch],
      centroids: [...this.centroids],
      soundRms: [...this.soundRms],
      rejectedShare:
        this.pitch.length === 0 ? 0 : this.rejected / this.pitch.length,
    };
  }

  /**
   * Session time of a frame, or null for one to drop. A frame a little late is dropped; one far
   * in the past is a restarted stream, so the clock carries on from the last frame, with a gap
   * that is not credited.
   */
  private alignTime(streamMs: number): number | null {
    const tMs = streamMs + this.offsetMs;
    if (this.lastMs === null || tMs > this.lastMs) return tMs;
    if (this.lastMs - tMs <= MAX_FRAME_GAP_MS) return null;
    this.offsetMs = this.lastMs + MAX_FRAME_GAP_MS + 1 - streamMs;
    return streamMs + this.offsetMs;
  }

  /** Time since the previous frame, or 0 for the first frame and after a dropout. */
  private creditFor(tMs: number): number {
    if (this.lastMs === null) return 0;
    const gap = tMs - this.lastMs;
    return gap <= MAX_FRAME_GAP_MS ? gap : 0;
  }
}

export function pitchSummary(data: SessionData): { mean: number; sd: number } {
  const hz = data.pitch.map((p) => p.hz);
  return { mean: mean(hz), sd: standardDeviation(hz) };
}
