import { useApp, useSessionContext } from "../app/appContext";
import { FIRST_EXERCISE, type Exercise } from "../domain/exercises";
import { useRoutine } from "../home/useRoutine";
import { ExerciseHeader } from "./ExerciseHeader";
import { LiveColumn } from "./LiveColumn";
import { LiveTrace } from "./LiveTrace";
import { readoutKind, readoutNote } from "./readoutKind";
import { SessionControls } from "./SessionControls";
import { StopSigns } from "./StopSigns";
import { WindowSill } from "./WindowSill";

function useCurrentExercise(): Exercise {
  const { route } = useApp();
  const { state } = useSessionContext();
  const routine = useRoutine();
  if (state.phase !== "idle") return state.exercise;
  return route.exercise ?? routine.next ?? FIRST_EXERCISE;
}

export function PracticeScreen() {
  const exercise = useCurrentExercise();
  const kind = readoutKind(exercise.measure);
  return (
    <div className="practice">
      <ExerciseHeader exercise={exercise} />
      <div className="trace-frame">
        <div className="trace-window">
          <LiveTrace kind={kind} />
        </div>
        <WindowSill />
        <LiveColumn kind={kind} note={readoutNote(exercise.measure)} />
      </div>
      <SessionControls exercise={exercise} />
      <StopSigns />
    </div>
  );
}
