import { useApp } from "../app/appContext";
import { DataSection } from "./DataSection";
import { GoalsSection } from "./GoalsSection";
import { PreferencesSection } from "./PreferencesSection";
import { RangeSection } from "./RangeSection";

export function SettingsScreen() {
  const { openScreen, t } = useApp();
  return (
    <div className="settings">
      <h1>{t("settings.title")}</h1>
      <div className="settings-grid">
        <PreferencesSection />
        <RangeSection />
        <GoalsSection />
        <DataSection />
        <section className="settings-section">
          <p>{t("settings.privacy")}</p>
          <button
            className="btn"
            onClick={() => openScreen("safety")}
            type="button"
          >
            {t("settings.readSafety")}
          </button>
        </section>
      </div>
    </div>
  );
}
