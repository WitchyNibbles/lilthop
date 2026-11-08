import { useApp, useMicContext } from "../app/appContext";
import { HERTZ } from "../live/Readout";
import { toDecibels, type Baseline } from "./baseline";
import type { Calibration } from "./useCalibration";

const DECIBELS = "dB";

interface MeasureLineProps {
  readonly label: string;
  readonly value: number;
  readonly unit: string;
}

function MeasureLine({ label, value, unit }: MeasureLineProps) {
  return (
    <>
      {`${label}: `}
      <span className="mono">{`${Math.round(value)} ${unit}`}</span>
    </>
  );
}

function MeasuredValues({ baseline }: { readonly baseline: Baseline }) {
  const { t } = useApp();
  return (
    <section className="measured">
      <h2>{t("calibration.measuredTitle")}</h2>
      <ul>
        <li>
          <MeasureLine
            label={t("calibration.pitch")}
            unit={HERTZ}
            value={baseline.hz}
          />
        </li>
        <li>
          <MeasureLine
            label={t("calibration.brightness")}
            unit={HERTZ}
            value={baseline.centroid}
          />
          <p className="side-note">{t("safety.s14")}</p>
        </li>
        <li>
          <MeasureLine
            label={t("calibration.level")}
            unit={DECIBELS}
            value={toDecibels(baseline.rms)}
          />
          <p className="side-note">{t("safety.s13")}</p>
        </li>
      </ul>
    </section>
  );
}

function Controls({ calibration }: { readonly calibration: Calibration }) {
  const { t } = useApp();
  const mic = useMicContext();
  const { state, start, finish, reset } = calibration;
  if (state.phase === "measured")
    return (
      <button className="btn" onClick={reset} type="button">
        {t("calibration.again")}
      </button>
    );
  if (state.phase === "listening")
    return (
      <button className="btn btn-primary" onClick={finish} type="button">
        {t("onboarding.finishBaseline")}
      </button>
    );
  if (mic.status === "on")
    return (
      <button className="btn btn-primary" onClick={start} type="button">
        {t("calibration.start")}
      </button>
    );
  return (
    <button
      className="btn btn-primary"
      disabled={mic.status === "starting"}
      onClick={() => void mic.start()}
      type="button"
    >
      {t(mic.status === "starting" ? "mic.starting" : "home.startMic")}
    </button>
  );
}

/** Read aloud, get told what was measured. Used by onboarding and by recalibrating. */
export function CalibrationPanel({
  calibration,
}: {
  readonly calibration: Calibration;
}) {
  const { t } = useApp();
  const { state } = calibration;
  return (
    <div className="calibration">
      <p>{t("onboarding.baselineHelp")}</p>
      <blockquote className="passage">{t("onboarding.passage")}</blockquote>
      <Controls calibration={calibration} />
      {state.phase === "listening" ? (
        <p className="calibration-progress">
          {t("onboarding.voicedSeconds", {
            seconds: Math.round(state.voicedS),
          })}
        </p>
      ) : null}
      {state.phase === "listening" && state.tooShort ? (
        <p role="status">{t("settings.collectMore")}</p>
      ) : null}
      {state.phase === "measured" ? (
        <MeasuredValues baseline={state.baseline} />
      ) : null}
    </div>
  );
}
