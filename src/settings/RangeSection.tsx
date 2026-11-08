import { useState } from "react";
import { blankProfile, useApp } from "../app/appContext";
import { useAction } from "../app/useAction";
import {
  parseRange,
  RangeFields,
  RangeSources,
  type RangeText,
} from "../onboarding/RangeFields";
import { ActionResult } from "../shell/ActionResult";

export function RangeSection() {
  const { language, openScreen, profile, saveProfile, t, theme } = useApp();
  const base = profile ?? blankProfile({ language, theme });
  const [typed, setTyped] = useState<RangeText | null>(null);
  const range = typed ?? {
    min: base.targetMinHz > 0 ? String(base.targetMinHz) : "",
    max: base.targetMaxHz > 0 ? String(base.targetMaxHz) : "",
  };
  const saving = useAction();

  const save = () => {
    const band = parseRange(range);
    if (band === null) {
      saving.show({ kind: "failed", message: t("range.invalid") });
      return;
    }
    saving.run(async () => {
      await saveProfile({
        ...base,
        targetMinHz: band.minHz,
        targetMaxHz: band.maxHz,
      });
      setTyped(null);
      return t("settings.rangeSaved");
    });
  };

  return (
    <section className="settings-section">
      <h2>{t("common.target")}</h2>
      <div className="range-row">
        <RangeFields onChange={setTyped} value={range} />
        <button className="btn" onClick={save} type="button">
          {t("common.save")}
        </button>
      </div>
      <ActionResult state={saving.state} />
      <p className="side-note">{t("safety.s11")}</p>
      <RangeSources />
      <div className="settings-action">
        <button
          className="btn"
          onClick={() => openScreen("calibrate")}
          type="button"
        >
          {t("settings.calibrate")}
        </button>
        <p className="side-note">{t("settings.recalibrateHelp")}</p>
      </div>
    </section>
  );
}
