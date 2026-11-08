import { useCallback, useEffect, useMemo, useReducer } from "react";
import type {
  AudioError,
  AudioErrorKind,
  StreamInfo,
} from "../domain/contract";
import type { Translator } from "../i18n";
import {
  audioErrorMessage,
  commandErrorMessage,
  listInputDevices,
  onAudioError,
  onPitch,
  startPitch,
  stopPitch,
} from "../lib/tauri";
import { listenUntilCleanup } from "../lib/subscription";
import type { LiveFeed } from "../live/liveFeed";
import type { Band } from "../live/traceScale";

export type MicStatus = "off" | "starting" | "on";

/** Kept as what went wrong, not as text, so it follows a language change. */
export type MicIssue =
  | { readonly source: "command"; readonly error: unknown }
  | { readonly source: "audio"; readonly error: AudioError }
  | { readonly source: "fallback" };

interface MicState {
  readonly status: MicStatus;
  readonly device: string | null;
  readonly devices: readonly string[];
  readonly issue: MicIssue | null;
}

type StreamAction =
  | { readonly type: "starting" }
  | { readonly type: "started"; readonly info: StreamInfo }
  | { readonly type: "stopped" }
  | {
      readonly type: "failed";
      readonly status: MicStatus;
      readonly error: unknown;
    }
  | { readonly type: "audio-error"; readonly error: AudioError };

type MicAction =
  | StreamAction
  | { readonly type: "devices"; readonly devices: readonly string[] }
  | { readonly type: "device"; readonly device: string | null }
  | { readonly type: "dismiss" };

const INITIAL_STATE: MicState = {
  status: "off",
  device: null,
  devices: [],
  issue: null,
};

/** Trouble with a recording does not touch the pitch stream; trouble with the device does. */
const ENDS_STREAM: Readonly<Record<AudioErrorKind, boolean>> = {
  device_lost: true,
  stream_failed: true,
  write_failed: false,
  audio_lost: false,
};

function streamReducer(state: MicState, action: StreamAction): MicState {
  switch (action.type) {
    case "starting":
      return { ...state, status: "starting", issue: null };
    case "started":
      return {
        ...state,
        status: "on",
        issue: action.info.fellBack ? { source: "fallback" } : null,
      };
    case "stopped":
      return { ...state, status: "off" };
    case "failed":
      return {
        ...state,
        status: action.status,
        issue: { source: "command", error: action.error },
      };
    case "audio-error":
      return {
        ...state,
        status: ENDS_STREAM[action.error.kind] ? "off" : state.status,
        issue: { source: "audio", error: action.error },
      };
  }
}

function micReducer(state: MicState, action: MicAction): MicState {
  switch (action.type) {
    case "devices":
      return { ...state, devices: action.devices };
    case "device":
      return { ...state, device: action.device };
    case "dismiss":
      return { ...state, issue: null };
    case "starting":
    case "started":
    case "stopped":
    case "failed":
    case "audio-error":
      return streamReducer(state, action);
  }
}

export function micIssueMessage(issue: MicIssue, t: Translator): string {
  switch (issue.source) {
    case "command":
      return commandErrorMessage(issue.error, t);
    case "audio":
      return audioErrorMessage(issue.error, t);
    case "fallback":
      return t("settings.deviceFellBack");
  }
}

export interface Mic extends MicState {
  readonly start: () => Promise<void>;
  readonly stop: () => Promise<void>;
  readonly chooseDevice: (device: string | null) => void;
  readonly dismissIssue: () => void;
}

/** The mic stream: its state, device and errors. Frames go straight to the feed, past React. */
export function useMic(feed: LiveFeed, band: Band | null): Mic {
  const [state, dispatch] = useReducer(micReducer, INITIAL_STATE);

  useEffect(() => {
    const fail = (error: unknown) => {
      dispatch({ type: "failed", status: "off", error });
    };
    const handleAudioError = (error: AudioError) => {
      dispatch({ type: "audio-error", error });
      if (!ENDS_STREAM[error.kind]) return;
      feed.stop();
      // The backend still holds the dead stream and would answer the next start with it.
      stopPitch().catch(fail);
    };
    const leavePitch = listenUntilCleanup(
      () => onPitch((frame) => feed.push(frame)),
      fail,
    );
    const leaveErrors = listenUntilCleanup(
      () => onAudioError(handleAudioError),
      fail,
    );
    listInputDevices()
      .then((devices) => dispatch({ type: "devices", devices }))
      .catch(fail);
    return () => {
      leavePitch();
      leaveErrors();
    };
  }, [feed]);

  // A range saved while the mic runs has to reach the live comparison straight away. Compared by
  // value: every profile save makes a new band object, and most saves do not change the range.
  const isOn = state.status === "on";
  const minHz = band?.minHz;
  const maxHz = band?.maxHz;
  useEffect(() => {
    if (!isOn) return;
    const noBand = minHz === undefined || maxHz === undefined;
    feed.start(noBand ? null : { minHz, maxHz });
  }, [feed, isOn, maxHz, minHz]);

  const openStream = useCallback(async (device: string | null) => {
    dispatch({ type: "starting" });
    try {
      const info = await startPitch(device);
      dispatch({ type: "started", info });
    } catch (error) {
      dispatch({ type: "failed", status: "off", error });
    }
  }, []);

  const closeStream = useCallback(async (): Promise<boolean> => {
    try {
      await stopPitch();
      feed.stop();
      dispatch({ type: "stopped" });
      return true;
    } catch (error) {
      dispatch({ type: "failed", status: "on", error });
      return false;
    }
  }, [feed]);

  const start = useCallback(
    () => openStream(state.device),
    [openStream, state.device],
  );

  const stop = useCallback(async () => {
    await closeStream();
  }, [closeStream]);

  const chooseDevice = useCallback(
    (device: string | null) => {
      dispatch({ type: "device", device });
      if (!isOn) return;
      void closeStream().then((closed) =>
        closed ? openStream(device) : undefined,
      );
    },
    [closeStream, isOn, openStream],
  );

  const dismissIssue = useCallback(() => {
    dispatch({ type: "dismiss" });
  }, []);

  return useMemo(
    () => ({ ...state, start, stop, chooseDevice, dismissIssue }),
    [state, start, stop, chooseDevice, dismissIssue],
  );
}
