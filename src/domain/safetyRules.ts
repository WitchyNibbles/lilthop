// The conditions behind each notice. Each is a small state machine fed one frame at a time.
// None of them says anything about the body: they compare the sound with earlier sound in the
// same session on the same mic, or with the range the person set.
import type { PitchFrame } from "./contract";
import { VOLUME_GATE_RMS } from "./session";
import { median, semitonesBetween } from "./statistics";

export interface FrameView {
  readonly frame: PitchFrame;
  /** Above the volume gate and pitched. */
  readonly voiced: boolean;
  /** The tracker's display pitch for a voiced frame, otherwise null. */
  readonly displayHz: number | null;
}

export interface Rule {
  /** Feed the next frame; true while the condition holds. */
  isActive(view: FrameView): boolean;
}

/** From the plan: a clipped hop peaks at or above this. */
const CLIPPING_PEAK = 0.99;
/** Louder than the start of the session by this factor (2x is 6 dB). */
const LOUDER_FACTOR = 2;
const LOUDER_BASELINE_VOICED_MS = 10_000;
const LOUDER_SUSTAINED_MS = 2_000;
const ABOVE_RANGE_SUSTAINED_MS = 5_000;
/** Silence this long ends a sustained run; shorter pauses between words do not. */
const RUN_BREAK_MS = 500;
/** A frame this far after the previous one is a dropout and adds no time. */
const MAX_FRAME_GAP_MS = 250;
const REST_AFTER_MS = 15 * 60_000;
/** How long the break reminder stays up each time it shows. */
const REST_DUE_WINDOW_MS = 10_000;
/** How long it waits behind clipping or louder before it takes the strip anyway. */
const REST_LONGEST_WAIT_MS = 30_000;
/** This long without sound and the next practice is a new sitting. */
const SITTING_GAP_MS = 5 * 60_000;
const JUMP_SEMITONES = 5;

/** True once `signal` has been true for `durationMs`. Null (no information) neither adds nor breaks. */
class SustainedRun {
  private since: number | null = null;
  private lastTrueMs = 0;

  constructor(private readonly durationMs: number) {}

  update(tMs: number, signal: boolean | null): boolean {
    if (signal === true) {
      this.since ??= tMs;
      this.lastTrueMs = tMs;
    } else if (signal === false || tMs - this.lastTrueMs > RUN_BREAK_MS) {
      this.since = null;
    }
    return this.since !== null && tMs - this.since >= this.durationMs;
  }
}

class ClippingRule implements Rule {
  isActive({ frame }: FrameView): boolean {
    return frame.peak >= CLIPPING_PEAK;
  }
}

/** Compares with the median level of the first 10 voiced seconds of this session. */
class LouderRule implements Rule {
  private baseline: number | null = null;
  private readonly early: number[] = [];
  private earlyVoicedMs = 0;
  private lastMs: number | null = null;
  private readonly run = new SustainedRun(LOUDER_SUSTAINED_MS);

  isActive({ frame, voiced }: FrameView): boolean {
    const gap = this.lastMs === null ? 0 : frame.tMs - this.lastMs;
    this.lastMs = frame.tMs;
    if (this.baseline === null) {
      this.learn(frame.rms, voiced, gap);
      return false;
    }
    return this.run.update(
      frame.tMs,
      voiced ? frame.rms > LOUDER_FACTOR * this.baseline : null,
    );
  }

  private learn(rms: number, voiced: boolean, gapMs: number): void {
    if (!voiced) return;
    this.early.push(rms);
    this.earlyVoicedMs += Math.min(gapMs, MAX_FRAME_GAP_MS);
    if (this.earlyVoicedMs >= LOUDER_BASELINE_VOICED_MS) {
      this.baseline = median(this.early);
    }
  }
}

class AboveRangeRule implements Rule {
  private readonly run = new SustainedRun(ABOVE_RANGE_SUSTAINED_MS);

