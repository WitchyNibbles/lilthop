import { useApp, useSessionContext } from "../app/appContext";
import {
  CATEGORIES,
  exercisesIn,
  exerciseText,
  findExercise,
  type Exercise,
} from "../domain/exercises";
import { Select } from "../shell/Select";

export function ExerciseHeader({ exercise }: { readonly exercise: Exercise }) {
  const { openExercise, t } = useApp();
  const session = useSessionContext();
  const text = exerciseText(exercise.id);

  const choose = (id: string) => {
    const picked = findExercise(id);
    if (picked === undefined) return;
    session.reset();
    openExercise(picked);
  };

  return (
    <header className="exercise-header">
      <div className="exercise-title-row">
        <h1>{t(text.name)}</h1>
        <Select
          disabled={session.state.phase === "running"}
          label={t("exercise.pick")}
          onChange={choose}
          value={exercise.id}
        >
          {CATEGORIES.map((category) => (
            <optgroup key={category} label={t(`category.${category}`)}>
              {exercisesIn(category).map(({ id }) => (
                <option key={id} value={id}>
                  {t(exerciseText(id).name)}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </div>
      <p className="exercise-instruction">{t(text.instructions)}</p>
    </header>
  );
}
