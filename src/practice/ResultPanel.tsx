import { useState } from "react";
import { useApp, useSessionContext } from "../app/appContext";
import { showsPitch, type Exercise } from "../domain/exercises";
import type { ScoreOutcome } from "../domain/scoring";
import { commandErrorMessage } from "../lib/tauri";
import { useTodayMoon } from "../home/useRoutine";
import { TodayMoon } from "./TodayMoon";
import type { SaveState, SessionState } from "./useSession";

type FinishedSession = Extract<SessionState, { phase: "result" }>;
type ScoredOutcome = Extract<ScoreOutcome, { status: "scored" }>;

function SaveLine({ save }: { readonly save: SaveState }) {
  const { t } = useApp();
  const session = useSessionContext();
  if (save.kind === "failed") {
    const reason = commandErrorMessage(save.error, t);
    return (
      <div className="result-save-failed">
        <p>{t("result.saveFailed", { reason })}</p>
        <button className="btn" onClick={session.retrySave} type="button">
          {t("result.retrySave")}
        </button>
      </div>
    );
  }
  if (save.kind === "none") return null;
  const message = save.kind === "saving" ? "result.saving" : "result.savedNote";
  return <p className="result-note">{t(message)}</p>;
}

interface ScoredProps {
  readonly exercise: Exercise;
  readonly outcome: ScoredOutcome;
  readonly pitchMeanHz: number;
  readonly save: SaveState;
}

function ScoredResult({ exercise, outcome, pitchMeanHz, save }: ScoredProps) {
  const { t } = useApp();
  return (
    <>
      <p className="result-measure">{t(`measure.${exercise.measure}.label`)}</p>
      <p className="result-score">
        <span data-testid="result-score">{outcome.score}</span>
        <span className="result-score-unit">%</span>
      </p>
      {showsPitch(exercise.measure) ? (
        <p className="result-note">
          {t("result.average", { mean: Math.round(pitchMeanHz) })}
        </p>
      ) : null}
      <SaveLine save={save} />
    </>
  );
}

function ResultBody({ result }: { readonly result: FinishedSession }) {
  const { t } = useApp();
  const { outcome, exercise } = result;
  switch (outcome.status) {
    case "scored":
      return (
        <ScoredResult
          exercise={exercise}
          outcome={outcome}
          pitchMeanHz={result.pitchMeanHz}
          save={result.save}
        />
      );
    case "practice_only":
      return (
        <>
          <p className="result-message">
            {t("result.practiceOnly", {
              hz: Math.round(outcome.medianCentroidHz),
            })}
          </p>
          <SaveLine save={result.save} />
        </>
      );
    case "not_enough_voice":
      return (
        <p className="result-message">
          {t(
            showsPitch(exercise.measure)
              ? "result.notEnoughVoice"
              : "result.notEnoughSound",
            { seconds: Math.round(outcome.voicedS) },
          )}
        </p>
      );
  }
}

/** Today's moon as it stood until the result came up, and for as long as the result stays. */
function useMoonBeforeResult(showingResult: boolean): number {
  const { phase } = useTodayMoon();
  const [before, setBefore] = useState(phase);
  if (!showingResult && before !== phase) setBefore(phase);
  return before;
}

/** Takes the readings' place beside the trace, so the thread just drawn stays uncovered. */
export function ResultPanel() {
  const { state } = useSessionContext();
  const moonBefore = useMoonBeforeResult(state.phase === "result");
  if (state.phase !== "result") return null;
  return (
    <section className="result-panel">
      <div className="result-head">
        <ResultBody result={state} />
      </div>
      {state.outcome.status === "not_enough_voice" ? null : (
        <TodayMoon from={moonBefore} />
      )}
    </section>
  );
}