  constructor(private readonly targetMaxHz: number) {}

  isActive({ frame, displayHz }: FrameView): boolean {
    const signal = displayHz === null ? null : displayHz > this.targetMaxHz;
    return this.run.update(frame.tMs, signal);
  }
}

/**
 * Due every 15 minutes of one sitting, or as soon as sound is back if it came due in a gap, and it
 * stays due until `markShown`. A reminder, not a limit. A sitting can outlast a mic stream, so one
 * rule can serve several monitors in a row.
 */
export class RestBreakRule implements Rule {
  /** Null until the sitting's first sound. */
  private nextDueMs: number | null = null;
  private dueUntilMs = 0;
  /** When a frame first found it due, so mic-off time does not count as waiting. */
  private waitingSinceMs: number | null = null;
  /** The running window was earned by waiting too long, so nothing cuts it short. */
  private heldFullWindow = false;
  private lastSoundMs = 0;
  private latestMs = 0;
  /** Added to frame times, which restart with each stream. */
  private streamStartMs = 0;

  /** A new stream opened, `awayMs` after the last one ended. */
  newStream(awayMs: number): void {
    this.streamStartMs = this.latestMs + awayMs;
  }

  isActive({ frame }: FrameView): boolean {
    const tMs = this.streamStartMs + frame.tMs;
    this.latestMs = tMs;
    if (frame.rms >= VOLUME_GATE_RMS) this.hearSound(tMs);
    if (this.nextDueMs === null) return false;
    if (tMs - this.lastSoundMs >= SITTING_GAP_MS) return false;
    if (tMs < this.dueUntilMs) return true;
    if (tMs < this.nextDueMs) return false;
    this.waitingSinceMs ??= tMs;
    return true;
  }

  /** It reached the person: the ten seconds start now, and the next one keeps the old beat. */
  markShown(): void {
    if (this.nextDueMs === null || this.latestMs < this.dueUntilMs) return;
    this.heldFullWindow = this.hasWaitedTooLong();
    this.dueUntilMs = this.latestMs + REST_DUE_WINDOW_MS;
    this.nextDueMs += REST_AFTER_MS;
    this.waitingSinceMs = null;
  }

  /** True while it goes before every other notice. */
  isOverdue(): boolean {
    return this.latestMs < this.dueUntilMs
      ? this.heldFullWindow
      : this.hasWaitedTooLong();
  }

  private hasWaitedTooLong(): boolean {
    return (
      this.waitingSinceMs !== null &&
      this.latestMs - this.waitingSinceMs > REST_LONGEST_WAIT_MS
    );
  }

  private hearSound(tMs: number): void {
    const rested =
      this.nextDueMs === null || tMs - this.lastSoundMs >= SITTING_GAP_MS;
    if (rested) {
      this.nextDueMs = tMs + REST_AFTER_MS;
      this.waitingSinceMs = null;
    }
    this.lastSoundMs = tMs;
  }
}

/** A big step between two voiced frames in a row. Silence and new onsets never count. */
class PitchJumpRule implements Rule {
  private previousHz: number | null = null;

  isActive({ displayHz }: FrameView): boolean {
    const previous = this.previousHz;
    this.previousHz = displayHz;
    if (previous === null || displayHz === null) return false;
    return Math.abs(semitonesBetween(previous, displayHz)) > JUMP_SEMITONES;
  }
}

export interface RuleSet {
  readonly clipping: Rule;
  readonly louder: Rule;
  readonly restBreak: Rule;
  readonly aboveRange: Rule;
  readonly pitchJump: Rule;
}

export function createRules(
  targetMaxHz: number,
  restBreak: RestBreakRule,
): RuleSet {
  return {
    clipping: new ClippingRule(),
    louder: new LouderRule(),
    restBreak,
    aboveRange: new AboveRangeRule(targetMaxHz),
    pitchJump: new PitchJumpRule(),
  };
}
