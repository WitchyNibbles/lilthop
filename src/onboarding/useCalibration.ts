import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SessionRecorder } from "../domain/session";
import type { LiveFeed } from "../live/liveFeed";
import { measureBaseline, type Baseline } from "./baseline";

/** About ten seconds of voice, not of clock: pauses to breathe do not count against anyone. */
const TARGET_VOICED_S = 10;
const TICK_MS = 250;

export type CalibrationState =
  | { readonly phase: "idle" }
  | {
      readonly phase: "listening";
      readonly voicedS: number;
      /** The person asked to finish before there was enough voice. */
      readonly tooShort: boolean;
    }
  | { readonly phase: "measured"; readonly baseline: Baseline };

export interface Calibration {
  readonly state: CalibrationState;
  readonly start: () => void;
  readonly finish: () => void;
  readonly reset: () => void;
}

interface Run {
  readonly recorder: SessionRecorder;
  readonly leaveFeed: () => void;
}

export function useCalibration(feed: LiveFeed): Calibration {
  const [state, setState] = useState<CalibrationState>({ phase: "idle" });
  const run = useRef<Run | null>(null);

  const leave = useCallback(() => {
    run.current?.leaveFeed();
    run.current = null;
  }, []);

  const finish = useCallback(() => {
    if (run.current === null) return;
    const data = run.current.recorder.snapshot();
    const baseline = measureBaseline(data);
    if (baseline === null) {
      setState({ phase: "listening", voicedS: data.voicedS, tooShort: true });
      return;
    }
    leave();
    setState({ phase: "measured", baseline });
  }, [leave]);

  const start = useCallback(() => {
    const recorder = new SessionRecorder();
    let lastTickMs: number | null = null;
    const leaveFeed = feed.onFrame((frame) => {
      recorder.add(frame);
      lastTickMs ??= frame.tMs;
      if (Math.abs(frame.tMs - lastTickMs) < TICK_MS) return;
      lastTickMs = frame.tMs;
      const { voicedS } = recorder.snapshot();
      if (voicedS >= TARGET_VOICED_S) finish();
      else setState({ phase: "listening", voicedS, tooShort: false });
    });
    run.current = { recorder, leaveFeed };
    setState({ phase: "listening", voicedS: 0, tooShort: false });
  }, [feed, finish]);

  const reset = useCallback(() => {
    leave();
    setState({ phase: "idle" });
  }, [leave]);

  useEffect(() => leave, [leave]);

  return useMemo(
    () => ({ state, start, finish, reset }),
    [state, start, finish, reset],
  );
}
