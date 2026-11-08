// Typed wrappers for the IPC contract. Command and event names are exactly the backend's.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AudioError,
  DeleteReport,
  ExportFormat,
  NewResult,
  PitchFrame,
  PlaybackEnded,
  Profile,
  RecordingInfo,
  RestoreSummary,
  SavedResult,
  StreamInfo,
} from "../domain/contract";
import { MESSAGES, type MessageKey, type Translator } from "../i18n";

/** A failed command. `kind` is the backend's error kind, or "unknown" if it sent none. */
export class AppCommandError extends Error {
  constructor(
    readonly kind: string,
    message: string,
    readonly command: string,
  ) {
    super(message);
    this.name = "AppCommandError";
  }
}

function isBackendError(
  value: unknown,
): value is { kind: string; message: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof value.kind === "string" &&
    "message" in value &&
    typeof value.message === "string"
  );
}

function toCommandError(error: unknown, command: string): AppCommandError {
  if (isBackendError(error))
    return new AppCommandError(error.kind, error.message, command);
  const message = error instanceof Error ? error.message : String(error);
  return new AppCommandError("unknown", message, command);
}

async function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    const failure = toCommandError(error, command);
    // The backend's words are English and for the log; the screen says it in the reader's language.
    console.error(`${command}: ${failure.message}`);
    throw failure;
  }
}

export const listInputDevices = (): Promise<string[]> =>
  call("list_input_devices");
export const startPitch = (deviceName: string | null): Promise<StreamInfo> =>
  call("start_pitch", { deviceName });
export const stopPitch = (): Promise<void> => call("stop_pitch");
export const startRecording = (
  deviceName: string | null,
): Promise<{ name: string }> => call("start_recording", { deviceName });
export const stopRecording = (): Promise<RecordingInfo> =>
  call("stop_recording");
export const playRecording = (name: string): Promise<void> =>
  call("play_recording", { name });
export const stopPlayback = (): Promise<void> => call("stop_playback");
export const listRecordings = (): Promise<RecordingInfo[]> =>
  call("list_recordings");
export const deleteRecording = (name: string): Promise<void> =>
  call("delete_recording", { name });
export const setRecordingMeta = (
  name: string,
  note: string,
  tags: string,
): Promise<void> => call("set_recording_meta", { name, note, tags });
export const getProfile = (): Promise<Profile | null> => call("get_profile");
export const setProfile = (profile: Profile): Promise<void> =>
  call("set_profile", { profile });
export const saveResult = (result: NewResult): Promise<number> =>
  call("save_result", { result });
export const getResults = (): Promise<SavedResult[]> => call("get_results");
/** The saved file's name, or null when the dialog was cancelled. */
export const exportData = (format: ExportFormat): Promise<string | null> =>
  call("export_data", { format });
export const backupCreate = (): Promise<string | null> => call("backup_create");
export const backupRestore = (): Promise<RestoreSummary | null> =>
  call("backup_restore");
export const deleteAllData = (): Promise<DeleteReport> =>
  call("delete_all_data");
/** Stop trying to move the earlier data over and open an empty database. The old folder is not touched. */
export const startFresh = (): Promise<void> => call("start_fresh");
/** True when Start fresh skipped a move that can still be done: nothing was saved since. */
export const canMoveEarlierData = (): Promise<boolean> =>
  call("can_move_earlier_data");
/** The way back from Start fresh. Rejects with `migration_failed` if the move fails again. */
export const moveEarlierData = (): Promise<void> => call("move_earlier_data");

export const onPitch = (
  handler: (frame: PitchFrame) => void,
): Promise<UnlistenFn> =>
  listen<PitchFrame>("pitch", (event) => handler(event.payload));
export const onAudioError = (
  handler: (error: AudioError) => void,
): Promise<UnlistenFn> =>
  listen<AudioError>("audio-error", (event) => handler(event.payload));
export const onPlaybackEnded = (
  handler: (ended: PlaybackEnded) => void,
): Promise<UnlistenFn> =>
  listen<PlaybackEnded>("playback-ended", (event) => handler(event.payload));

function isErrorKey(key: string): key is MessageKey {
  return key in MESSAGES.en;
}

/** Text for the reader. Known kinds have their own message; anything else gets a general one. */
export function commandErrorMessage(error: unknown, t: Translator): string {
  const key =
    error instanceof AppCommandError ? `error.${error.kind}` : "error.unknown";
  return t(isErrorKey(key) ? key : "error.unknown");
}

export function audioErrorMessage(error: AudioError, t: Translator): string {
  return t(`error.${error.kind}`);
}
