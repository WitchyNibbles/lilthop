import { useApp, useInSetup, useLoadFailed } from "../app/appContext";
import { Icon } from "../art/icons";
import { exerciseText } from "../domain/exercises";
import { EVENING_FROM_HOUR } from "../home/routine";
import { useRoutine } from "../home/useRoutine";

export function RoutineList() {
  const { openExercise, t } = useApp();
  const { items } = useRoutine();
  const inSetup = useInSetup();
  const loadFailed = useLoadFailed();
  const evening = new Date().getHours() >= EVENING_FROM_HOUR;
  if (inSetup || loadFailed) return null;
  return (
    <section className="routine">
      <h2>{t(evening ? "rail.routineTonight" : "rail.routineToday")}</h2>
      {items.length === 0 ? (
        <p>{t("home.noGoals")}</p>
      ) : (
        <ul>
          {items.map(({ exercise, done }) => (
            <li key={exercise.id}>
              <button
                className="routine-item"
                data-done={done}
                onClick={() => openExercise(exercise)}
                type="button"
              >
                <span className="routine-mark">
                  {done ? <Icon name="check" /> : null}
                </span>
                <span>{t(exerciseText(exercise.id).name)}</span>
                {done ? (
                  <span className="sr-only">{t("rail.done")}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
