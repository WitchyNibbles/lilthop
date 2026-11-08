import { useApp, useMicContext, useSessionContext } from "../app/appContext";
import type { Exercise } from "../domain/exercises";
import type { MessageKey } from "../i18n";
import { MetronomeControl } from "./MetronomeControl";

interface PrimaryAction {
  readonly label: MessageKey;
  readonly run: () => void;
  readonly disabled: boolean;
}

function usePrimaryAction(exercise: Exercise): PrimaryAction {
  const { scoring } = useApp();
  const mic = useMicContext();
  const session = useSessionContext();
  const { phase } = session.state;
  if (phase === "running")
    return {
      label: "exercise.finishSave",
      run: session.finish,
      disabled: false,
    };
  if (phase === "result")
    return { label: "exercise.again", run: session.reset, disabled: false };
  if (mic.status !== "on")
    return {
      label: mic.status === "starting" ? "mic.starting" : "home.startMic",
      run: () => void mic.start(),
      disabled: mic.status === "starting",
    };
  return {
    label: "exercise.startSession",
    run: () => {
      if (scoring !== null) session.start(exercise, scoring);
    },
    disabled: scoring === null,
  };
}

function SessionTimer({ exercise }: { readonly exercise: Exercise }) {
  const { t } = useApp();
  const { state } = useSessionContext();
  const elapsedS = state.phase === "running" ? state.elapsedS : 0;
  const seconds = Math.max(0, Math.ceil(exercise.durationS - elapsedS));
  return <p className="session-timer">{t("exercise.timeLeft", { seconds })}</p>;
}

export function SessionControls({ exercise }: { readonly exercise: Exercise }) {
  const { t } = useApp();
  const session = useSessionContext();
  const primary = usePrimaryAction(exercise);
  return (
    <div className="session-controls">
      <button
        className="btn btn-primary"
        disabled={primary.disabled}
        onClick={primary.run}
        type="button"
      >
        {t(primary.label)}
      </button>
      <button
        className="btn"
        disabled={session.state.phase !== "running"}
        onClick={session.reset}
        type="button"
      >
        {t("common.stop")}
      </button>
      <span className="session-spacer" />
      {exercise.metronomeBpm === undefined ? null : (
        <MetronomeControl key={exercise.id} startBpm={exercise.metronomeBpm} />
      )}
      <SessionTimer exercise={exercise} />
    </div>
  );
}
