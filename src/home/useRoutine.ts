import { useMemo } from "react";
import { useApp } from "../app/appContext";
import { practiceDays } from "../domain/stats";
import { moonPhaseToday, todaysRoutine, type Routine } from "./routine";

export function useRoutine(): Routine {
  const { profile, results } = useApp();
  return useMemo(
    () => todaysRoutine(profile?.goals ?? [], results, new Date()),
    [profile?.goals, results],
  );
}

export interface TodayMoon {
  readonly phase: number;
  readonly done: number;
  readonly total: number;
}

export function useTodayMoon(): TodayMoon {
  const { results } = useApp();
  const routine = useRoutine();
  const practisedToday = practiceDays(results, 1, new Date())[0]?.practised;
  return {
    phase: moonPhaseToday(routine, practisedToday === true),
    done: routine.items.filter((item) => item.done).length,
    total: routine.items.length,
  };
}
