import { useApp } from "../app/appContext";
import type { Theme } from "../domain/contract";
import { DeviceSelect } from "../shell/DeviceSelect";
import { LanguageSelect } from "../shell/LanguageSelect";
import { Select } from "../shell/Select";

const isTheme = (value: string): value is Theme =>
  value === "dark" || value === "light";

export function PreferencesSection() {
  const { t, theme, updatePreferences } = useApp();
  return (
    <section className="settings-section">
      <h2>{t("settings.preferences")}</h2>
      <div className="settings-fields">
        <LanguageSelect />
        <Select
          label={t("settings.theme")}
          onChange={(value) => {
            if (isTheme(value)) updatePreferences({ theme: value });
          }}
          showLabel
          value={theme}
        >
          <option value="dark">{t("settings.themeDark")}</option>
          <option value="light">{t("settings.themeLight")}</option>
        </Select>
        <DeviceSelect />
      </div>
    </section>
  );
}
