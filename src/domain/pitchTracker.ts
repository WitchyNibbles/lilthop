import type { PitchFrame } from "./contract";
import { median, semitonesBetween } from "./statistics";

/** Raw voiced frames the display value is taken from (median). */
const MEDIAN_WINDOW = 5;
/**
 * Weight of the newest median in the exponential average, in log-frequency. At 0.5 a step of a
 * semitone is within 20% after 85 ms (0.3 took 128 ms); the display shake grows by about 15%.
 */
const SMOOTHING = 0.5;
/** A raw frame further than this from the display is a candidate jump, not a step. */
const JUMP_SEMITONES = 3;
/** Consecutive agreeing candidates that turn a jump into a real move. */
const JUMP_CONFIRM_FRAMES = 3;
/** Unvoiced time after which smoothing starts over. */
const RESET_GAP_MS = 150;
/** How long the last value stays on screen, flagged held, after the voice stops. */
const HOLD_MS = 300;

export interface TrackerReading {
  readonly hz: number;
  /** True while the voice is silent and the last value is only being kept on screen. */
  readonly held: boolean;
  /** True when this voiced frame was turned away: too far from the display to follow yet. */
  readonly rejected: boolean;
}

/**
 * Turns raw detector frames into the value to display: median of the last few voiced frames,
 * smoothed in log-frequency. Slips vanish, real moves land, silence never counts as pitch.
 */
export class PitchTracker {
  private recent: number[] = [];
  private candidates: number[] = [];
  private displayLog: number | null = null;
  private lastShownHz: number | null = null;
  private lastVoicedMs: number | null = null;

  push(frame: PitchFrame): TrackerReading | null {
    this.resetAfterGap(frame.tMs);
    if (!(Number.isFinite(frame.f0) && frame.f0 > 0)) {
      this.candidates = [];
      return this.heldReading(frame.tMs);
    }
    this.lastVoicedMs = frame.tMs;
    const rejected = !this.absorb(frame.f0);
    return this.shown(rejected);
  }

  private resetAfterGap(tMs: number): void {
    if (this.lastVoicedMs !== null && tMs - this.lastVoicedMs >= RESET_GAP_MS) {
      this.recent = [];
      this.candidates = [];
      this.displayLog = null;
    }
  }

  private heldReading(tMs: number): TrackerReading | null {
    if (this.lastVoicedMs === null || this.lastShownHz === null) return null;
    if (tMs - this.lastVoicedMs > HOLD_MS) return null;
    return { hz: this.lastShownHz, held: true, rejected: false };
  }

  /** Whether the display took this frame (followed it, or confirmed a jump to it). */
  private absorb(f0: number): boolean {
    if (this.displayLog === null) {
      this.seed([f0]);
      return true;
    }
    if (
      Math.abs(semitonesBetween(2 ** this.displayLog, f0)) <= JUMP_SEMITONES
    ) {
      this.follow(f0);
      return true;
    }
    return this.considerJump(f0);
  }

  private follow(f0: number): void {
    this.candidates = [];
    this.recent = [...this.recent, f0].slice(-MEDIAN_WINDOW);
    const target = Math.log2(median(this.recent));
    if (this.displayLog !== null)
      this.displayLog += SMOOTHING * (target - this.displayLog);
  }

  private considerJump(f0: number): boolean {
    this.candidates = [...this.candidates, f0].slice(-JUMP_CONFIRM_FRAMES);
    if (this.candidates.length < JUMP_CONFIRM_FRAMES) return false;
    const spread = semitonesBetween(
      Math.min(...this.candidates),
      Math.max(...this.candidates),
    );
    if (spread > JUMP_SEMITONES) return false;
    this.seed(this.candidates);
    return true;
  }

  private seed(values: readonly number[]): void {
    this.recent = [...values];
    this.candidates = [];
    this.displayLog = Math.log2(median(values));
  }

  private shown(rejected: boolean): TrackerReading | null {
    if (this.displayLog === null) return null;
    this.lastShownHz = 2 ** this.displayLog;
    return { hz: this.lastShownHz, held: false, rejected };
  }
}

/** Frames the scoring median looks at: enough to drop a one-frame slip, too few to smooth. */
const SCORE_MEDIAN_WINDOW = 3;

/**
 * The pitch that gets scored: median of the last few raw voiced frames and nothing more. The
 * display smoothing is left out on purpose, so wobble and steps keep their real size.
 */
export class RawMedian {
  private recent: number[] = [];
  private lastMs: number | null = null;

  push(f0: number, tMs: number): number {
    if (this.lastMs !== null && tMs - this.lastMs >= RESET_GAP_MS) {
      this.recent = [];
    }
    this.lastMs = tMs;
    this.recent = [...this.recent, f0].slice(-SCORE_MEDIAN_WINDOW);
    return median(this.recent);
  }
}
