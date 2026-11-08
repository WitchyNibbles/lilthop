import { useSyncExternalStore } from "react";
import { useApp } from "../app/appContext";
import type { LiveView } from "./liveFeed";

/** Renders only when the selected value changes, so a screen pays only for what it shows. */
export function useLive<T>(select: (view: LiveView) => T): T {
  const { feed } = useApp();
  return useSyncExternalStore(feed.subscribe, () => select(feed.getView()));
}
