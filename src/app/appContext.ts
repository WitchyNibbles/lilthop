import type { Language, Profile, SavedResult, Theme } from "../domain/contract";
import type { Exercise } from "../domain/exercises";
import type { ScoringContext } from "../domain/scoring";
import type { Translator } from "../i18n";
import type { LiveFeed } from "../live/liveFeed";
import type { Band } from "../live/traceScale";
import type { Mic } from "../mic/useMic";
import type { Session } from "../practice/useSession";
import type { Recordings } from "../recordings/useRecordings";
import { strictContext } from "./strictContext";

/**
 * Only "read" says `profile` is what is on disk, and a null there means a real first run.
 * Anything else may be hiding a saved profile, so nothing may be written over it.
 */
export type ProfileRead = "reading" | "read" | "failed" | "retrying";

export type Screen =
  | "home"
  | "practice"
  | "progress"
  | "recordings"
  | "settings"
  | "safety"
  | "calibrate";

export interface Route {
  readonly screen: Screen;
  /** What Practice opens on; null means the next thing in the routine. */
  readonly exercise: Exercise | null;
}

export interface Preferences {
  readonly language: Language;
  readonly theme: Theme;
}

/** What a person who has saved nothing yet has: no measurements, no range, no goals. */
export function blankProfile({ language, theme }: Preferences): Profile {
  return {
    baselineHz: 0,
    baselineCentroid: 0,
    baselineRms: 0,
    targetMinHz: 0,
    targetMaxHz: 0,
    goals: [],
    language,
    theme,
    onboarded: false,
    pitchEngine: 2,
  };
}

export interface AppValue extends Preferences {
  readonly t: Translator;
  readonly loaded: boolean;
  readonly profileRead: ProfileRead;
  /** The error that made the last profile read fail, kept for the screen that explains it. */
  readonly readError: unknown;
  readonly profile: Profile | null;
  readonly results: readonly SavedResult[];
  readonly band: Band | null;
  readonly scoring: ScoringContext | null;
  readonly feed: LiveFeed;
  readonly route: Route;
  /** A failed load or save of app data, shown in the alert. */
  readonly dataIssue: unknown;
  readonly dismissDataIssue: () => void;
  readonly reportDataIssue: (issue: unknown) => void;
  /** Rejects when the backend refuses, so the caller can show what happened. */
  readonly saveProfile: (profile: Profile) => Promise<void>;
  /** Reads everything again, after a restore or a delete. */
  readonly reloadData: () => void;
  readonly updatePreferences: (change: Partial<Preferences>) => void;
  /** Someone got past the first-run safety step in this run of the app. */
  readonly safetyPassed: boolean;
  readonly passSafety: () => void;
  readonly openScreen: (screen: Screen) => void;
  readonly openExercise: (exercise: Exercise) => void;
}

export const [AppContext, useApp] = strictContext<AppValue>("useApp");

/** The first-run flow is on screen. It lives on Home until a saved profile says it is done. */
export function useInSetup(): boolean {
  const { loaded, profile, route } = useApp();
  return loaded && route.screen === "home" && profile?.onboarded !== true;
}

/** The saved profile could not be read, so no screen may act on it. */
export function useLoadFailed(): boolean {
  const { profileRead } = useApp();
  return profileRead === "failed" || profileRead === "retrying";
}

/**
 * Nobody leaves the first-run flow before its safety step, and an unknown profile may be new.
 * It holds only on Home, where that flow lives: elsewhere it would strand someone with no way out.
 */
export function useNavLocked(): boolean {
  const { profile, route, safetyPassed } = useApp();
  return (
    route.screen === "home" && profile?.onboarded !== true && !safetyPassed
  );
}

export const [MicContext, useMicContext] = strictContext<Mic>("useMicContext");
export const [SessionContext, useSessionContext] =
  strictContext<Session>("useSessionContext");
export const [RecordingsContext, useRecordingsContext] =
  strictContext<Recordings>("useRecordingsContext");
