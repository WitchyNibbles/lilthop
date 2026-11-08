import { blankProfile, useApp } from "../app/appContext";
import { useAction } from "../app/useAction";
import type { Profile } from "../domain/contract";
import type { MessageKey } from "../i18n";
import { ActionResult } from "../shell/ActionResult";
import { startingRange, type StartingRange } from "./baseline";
import { CalibrationPanel } from "./CalibrationPanel";
import { useCalibration } from "./useCalibration";

interface SuggestedRangeProps {
  readonly range: StartingRange;
  readonly disabled: boolean;
  readonly onUse: () => void;
}

/** What the rule would suggest now. Nothing changes unless the person picks it. */
function SuggestedRange({ range, disabled, onUse }: SuggestedRangeProps) {
  const { t } = useApp();
  const { minHz, maxHz } = range;
  return (
    <div className="suggested-range">
      <p>{t("recalibrate.suggested", { min: minHz, max: maxHz })}</p>
      <button className="btn" disabled={disabled} onClick={onUse} type="button">
        {t("recalibrate.useSuggested")}
      </button>
    </div>
  );
}

/** Measures again. The range stays the person's own choice: only "Use this range" moves it. */
export function CalibrateScreen() {
  const { feed, language, openScreen, profile, saveProfile, t, theme } =
    useApp();
  const calibration = useCalibration(feed);
  const saving = useAction();
  const { state } = calibration;
  const baseline = state.phase === "measured" ? state.baseline : null;
  const suggested = baseline === null ? null : startingRange(baseline.hz);
  const busy = saving.state.kind === "busy";

  const save = (band: Partial<Profile>, done: MessageKey) => {
    if (baseline === null) return;
    saving.run(async () => {
      await saveProfile({
        ...(profile ?? blankProfile({ language, theme })),
        baselineHz: baseline.hz,
        baselineCentroid: baseline.centroid,
        baselineRms: baseline.rms,
        pitchEngine: 2,
        ...band,
      });
      return t(done);
    });
  };

  const takeSuggested = (range: StartingRange) =>
    save(
      { targetMinHz: range.minHz, targetMaxHz: range.maxHz },
      "settings.rangeSaved",
    );

  return (
    <div className="onboarding recalibrate">
      <h1>{t("onboarding.baselineTitle")}</h1>
      <div className="step-body">
        <CalibrationPanel calibration={calibration} />
        {suggested === null ? null : (
          <SuggestedRange
            disabled={busy}
            onUse={() => takeSuggested(suggested)}
            range={suggested}
          />
        )}
        <ActionResult state={saving.state} />
      </div>
      <div className="step-actions">
        <button
          className="btn"
          onClick={() => openScreen("settings")}
          type="button"
        >
          {t("recalibrate.backToSettings")}
        </button>
        <span className="session-spacer" />
        <button
          className="btn btn-primary"
          disabled={baseline === null || busy}
          onClick={() => save({}, "recalibrate.saved")}
          type="button"
        >
          {t("recalibrate.save")}
        </button>
      </div>
    </div>
  );
}
