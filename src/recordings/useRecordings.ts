import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { AudioError, RecordingInfo } from "../domain/contract";
import type { MessageKey } from "../i18n";
import {
  AppCommandError,
  deleteRecording,
  listRecordings,
  onAudioError,
  onPlaybackEnded,
  playRecording,
  setRecordingMeta,
  startRecording,
  stopPlayback,
  stopRecording,
} from "../lib/tauri";
import { listenUntilCleanup } from "../lib/subscription";

export type RecorderStatus = "idle" | "starting" | "recording" | "stopping";

export type RecordingsNotice =
  | { readonly kind: "message"; readonly key: MessageKey }
  | { readonly kind: "error"; readonly error: unknown };

interface RecordingsState {
  readonly items: readonly RecordingInfo[];
  readonly loaded: boolean;
  readonly recorder: RecorderStatus;
  readonly playing: string | null;
  readonly notice: RecordingsNotice | null;
}

type RecordingsAction =
  | { readonly type: "listed"; readonly items: readonly RecordingInfo[] }
  | { readonly type: "recorder"; readonly recorder: RecorderStatus }
  | { readonly type: "recorded"; readonly item: RecordingInfo }
  | { readonly type: "playing"; readonly name: string | null }
  | { readonly type: "ended"; readonly name: string }
  | { readonly type: "removed"; readonly name: string }
  | { readonly type: "meta"; readonly item: RecordingInfo }
  | { readonly type: "failed"; readonly error: unknown }
  | { readonly type: "cleared" };

/**
 * Only a failed start or stop changes the recorder; other failures leave it running.
 * A failed stop ends at idle too: the backend has already let go of the recording.
 */
function recorderAfterFailure(recorder: RecorderStatus): RecorderStatus {
  return recorder === "starting" || recorder === "stopping" ? "idle" : recorder;
}

const isWriteFailure = (error: unknown): boolean =>
  error instanceof AppCommandError && error.kind === "write_failed";

/** Only the recorder speaks for the take, and a gap in the audio doesn't end it. */
const endsTake = ({ source, kind }: AudioError): boolean =>
  source === "recorder" && kind !== "audio_lost";

function notPlaying(playing: string | null, name: string): string | null {
  return playing === name ? null : playing;
}

function recordingsReducer(
  state: RecordingsState,
  action: RecordingsAction,
): RecordingsState {
  switch (action.type) {
    case "listed":
      return { ...state, items: action.items, loaded: true };
    case "recorder":
      return { ...state, recorder: action.recorder, notice: null };
    case "recorded":
      return {
        ...state,
        recorder: "idle",
        items: [action.item, ...state.items],
      };
    case "playing":
      return { ...state, playing: action.name, notice: null };
    case "ended":
      return { ...state, playing: notPlaying(state.playing, action.name) };
    case "removed":
      return {
        ...state,
        items: state.items.filter((item) => item.name !== action.name),
        playing: notPlaying(state.playing, action.name),
        notice: { kind: "message", key: "recordings.deleted" },
      };
    case "meta":
      return {
        ...state,
        items: state.items.map((item) =>
          item.name === action.item.name ? action.item : item,
        ),
      };
    case "failed":
      return {
        ...state,
        loaded: true,
        recorder: recorderAfterFailure(state.recorder),
        notice: { kind: "error", error: action.error },
      };
    case "cleared":
      return { ...INITIAL_STATE, loaded: true };
  }
}

const INITIAL_STATE: RecordingsState = {
  items: [],
  loaded: false,
  recorder: "idle",
  playing: null,
  notice: null,
};

export interface Recordings extends RecordingsState {
  readonly refresh: () => void;
  readonly record: () => void;
  readonly stop: () => void;
  readonly play: (name: string) => void;
  readonly stopPlaying: () => void;
  readonly remove: (name: string) => void;
  /** Rejects when it could not save, so the row can keep the text and offer a retry. */
  readonly saveMeta: (item: RecordingInfo) => Promise<void>;
  /** After everything was deleted: the backend let go of the audio, so nothing is running. */
  readonly clear: () => void;
}

