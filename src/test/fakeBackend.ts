// The whole Tauri side, faked. No test reaches a real command, device or event.
import type { Profile, RecordingInfo, SavedResult } from "../domain/contract";

type Respond = (args: unknown) => unknown;
type EventHandler = (event: { payload: unknown }) => void;

export interface RecordedCall {
  readonly command: string;
  readonly args: unknown;
}

export const PROFILE: Profile = {
  baselineHz: 130,
  baselineCentroid: 2000,
  baselineRms: 0.05,
  targetMinHz: 165,
  targetMaxHz: 255,
  goals: ["pitch"],
  language: "en",
  theme: "dark",
  onboarded: true,
  pitchEngine: 2,
};

export function recording(part: Partial<RecordingInfo> = {}): RecordingInfo {
  return {
    name: "rec_1.wav",
    sizeBytes: 960_000,
    modifiedTs: 1_790_000_000,
    durationS: 12,
    note: "",
    tags: "",
    ...part,
  };
}

function defaultResponses(): Map<string, Respond> {
  const values: Readonly<Record<string, unknown>> = {
    get_profile: PROFILE,
    get_results: [],
    list_input_devices: ["Desk mic", "Headset"],
    start_pitch: { sampleRate: 48_000, device: "Desk mic", fellBack: false },
    stop_pitch: undefined,
    set_profile: undefined,
    save_result: 1,
    list_recordings: [],
    set_recording_meta: undefined,
    delete_recording: undefined,
    start_recording: { name: "rec_new.wav" },
    stop_recording: recording({ name: "rec_new.wav" }),
    play_recording: undefined,
    stop_playback: undefined,
    export_data: "voice-data.json",
    backup_create: "voice-backup.zip",
    backup_restore: { results: 3, recordings: 2, profile: true },
    delete_all_data: {
      oldFolderRemoved: false,
      previousFolderRemoved: false,
      couldNotCheck: false,
    },
    can_move_earlier_data: false,
    move_earlier_data: undefined,
  };
  return new Map(
    Object.entries(values).map(([command, value]) => [command, () => value]),
  );
}

class FakeBackend {
  calls: RecordedCall[] = [];
  private responses = defaultResponses();
  private handlers = new Map<string, Set<EventHandler>>();

  reset(): void {
    this.calls = [];
    this.responses = defaultResponses();
    this.handlers = new Map();
  }

  respond(command: string, value: unknown): void {
    this.responses.set(command, () => value);
  }

  /** For a command whose answer depends on its arguments or changes other answers. */
  handle(command: string, respond: Respond): void {
    this.responses.set(command, respond);
  }

  fail(command: string, error: unknown): void {
    this.responses.set(command, () => {
      throw error;
    });
  }

  /** Holds a command open until the returned function is called. */
  hold(command: string, value: unknown): () => void {
    let release: () => void = () => undefined;
    const gate = new Promise<unknown>((resolve) => {
      release = () => resolve(value);
    });
    this.responses.set(command, () => gate);
    return () => release();
  }

  lastCallTo(command: string): RecordedCall | undefined {
    return this.callsTo(command).slice(-1)[0];
  }

  callsTo(command: string): RecordedCall[] {
    return this.calls.filter((call) => call.command === command);
  }

  invoke = async (command: string, args?: unknown): Promise<unknown> => {
    this.calls.push({ command, args });
    const respond = this.responses.get(command);
    if (respond === undefined) throw new Error(`unmocked command ${command}`);
    return await respond(args);
  };

  listen = (name: string, handler: EventHandler): Promise<() => void> => {
    const set = this.handlers.get(name) ?? new Set<EventHandler>();
    set.add(handler);
    this.handlers.set(name, set);
    return Promise.resolve(() => {
      set.delete(handler);
    });
  };

  emit(name: string, payload: unknown): void {
    for (const handler of this.handlers.get(name) ?? []) handler({ payload });
  }

  listening(name: string): boolean {
    return (this.handlers.get(name)?.size ?? 0) > 0;
  }
}

export const backend = new FakeBackend();

export function savedResult(part: Partial<SavedResult>): SavedResult {
  return {
    id: 1,
    exerciseId: "pitch_awareness",
    score: 70,
    pitchMean: 190,
    pitchSd: 5,
    durationS: 60,
    voicedS: 50,
    scoringVersion: 2,
    createdAt: 1_790_000_000,
    ...part,
  };
}
