/** One point for the trace: what to draw at a frame's time. NaN is a gap. */
export interface TracePoint {
  readonly tMs: number;
  readonly hz: number;
  readonly levelDb: number;
}

/** A raw frame further than this from the line is a jump, not a move. */
const JUMP_SEMITONES = 3;
/** Unvoiced time after which the line starts over. */
const RESET_GAP_MS = 150;

const isVoiced = (hz: number) => Number.isFinite(hz) && hz > 0;

const semitones = (a: number, b: number) => Math.abs(12 * Math.log2(a / b));

/**
 * The pitch line of the trace: the detector's own values, no averaging, so the tip follows the
 * voice as directly as the analysis allows. Only what would flicker is held back, and by one
 * frame at most: a jump of over 3 semitones waits for the next frame to agree, so an octave slip
 * never shows; a single unvoiced frame waits to see whether the voice comes straight back.
 * Held frames come out, in order and with their own times and levels, when the next one arrives.
 */
export class TraceFollower {
  private last: number | null = null;
  private lastVoicedMs = Number.NEGATIVE_INFINITY;
  private held: TracePoint | null = null;

  push(tMs: number, f0: number, levelDb: number): TracePoint[] {
    const out: TracePoint[] = [];
    this.take({ tMs, hz: isVoiced(f0) ? f0 : Number.NaN, levelDb }, out);
    return out;
  }

  private inRun(tMs: number): boolean {
    return this.last !== null && tMs - this.lastVoicedMs < RESET_GAP_MS;
  }

  private near(hz: number, other: number | null): boolean {
    return other !== null && semitones(hz, other) <= JUMP_SEMITONES;
  }

  private show(point: TracePoint, out: TracePoint[]): void {
    out.push(point);
    if (Number.isNaN(point.hz)) return;
    this.last = point.hz;
    this.lastVoicedMs = point.tMs;
  }

  private drop(point: TracePoint, out: TracePoint[]): void {
    out.push({ ...point, hz: Number.NaN });
  }

  private take(frame: TracePoint, out: TracePoint[]): void {
    const held = this.held;
    this.held = null;
    if (held === null) {
      this.start(frame, out);
      return;
    }
    const voiced = !Number.isNaN(frame.hz);
    if (Number.isNaN(held.hz)) {
      // a dropout: a short one is bridged by the line, a long one is a gap
      this.drop(held, out);
      this.start(frame, out);
    } else if (voiced && this.near(frame.hz, held.hz)) {
      this.show(held, out);
      this.show(frame, out);
    } else {
      // the held frame was a slip, or a jump the next frame did not confirm
      this.drop(held, out);
      this.start(frame, out);
    }
  }

  /** A frame with nothing held before it. */
  private start(frame: TracePoint, out: TracePoint[]): void {
    const voiced = !Number.isNaN(frame.hz);
    if (!this.inRun(frame.tMs)) {
      if (voiced) this.held = frame;
      else out.push(frame);
    } else if (voiced && this.near(frame.hz, this.last)) {
      this.show(frame, out);
    } else {
      this.held = frame;
    }
  }
}
