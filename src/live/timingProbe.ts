import type { PitchFrame } from "../domain/contract";

/** What one second of live frames looked like from the screen's side. */
export interface TimingReport {
  readonly frames: number;
  /** How much later than its best so far the newest frame arrived, against the audio clock. */
  readonly behindMs: number;
  readonly worstBehindMs: number;
  readonly longestGapMs: number;
  readonly longestPaintGapMs: number;
}

/**
 * Watches when frames arrive against the sample clock they carry. A constant delay (audio
 * buffer, event transport) is the floor and not counted; what grows above it is a queue
 * somewhere between the microphone and the screen.
 */
export class TimingProbe {
  private floorMs = Number.POSITIVE_INFINITY;
  private lastArrivalMs: number | null = null;
  private lastPaintMs: number | null = null;
  private frames = 0;
  private behindMs = 0;
  private worstBehindMs = 0;
  private longestGapMs = 0;
  private longestPaintGapMs = 0;

  frame(tMs: number, arrivedMs: number): void {
    const delay = arrivedMs - tMs;
    this.floorMs = Math.min(this.floorMs, delay);
    this.behindMs = delay - this.floorMs;
    this.worstBehindMs = Math.max(this.worstBehindMs, this.behindMs);
    if (this.lastArrivalMs !== null)
      this.longestGapMs = Math.max(
        this.longestGapMs,
        arrivedMs - this.lastArrivalMs,
      );
    this.lastArrivalMs = arrivedMs;
    this.frames++;
  }

  paint(atMs: number): void {
    if (this.lastPaintMs !== null)
      this.longestPaintGapMs = Math.max(
        this.longestPaintGapMs,
        atMs - this.lastPaintMs,
      );
    this.lastPaintMs = atMs;
  }

  /** What came in since the last call. The floor carries on. */
  take(): TimingReport {
    const report: TimingReport = {
      frames: this.frames,
      behindMs: this.behindMs,
      worstBehindMs: this.worstBehindMs,
      longestGapMs: this.longestGapMs,
      longestPaintGapMs: this.longestPaintGapMs,
    };
    this.frames = 0;
    this.worstBehindMs = this.behindMs;
    this.longestGapMs = 0;
    this.longestPaintGapMs = 0;
    return report;
  }
}

const STORAGE_KEY = "lilthop-timing";
const REPORT_EVERY_MS = 1_000;

/** Off unless `localStorage["lilthop-timing"]` is "1". */
export function timingEnabled(storage: Pick<Storage, "getItem">): boolean {
  try {
    return storage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** The parts of the browser the probe touches, so a test can supply its own. */
export interface TimingEnv {
  readonly enabled: boolean;
  readonly reducedMotion: boolean;
  readonly now: () => number;
  readonly log: (line: string) => void;
  readonly requestFrame: (callback: (atMs: number) => void) => number;
  readonly cancelFrame: (id: number) => void;
  readonly every: (callback: () => void, ms: number) => () => void;
}

export function browserTimingEnv(): TimingEnv {
  return {
    enabled: timingEnabled(window.localStorage),
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches,
    now: () => performance.now(),
    log: (line) => {
      console.info(line);
    },
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (id) => {
      window.cancelAnimationFrame(id);
    },
    every: (callback, ms) => {
      const id = window.setInterval(callback, ms);
      return () => {
        window.clearInterval(id);
      };
    },
  };
}

function describeReport(report: TimingReport, reducedMotion: boolean): string {
  const ms = (value: number) => `${Math.round(value)} ms`;
  return [
    `pitch timing: ${report.frames} frames`,
    `behind ${ms(report.behindMs)} (worst ${ms(report.worstBehindMs)})`,
    `longest gap between frames ${ms(report.longestGapMs)}`,
    `between paints ${ms(report.longestPaintGapMs)}`,
    `reduced motion ${reducedMotion ? "on" : "off"}`,
  ].join(", ");
}

/**
 * Developer aid: prints one line a second to the console. Does nothing, and costs nothing, unless
 * the flag is set. No data leaves the page. Returns the function that stops it.
 */
export function startTimingProbe(
  feed: { onFrame(listener: (frame: PitchFrame) => void): () => void },
  env: TimingEnv = browserTimingEnv(),
): () => void {
  if (!env.enabled) return () => undefined;
  const probe = new TimingProbe();
  const leaveFeed = feed.onFrame((frame) => {
    probe.frame(frame.tMs, env.now());
  });
  let paintId = 0;
  const watchPaints = (atMs: number) => {
    probe.paint(atMs);
    paintId = env.requestFrame(watchPaints);
  };
  paintId = env.requestFrame(watchPaints);
  const stopReports = env.every(() => {
    env.log(describeReport(probe.take(), env.reducedMotion));
  }, REPORT_EVERY_MS);
  return () => {
    leaveFeed();
    env.cancelFrame(paintId);
    stopReports();
  };
}