/** Held above the screens: a recording keeps running while someone looks at something else. */
export function useRecordings(device: string | null): Recordings {
  const [state, dispatch] = useReducer(recordingsReducer, INITIAL_STATE);

  const fail = useCallback((error: unknown) => {
    dispatch({ type: "failed", error });
  }, []);

  useEffect(
    () =>
      listenUntilCleanup(
        () => onPlaybackEnded(({ name }) => dispatch({ type: "ended", name })),
        fail,
      ),
    [fail],
  );

  const refresh = useCallback(() => {
    listRecordings()
      .then((items) => dispatch({ type: "listed", items }))
      .catch(fail);
  }, [fail]);

  const recorderNow = useRef<RecorderStatus>("idle");
  useEffect(() => {
    recorderNow.current = state.recorder;
  }, [state.recorder]);

  /** The start hasn't answered yet, so there is nothing to stop until it does. */
  const diedWhileStarting = useRef(false);

  /** The recorder died on its own and the alert already says why, so its stop must not say it twice. */
  const closeDeadTake = useCallback(() => {
    recorderNow.current = "stopping";
    dispatch({ type: "recorder", recorder: "stopping" });
    stopRecording()
      .then((item) => dispatch({ type: "recorded", item }))
      .catch((error: unknown) => {
        if (isWriteFailure(error))
          dispatch({ type: "recorder", recorder: "idle" });
        else fail(error);
        refresh();
      });
  }, [fail, refresh]);

  useEffect(
    () =>
      listenUntilCleanup(
        () =>
          onAudioError((error) => {
            if (!endsTake(error)) return;
            if (recorderNow.current === "recording") closeDeadTake();
            if (recorderNow.current === "starting")
              diedWhileStarting.current = true;
          }),
        fail,
      ),
    [closeDeadTake, fail],
  );

  const record = useCallback(() => {
    diedWhileStarting.current = false;
    recorderNow.current = "starting";
    dispatch({ type: "recorder", recorder: "starting" });
    startRecording(device)
      .then(() => {
        recorderNow.current = "recording";
        dispatch({ type: "recorder", recorder: "recording" });
        if (diedWhileStarting.current) closeDeadTake();
      })
      .catch(fail);
  }, [closeDeadTake, device, fail]);

  const stop = useCallback(() => {
    dispatch({ type: "recorder", recorder: "stopping" });
    stopRecording()
      .then((item) => dispatch({ type: "recorded", item }))
      .catch((error: unknown) => {
        fail(error);
        // Whatever part of the take reached the disk is there now; show it.
        refresh();
      });
  }, [fail, refresh]);

  const play = useCallback(
    (name: string) => {
      playRecording(name)
        .then(() => dispatch({ type: "playing", name }))
        .catch(fail);
    },
    [fail],
  );

  const stopPlaying = useCallback(() => {
    stopPlayback()
      .then(() => dispatch({ type: "playing", name: null }))
      .catch(fail);
  }, [fail]);

  const { playing } = state;
  const remove = useCallback(
    (name: string) => {
      const release = playing === name ? stopPlayback() : Promise.resolve();
      release
        .then(() => deleteRecording(name))
        .then(() => dispatch({ type: "removed", name }))
        .catch(fail);
    },
    [fail, playing],
  );

  const saveMeta = useCallback(async (item: RecordingInfo) => {
    await setRecordingMeta(item.name, item.note, item.tags);
    dispatch({ type: "meta", item });
  }, []);

  const clear = useCallback(() => {
    dispatch({ type: "cleared" });
  }, []);

  return useMemo(
    () => ({
      ...state,
      refresh,
      record,
      stop,
      play,
      stopPlaying,
      remove,
      saveMeta,
      clear,
    }),
    [state, refresh, record, stop, play, stopPlaying, remove, saveMeta, clear],
  );
}
