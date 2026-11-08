import { useState } from "react";
import { useApp } from "../app/appContext";
import type { SavedResult } from "../domain/contract";
import { exerciseText, findExercise } from "../domain/exercises";
import { totals, trend } from "../domain/stats";
import type { Translator } from "../i18n";
import { Select } from "../shell/Select";
import { MoonMonth } from "./MoonMonth";
import { SessionChart } from "./SessionChart";
import { markKind, practisedExercises, sessionsOf } from "./sessionChartData";
import { SessionTable } from "./SessionTable";
import { TREND_MESSAGE } from "./sessionText";

/** An id from an older version may have no exercise now; its sessions still deserve a name. */
function exerciseName(id: string, t: Translator): string {
  const exercise = findExercise(id);
  return exercise === undefined ? id : t(exerciseText(exercise.id).name);
}

function ExerciseHistory({
  results,
}: {
  readonly results: readonly SavedResult[];
}) {
  const { t } = useApp();
  const practised = practisedExercises(results);
  const [chosen, setChosen] = useState<string | null>(null);
  const exerciseId = chosen ?? practised[0] ?? "";
  const rows = sessionsOf(results, exerciseId);
  const trendWords = t(TREND_MESSAGE[trend(rows).direction]);
  const exercise = findExercise(exerciseId);
  return (
    <section className="exercise-history">
      <Select
        label={t("progress.exercise")}
        onChange={setChosen}
        showLabel
        value={exerciseId}
      >
        {practised.map((id) => (
          <option key={id} value={id}>
            {exerciseName(id, t)}
          </option>
        ))}
      </Select>
      {exercise === undefined ? null : (
        <h2>{t(`measure.${exercise.measure}.label`)}</h2>
      )}
      <SessionChart
        label={t("progress.chartLabel", {
          name: exerciseName(exerciseId, t),
          count: rows.length,
          trend: trendWords,
        })}
        rows={rows}
      />
      <p className="trend-words">{trendWords}</p>
      {rows.some((row) => markKind(row) === "old") ? (
        <p className="side-note">{t("progress.oldNote")}</p>
      ) : null}
      <SessionTable rows={rows} />
    </section>
  );
}

export function ProgressScreen() {
  const { openScreen, results, t } = useApp();
  const today = new Date();
  if (results.length === 0)
    return (
      <div className="progress">
        <h1>{t("progress.title")}</h1>
        <div className="empty">
          <p>{t("progress.empty")}</p>
          <button
            className="btn btn-primary"
            onClick={() => openScreen("practice")}
            type="button"
          >
            {t("home.openPractice")}
          </button>
        </div>
        <p className="side-note">{t("safety.s10")}</p>
      </div>
    );
  const { sessions, totalDurationS } = totals(results);
  return (
    <div className="progress">
      <h1>{t("progress.title")}</h1>
      <p className="progress-totals">
        <span>{t("progress.totalSessions", { count: sessions })}</span>
        <span>
          {t("progress.totalTime", {
            minutes: Math.round(totalDurationS / 60),
          })}
        </span>
      </p>
      <div className="progress-body">
        <ExerciseHistory results={results} />
        <div className="progress-side">
          <MoonMonth today={today} />
          <p className="side-note">{t("safety.s10")}</p>
        </div>
      </div>
    </div>
  );
}
