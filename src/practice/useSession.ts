import { useCallback, useMemo, useReducer, useRef } from "react";
import type { NewResult } from "../domain/contract";
import type { Exercise } from "../domain/exercises";
import {
  buildNewResult,
  scoreSession,
  type ScoreOutcome,
  type ScoringContext,
} from "../domain/scoring";
import { pitchSummary, SessionRecorder } from "../domain/session";
import { saveResult } from "../lib/tauri";
import type { LiveFeed } from "../live/liveFeed";

const TICK_MS = 1_000;

export type SaveState =
  | { readonly kind: "none" }
  | { readonly kind: "saving" }
  | { readonly kind: "saved" }
  | { readonly kind: "failed"; readonly error: unknown };

export type SessionState =
  /** `discarded`: `discard()` just dropped a running session, so the strip can say nothing was saved. */
  | { readonly phase: "idle"; readonly discarded: boolean }
  | {
      readonly phase: "running";
      readonly exercise: Exercise;
      readonly elapsedS: number;
    }
  | {
      readonly phase: "result";
      readonly exercise: Exercise;
      readonly outcome: ScoreOutcome;
      readonly pitchMeanHz: number;
      readonly save: SaveState;
    };

type SessionAction =
  | { readonly type: "started"; readonly exercise: Exercise }
  | { readonly type: "tick"; readonly elapsedS: number }
  | {
      readonly type: "finished";
      readonly exercise: Exercise;
      readonly outcome: ScoreOutcome;
      readonly pitchMeanHz: number;
    }
  | { readonly type: "save"; readonly save: SaveState }
  | { readonly type: "reset"; readonly discarded: boolean }
  | { readonly type: "forgetDiscard" };

/** Only an idle state that still carries the note changes; a run or a result comes back as it was. */
function withoutDiscardNote(state: SessionState): SessionState {
  return state.phase === "idle" && state.discarded
    ? { phase: "idle", discarded: false }
    : state;
}

function sessionReducer(
  state: SessionState,
  action: SessionAction,
): SessionState {
  switch (action.type) {
    case "started":
      return { phase: "running", exercise: action.exercise, elapsedS: 0 };
    case "tick":
      return state.phase === "running"
        ? { ...state, elapsedS: action.elapsedS }
        : state;
    case "finished":
      return {
        phase: "result",
        exercise: action.exercise,
        outcome: action.outcome,
        pitchMeanHz: action.pitchMeanHz,
        save: { kind: "none" },
      };
    case "save":
      return state.phase === "result" ? { ...state, save: action.save } : state;
    case "reset":
      return { phase: "idle", discarded: action.discarded };
    case "forgetDiscard":
      return withoutDiscardNote(state);
  }
}

interface ActiveRun {
  readonly exercise: Exercise;
  readonly context: ScoringContext;
  readonly recorder: SessionRecorder;
  readonly leaveFeed: () => void;
}

export interface Session {
  readonly state: SessionState;
  readonly start: (exercise: Exercise, context: ScoringContext) => void;
  readonly finish: () => void;
  /** Drops a running session, or leaves a result, and goes back to idle. Saves nothing and says nothing. */
  readonly reset: () => void;
  /** Like `reset`, but a running session it drops is marked `discarded`, so the strip can say so. */
  readonly discard: () => void;
  /** Clears the discard note and nothing else, so it stays on the screen where the session was dropped. */
  readonly forgetDiscard: () => void;
  readonly retrySave: () => void;
}

/** Runs one exercise: records frames, scores at the end, saves only what was scored. */
export function useSession(feed: LiveFeed, onSaved: () => void): Session {
  const [state, dispatch] = useReducer(sessionReducer, {
    phase: "idle",
    discarded: false,
  });
  const run = useRef<ActiveRun | null>(null);
  const unsaved = useRef<NewResult | null>(null);

  const save = useCallback(
    async (result: NewResult) => {
      dispatch({ type: "save", save: { kind: "saving" } });
      try {
        await saveResult(result);
        unsaved.current = null;
        dispatch({ type: "save", save: { kind: "saved" } });
        onSaved();
      } catch (error) {
        dispatch({ type: "save", save: { kind: "failed", error } });
      }
    },
    [onSaved],
  );

  const finish = useCallback(() => {
    const active = run.current;
    if (active === null) return;
    run.current = null;
    active.leaveFeed();
    const data = active.recorder.snapshot();
    const { exercise } = active;
    const outcome = scoreSession(exercise.measure, data, active.context);
    const pitchMeanHz = pitchSummary(data).mean;
    dispatch({ type: "finished", exercise, outcome, pitchMeanHz });
    unsaved.current = buildNewResult(exercise.id, data, outcome);
    if (unsaved.current !== null) void save(unsaved.current);
  }, [save]);

  const start = useCallback(
    (exercise: Exercise, context: ScoringContext) => {
      const recorder = new SessionRecorder();
      let lastTickMs: number | null = null;
      const leaveFeed = feed.onFrame((frame) => {
        recorder.add(frame);
        lastTickMs ??= frame.tMs;
        if (Math.abs(frame.tMs - lastTickMs) < TICK_MS) return;
        lastTickMs = frame.tMs;
        const { elapsedS } = recorder.snapshot();
        dispatch({ type: "tick", elapsedS });
        if (elapsedS >= exercise.durationS) finish();
      });
      run.current = { exercise, context, recorder, leaveFeed };
      dispatch({ type: "started", exercise });
    },
    [feed, finish],
  );

  /** Lets go of the running session and any unsaved result; true if a session was running. */
  const dropRun = useCallback((): boolean => {
    const active = run.current;
    run.current = null;
    unsaved.current = null;
    active?.leaveFeed();
    return active !== null;
  }, []);

  const reset = useCallback(() => {
    dropRun();
    dispatch({ type: "reset", discarded: false });
  }, [dropRun]);

  const discard = useCallback(() => {
    dispatch({ type: "reset", discarded: dropRun() });
  }, [dropRun]);

  const forgetDiscard = useCallback(() => {
    dispatch({ type: "forgetDiscard" });
  }, []);

  const retrySave = useCallback(() => {
    if (unsaved.current !== null) void save(unsaved.current);
  }, [save]);

  return useMemo(
    () => ({ state, start, finish, reset, discard, forgetDiscard, retrySave }),
    [state, start, finish, reset, discard, forgetDiscard, retrySave],
  );
}
