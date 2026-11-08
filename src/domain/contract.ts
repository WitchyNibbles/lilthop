// Shapes that cross the IPC boundary. The Rust side serializes with camelCase and mirrors these.

export interface PitchFrame {
  /** Milliseconds since the stream started, derived from the sample count. */
  readonly tMs: number;
  /** Hz. 0 when unvoiced or below the volume gate. */
  readonly f0: number;
  /** 0..1 */
  readonly rms: number;
  /** 0..1, largest absolute sample in the hop. */
  readonly peak: number;
  /** Hz. 0 when below the volume gate. */
  readonly centroid: number;
}

export interface StreamInfo {
  readonly sampleRate: number;
  readonly device: string;
  readonly fellBack: boolean;
}

export interface RecordingInfo {
  /** Bare file name: the only handle the webview gets. */
  readonly name: string;
  readonly sizeBytes: number;
  readonly modifiedTs: number;
  readonly durationS: number;
  readonly note: string;
  readonly tags: string;
}

export type Language = "en" | "es";
export type Theme = "dark" | "light";

export interface Profile {
  readonly baselineHz: number;
  readonly baselineCentroid: number;
  readonly baselineRms: number;
  readonly targetMinHz: number;
  readonly targetMaxHz: number;
  readonly goals: readonly string[];
  readonly language: Language;
  readonly theme: Theme;
  readonly onboarded: boolean;
  /** 1 = measured by the old biased detector, 2 = fixed detector. */
  readonly pitchEngine: number;
}

export interface NewResult {
  readonly exerciseId: string;
  /** 0..100, or null for practice that is not scored (brightness). */
  readonly score: number | null;
  readonly pitchMean: number;
  readonly pitchSd: number;
  readonly durationS: number;
  readonly voicedS: number;
  readonly scoringVersion: number;
}

export interface SavedResult extends NewResult {
  readonly id: number;
  /** Unix seconds. */
  readonly createdAt: number;
}

export interface RestoreSummary {
  readonly results: number;
  readonly recordings: number;
  readonly profile: boolean;
}

/** What "delete all data" did beyond the current data. */
export interface DeleteReport {
  /** The first version's folder was removed. */
  readonly oldFolderRemoved: boolean;
  /** The previous identifier's folder was removed. */
  readonly previousFolderRemoved: boolean;
  /** An older folder's database could not be read, so the folder was left in place. */
  readonly couldNotCheck: boolean;
}

/** Which stream reported it. The pitch stream and the recorder fail on their own. */
export type AudioSource = "pitch" | "recorder";

export type AudioErrorKind =
  "device_lost" | "write_failed" | "stream_failed" | "audio_lost";

export interface AudioError {
  readonly source: AudioSource;
  readonly kind: AudioErrorKind;
  readonly message: string;
}

export interface PlaybackEnded {
  readonly name: string;
}

export type ExportFormat = "json" | "csv";
