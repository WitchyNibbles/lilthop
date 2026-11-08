import type { PitchFrame } from "../domain/contract";
import { PitchTracker, type TrackerReading } from "../domain/pitchTracker";
import { SafetyMonitor, type NoticeId } from "../domain/safety";
import { RestBreakRule } from "../domain/safetyRules";
import { VOLUME_GATE_RMS } from "../domain/session";
import { TraceBuffer } from "./traceBuffer";
import { TraceFollower } from "./traceFollower";
import type { Band } from "./traceScale";

/** "voice" is a voice with no band to compare it with. */
export type Zone = "quiet" | "voice" | "below" | "in" | "above";

/** What the screen shows. Changes a few times a second at most, whatever the frame rate. */
export interface LiveView {
  /** Whole Hz. Stays on the last value through silence; null with no reading or the mic off. */
  readonly hz: number | null;
  readonly pitchDimmed: boolean;
  readonly levelDb: number | null;
  readonly soundDimmed: boolean;
  /** Spectral centroid in whole Hz, a rough hint only. */
  readonly brightnessHz: number | null;
  readonly zone: Zone;
  readonly notice: NoticeId | null;
}

const INITIAL_VIEW: LiveView = {
  hz: null,
  pitchDimmed: true,
  levelDb: null,
  soundDimmed: true,
  brightnessHz: null,
  zone: "quiet",
  notice: null,
};

/** About six updates a second: fast enough to follow, slow enough to read. */
const VIEW_INTERVAL_MS = 1000 / 6;
/** A pause longer than a gap between words. */
const DIM_AFTER_MS = 800;
const ENTER_ZONE_MS = 150;
const CHANGE_ZONE_MS = 500;
const GO_QUIET_MS = 1_200;
const LOWEST_LEVEL_DB = -60;

function sameView(a: LiveView, b: LiveView): boolean {
  return (
    a.hz === b.hz &&
    a.pitchDimmed === b.pitchDimmed &&
    a.levelDb === b.levelDb &&
    a.soundDimmed === b.soundDimmed &&
    a.brightnessHz === b.brightnessHz &&
    a.zone === b.zone &&
    a.notice === b.notice
  );
}

function toDecibels(rms: number): number {
  return Math.max(LOWEST_LEVEL_DB, 20 * Math.log10(rms));
}

function zoneOf(hz: number | null, band: Band | null): Zone {
  if (hz === null) return "quiet";
  if (band === null) return "voice";
  if (hz < band.minHz) return "below";
  return hz > band.maxHz ? "above" : "in";
}

/** Lets the zone change only once the new one has lasted, so pauses and wobbles do not flip it. */
class ZoneFilter {
  private shown: Zone = "quiet";
  private candidate: Zone = "quiet";
  private sinceMs = 0;

  update(raw: Zone, tMs: number): Zone {
    if (raw !== this.candidate) {
      this.candidate = raw;
      this.sinceMs = tMs;
    }
    if (tMs - this.sinceMs >= this.dwellFor(raw)) this.shown = raw;
    return this.shown;
  }

  private dwellFor(raw: Zone): number {
    if (raw === "quiet") return GO_QUIET_MS;
    return this.shown === "quiet" ? ENTER_ZONE_MS : CHANGE_ZONE_MS;
  }
}

/** Mean of what came in since the last time it was read. */
class IntervalMean {
  private sum = 0;
  private count = 0;

  add(value: number): void {
    this.sum += value;
    this.count++;
  }

  take(): number | null {
    if (this.count === 0) return null;
    const value = this.sum / this.count;
    this.sum = 0;
    this.count = 0;
    return value;
  }
}

/** One mic session's worth of state. A new stream starts a new one, as its frame times restart. */
class MicSession {
  readonly tracker = new PitchTracker();
  readonly monitor: SafetyMonitor;
  readonly zone = new ZoneFilter();
  readonly level = new IntervalMean();
  readonly brightness = new IntervalMean();
  readonly line = new TraceFollower();
  lastViewMs = Number.NEGATIVE_INFINITY;
  lastVoiceMs = Number.NEGATIVE_INFINITY;
  lastSoundMs = Number.NEGATIVE_INFINITY;
  latestHz: number | null = null;
  shownZone: Zone = "quiet";
  notice: NoticeId | null = null;

