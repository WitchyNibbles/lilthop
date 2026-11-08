import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { Profile, SavedResult } from "../domain/contract";
import { translator } from "../i18n";
import { getProfile, getResults, setProfile } from "../lib/tauri";
import type { Preferences, ProfileRead } from "./appContext";

interface DataState extends Preferences {
  readonly profileRead: ProfileRead;
  readonly profile: Profile | null;
  readonly results: readonly SavedResult[];
  readonly issue: unknown;
  /** Why the last profile read failed; null while it has not. */
  readonly readError: unknown;
}

type DataAction =
  | { readonly type: "reading" }
  | { readonly type: "read-failed"; readonly error: unknown }
  | { readonly type: "profile"; readonly profile: Profile | null }
  | { readonly type: "results"; readonly results: readonly SavedResult[] }
  | { readonly type: "preferences"; readonly change: Partial<Preferences> }
  | { readonly type: "issue"; readonly issue: unknown };

function systemLanguage(): Preferences["language"] {
  return navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
}

function initialState(): DataState {
  return {
    profileRead: "reading",
    profile: null,
    results: [],
    issue: null,
    readError: null,
    language: systemLanguage(),
    theme: "dark",
  };
}

function readingStarted(state: DataState): DataState {
  return state.profileRead === "failed"
    ? { ...state, profileRead: "retrying", issue: null }
    : { ...state, profileRead: "reading" };
}

function profileArrived(state: DataState, profile: Profile | null): DataState {
  return {
    ...state,
    profileRead: "read",
    readError: null,
    profile,
    language: profile?.language ?? state.language,
    theme: profile?.theme ?? state.theme,
  };
}

function dataReducer(state: DataState, action: DataAction): DataState {
  switch (action.type) {
    case "reading":
      return readingStarted(state);
    case "read-failed":
      return { ...state, profileRead: "failed", readError: action.error };
    case "profile":
      return profileArrived(state, action.profile);
    case "results":
      return { ...state, results: action.results };
    case "preferences":
      return {
        ...state,
        ...action.change,
        profile: state.profile && { ...state.profile, ...action.change },
      };
    case "issue":
      return { ...state, issue: action.issue };
  }
}

/** A save that came before the profile was read, and would have overwritten it. */
export class ProfileNotReadError extends Error {
  constructor() {
    super("the saved profile has not been read");
    this.name = "ProfileNotReadError";
  }
}

export interface AppData extends DataState {
  readonly refreshResults: () => void;
  readonly updatePreferences: (change: Partial<Preferences>) => void;
  readonly dismissIssue: () => void;
  readonly reportIssue: (issue: unknown) => void;
  readonly saveProfile: (profile: Profile) => Promise<void>;
  readonly reload: () => void;
}

/** The saved profile and results, and the two preferences that work with or without a profile. */
export function useAppData(): AppData {
  const [state, dispatch] = useReducer(dataReducer, undefined, initialState);

  const fail = useCallback((issue: unknown) => {
    dispatch({ type: "issue", issue });
  }, []);

  const refreshResults = useCallback(() => {
    getResults()
      .then((results) => dispatch({ type: "results", results }))
      .catch(fail);
  }, [fail]);

  const reload = useCallback(() => {
    dispatch({ type: "reading" });
    getProfile()
      .then((profile) => dispatch({ type: "profile", profile }))
      .catch((error: unknown) => dispatch({ type: "read-failed", error }));
    refreshResults();
  }, [refreshResults]);

  useEffect(reload, [reload]);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = state.language;
    root.dataset["theme"] = state.theme;
    document.title = translator(state.language)("app.title");
  }, [state.language, state.theme]);

  const { profile } = state;
  const canSave = state.profileRead === "read";
  const updatePreferences = useCallback(
    (change: Partial<Preferences>) => {
      dispatch({ type: "preferences", change });
      if (canSave && profile !== null)
        setProfile({ ...profile, ...change }).catch(fail);
    },
    [canSave, fail, profile],
  );

  const saveProfile = useCallback(
    async (next: Profile) => {
      if (!canSave) throw new ProfileNotReadError();
      await setProfile(next);
      dispatch({ type: "profile", profile: next });
    },
    [canSave],
  );

  const dismissIssue = useCallback(() => {
    dispatch({ type: "issue", issue: null });
  }, []);

  return useMemo(
    () => ({
      ...state,
      refreshResults,
      updatePreferences,
      dismissIssue,
      reportIssue: fail,
      saveProfile,
      reload,
    }),
    [
      state,
      refreshResults,
      updatePreferences,
      dismissIssue,
      fail,
      saveProfile,
      reload,
    ],
  );
}
