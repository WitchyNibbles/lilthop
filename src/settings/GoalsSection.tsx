import { useState } from "react";
import { blankProfile, useApp } from "../app/appContext";
import { useAction } from "../app/useAction";
import { GoalsStep } from "../onboarding/OnboardingSteps";
import { ActionResult } from "../shell/ActionResult";

export function GoalsSection() {
  const { language, profile, saveProfile, t, theme } = useApp();
  const base = profile ?? blankProfile({ language, theme });
  const [picked, setPicked] = useState<readonly string[] | null>(null);
  const goals = picked ?? base.goals;
  const saving = useAction();

  const save = () => {
    saving.run(async () => {
      await saveProfile({ ...base, goals });
      setPicked(null);
      return t("settings.goalsSaved");
    });
  };

  return (
    <section className="settings-section">
      <h2>{t("common.goals")}</h2>
      <GoalsStep goals={goals} onChange={setPicked} />
      <div className="settings-action">
        <button className="btn" onClick={save} type="button">
          {t("settings.saveGoals")}
        </button>
      </div>
      <ActionResult state={saving.state} />
    </section>
  );
}