  constructor(
    readonly band: Band | null,
    restBreak: RestBreakRule,
  ) {
    this.monitor = new SafetyMonitor({
      targetMaxHz: band?.maxHz ?? Number.POSITIVE_INFINITY,
      restBreak,
    });
  }
}

const isVoiced = (reading: TrackerReading | null): reading is TrackerReading =>
  reading !== null && !reading.held;

/**
 * The one place live frames come in. The trace reads `trace` on its own clock; React reads
 * `getView`, which changes rarely enough to render; a running session taps `onFrame`.
 */
export class LiveFeed {
  readonly trace = new TraceBuffer();
  private session: MicSession | null = null;
  /** Outlives the sessions: turning the mic off and on is not a rest. */
  private readonly restBreak = new RestBreakRule();
  private stoppedAtMs: number | null = null;
  private view = INITIAL_VIEW;
  private readonly viewListeners = new Set<() => void>();
  private readonly frameListeners = new Set<(frame: PitchFrame) => void>();

  readonly getView = (): LiveView => this.view;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  };

  onFrame(listener: (frame: PitchFrame) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  start(band: Band | null): void {
    if (this.stoppedAtMs !== null)
      this.restBreak.newStream(Date.now() - this.stoppedAtMs);
    this.stoppedAtMs = null;
    this.session = new MicSession(band, this.restBreak);
    this.trace.clear();
    this.show({ ...this.view, notice: null });
  }

  stop(): void {
    if (this.session !== null) this.stoppedAtMs = Date.now();
    this.session = null;
    this.show(INITIAL_VIEW);
  }

  push(frame: PitchFrame): void {
    const session = this.session;
    if (session === null) return;
    const reading = session.tracker.push(frame);
    session.notice = session.monitor.push(frame);
    this.record(session, frame, reading);
    for (const listener of this.frameListeners) listener(frame);
    if (frame.tMs - session.lastViewMs < VIEW_INTERVAL_MS) return;
    session.lastViewMs = frame.tMs;
    this.show(this.compose(session, frame.tMs));
  }

  private record(
    session: MicSession,
    frame: PitchFrame,
    reading: TrackerReading | null,
  ): void {
    const heard = frame.rms >= VOLUME_GATE_RMS;
    const voiced = isVoiced(reading);
    session.latestHz = reading?.hz ?? null;
    const zone = zoneOf(session.latestHz, session.band);
    session.shownZone = session.zone.update(zone, frame.tMs);
    if (heard) {
      session.lastSoundMs = frame.tMs;
      session.level.add(frame.rms);
    }
    if (voiced) {
      session.lastVoiceMs = frame.tMs;
      if (frame.centroid > 0) session.brightness.add(frame.centroid);
    }
    // The trace takes the detector's own value; the smoothing is for the number.
    const points = session.line.push(
      frame.tMs,
      frame.f0,
      heard ? toDecibels(frame.rms) : Number.NaN,
    );
    for (const point of points)
      this.trace.push(point.tMs, point.hz, point.levelDb);
  }

  private compose(session: MicSession, tMs: number): LiveView {
    const rms = session.level.take();
    const centroid = session.brightness.take();
    const { view } = this;
    return {
      hz: session.latestHz === null ? view.hz : Math.round(session.latestHz),
      pitchDimmed: tMs - session.lastVoiceMs >= DIM_AFTER_MS,
      levelDb: rms === null ? view.levelDb : Math.round(toDecibels(rms)),
      soundDimmed: tMs - session.lastSoundMs >= DIM_AFTER_MS,
      brightnessHz:
        centroid === null ? view.brightnessHz : Math.round(centroid),
      zone: session.shownZone,
      notice: session.notice,
    };
  }

  private show(next: LiveView): void {
    if (sameView(next, this.view)) return;
    this.view = next;
    for (const listener of this.viewListeners) listener();
  }
}
