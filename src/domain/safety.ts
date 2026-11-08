// Frames in, at most one notice out. Nothing here claims to detect strain, damage or tiredness:
// the app hears sound and cannot feel a throat. Notices compare with earlier in the same session,
// or with the range the person set, and say so.
import type { MessageKey } from "../i18n";
import type { PitchFrame } from "./contract";
import { PitchTracker } from "./pitchTracker";
import { createRules, RestBreakRule, type RuleSet } from "./safetyRules";
import { VOLUME_GATE_RMS } from "./session";

/**
 * Most important first; when several are due, the first one wins.
 * - clipping: a mic problem. It distorts the level and the pitch, so every other reading is
 *   unreliable until it is fixed, and the fix is easy.
 * - louder: the one notice that points at effort, and the only one that is useful within seconds.
 * - restBreak: matters, but is time-based and can wait a few seconds. Not for ever, though: see
 *   OVERDUE_PRIORITY.
 * - aboveRange: neutral information about the person's own range.
 * - pitchJump: neutral, and often on purpose in glides and sirens.
 */
export const NOTICE_PRIORITY = [
  "clipping",
  "louder",
  "restBreak",
  "aboveRange",
  "pitchJump",
] as const;

export type NoticeId = (typeof NOTICE_PRIORITY)[number];

/** A rest reminder that waited too long goes first for its ten seconds, then the others return. */
const OVERDUE_PRIORITY: readonly NoticeId[] = [
  "restBreak",
  ...NOTICE_PRIORITY.filter((id) => id !== "restBreak"),
];

/** A dismissible alert goes after these. The neutral notices give way to it. */
export function goesBeforeAlert(id: NoticeId | null): boolean {
  return id === "clipping" || id === "louder" || id === "restBreak";
}

export const NOTICE_MESSAGE: Readonly<Record<NoticeId, MessageKey>> = {
  clipping: "notice.clipping",
  louder: "notice.louder",
  restBreak: "safety.s7",
  aboveRange: "notice.aboveRange",
  pitchJump: "notice.pitchJump",
};

/** A notice stays at least this long once shown, so it can be read. */
export const MIN_DISPLAY_MS = 3_000;
/** And it stays this long after its condition was last true, so a flickering condition is steady. */
const LINGER_MS = 1_000;

export interface SafetyContext {
  /** Top of the range the person set. */
  readonly targetMaxHz: number;
  /** Pass one in to keep the sitting going past this monitor. */
  readonly restBreak?: RestBreakRule;
}

interface Shown {
  readonly id: NoticeId;
  readonly sinceMs: number;
  readonly lastActiveMs: number;
}

/**
 * Create one per mic session: it learns the starting level of that session, and frame times
 * restart when the stream does. Only the rest break looks further back than that.
 */
export class SafetyMonitor {
  private readonly tracker = new PitchTracker();
  private readonly restBreak: RestBreakRule;
  private readonly rules: RuleSet;
  private shown: Shown | null = null;

  constructor(context: SafetyContext) {
    this.restBreak = context.restBreak ?? new RestBreakRule();
    this.rules = createRules(context.targetMaxHz, this.restBreak);
  }

  /** The notice to show after this frame, or null. */
  push(frame: PitchFrame): NoticeId | null {
    const next = this.select(this.activeAt(frame), frame.tMs);
    if (next?.id === "restBreak" && this.shown?.id !== "restBreak")
      this.restBreak.markShown();
    this.shown = next;
    return next?.id ?? null;
  }

  private activeAt(frame: PitchFrame): readonly NoticeId[] {
    const reading = this.tracker.push(frame);
    const voiced = frame.f0 > 0 && frame.rms >= VOLUME_GATE_RMS;
    const view = {
      frame,
      voiced,
      displayHz:
        voiced && reading !== null && !reading.held ? reading.hz : null,
    };
    return NOTICE_PRIORITY.filter((id) => this.rules[id].isActive(view));
  }

  private select(active: readonly NoticeId[], tMs: number): Shown | null {
    const order = this.restBreak.isOverdue()
      ? OVERDUE_PRIORITY
      : NOTICE_PRIORITY;
    const best = order.find((id) => active.includes(id));
    const current = this.shown;
    if (current === null) return best === undefined ? null : start(best, tMs);
    const renewed = active.includes(current.id)
      ? { ...current, lastActiveMs: tMs }
      : current;
    if (tMs - current.sinceMs < MIN_DISPLAY_MS) return renewed;
    if (best !== undefined && order.indexOf(best) < order.indexOf(current.id))
      return start(best, tMs);
    if (tMs - renewed.lastActiveMs < LINGER_MS) return renewed;
    return best === undefined ? null : start(best, tMs);
  }
}

function start(id: NoticeId, tMs: number): Shown {
  return { id, sinceMs: tMs, lastActiveMs: tMs };
}
