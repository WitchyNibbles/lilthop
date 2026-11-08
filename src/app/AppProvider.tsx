import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Profile } from "../domain/contract";
import type { Exercise } from "../domain/exercises";
import type { ScoringContext } from "../domain/scoring";
import { translator } from "../i18n";
import { LiveFeed } from "../live/liveFeed";
import { startTimingProbe } from "../live/timingProbe";
import type { Band } from "../live/traceScale";
import { useMic } from "../mic/useMic";
import { useSession } from "../practice/useSession";
import { useRecordings } from "../recordings/useRecordings";
import {
  AppContext,
  MicContext,
  RecordingsContext,
  SessionContext,
  type AppValue,
  type Route,
  type Screen,
} from "./appContext";
import { useAppData } from "./useAppData";

function bandOf(profile: Profile | null): Band | null {
  if (profile === null) return null;
  const { targetMinHz: minHz, targetMaxHz: maxHz } = profile;
  return minHz > 0 && maxHz > minHz ? { minHz, maxHz } : null;
}

function scoringOf(
  band: Band | null,
  profile: Profile | null,
): ScoringContext | null {
  if (band === null || profile === null) return null;
  return {
    targetMinHz: band.minHz,
    targetMaxHz: band.maxHz,
    baselineRms: profile.baselineRms,
  };
}

/** Holds everything that outlives a screen, so a session keeps running on a look at Home. */
export function AppProvider({ children }: { readonly children: ReactNode }) {
  const [feed] = useState(() => new LiveFeed());
  const [route, setRoute] = useState<Route>({ screen: "home", exercise: null });
  const data = useAppData();
  const band = useMemo(() => bandOf(data.profile), [data.profile]);
  useEffect(() => startTimingProbe(feed), [feed]);
  const mic = useMic(feed, band);
  const session = useSession(feed, data.refreshResults);
  const recordings = useRecordings(mic.device);

  const [safetyPassed, setSafetyPassed] = useState(false);
  const passSafety = useCallback(() => {
    setSafetyPassed(true);
  }, []);

  const openScreen = useCallback((screen: Screen) => {
    setRoute((current) => ({ ...current, screen }));
  }, []);

  const openExercise = useCallback((exercise: Exercise) => {
    setRoute({ screen: "practice", exercise });
  }, []);

  const app = useMemo<AppValue>(
    () => ({
      t: translator(data.language),
      language: data.language,
      theme: data.theme,
      loaded: data.profileRead === "read",
      profileRead: data.profileRead,
      readError: data.readError,
      profile: data.profile,
      results: data.results,
      band,
      scoring: scoringOf(band, data.profile),
      feed,
      route,
      dataIssue: data.issue,
      dismissDataIssue: data.dismissIssue,
      reportDataIssue: data.reportIssue,
      saveProfile: data.saveProfile,
      reloadData: data.reload,
      updatePreferences: data.updatePreferences,
      safetyPassed,
      passSafety,
      openScreen,
      openExercise,
    }),
    [
      band,
      data,
      feed,
      openExercise,
      openScreen,
      passSafety,
      route,
      safetyPassed,
    ],
  );

  return (
    <AppContext value={app}>
      <MicContext value={mic}>
        <SessionContext value={session}>
          <RecordingsContext value={recordings}>{children}</RecordingsContext>
        </SessionContext>
      </MicContext>
    </AppContext>
  );
}
