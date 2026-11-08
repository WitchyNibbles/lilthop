import { useApp } from "../app/appContext";
import type { Language } from "../domain/contract";
import { Select } from "./Select";

const isLanguage = (value: string): value is Language =>
  value === "en" || value === "es";

export function LanguageSelect() {
  const { language, t, updatePreferences } = useApp();
  return (
    <Select
      label={t("settings.language")}
      onChange={(value) => {
        if (isLanguage(value)) updatePreferences({ language: value });
      }}
      showLabel
      value={language}
    >
      <option value="en">{t("language.en")}</option>
      <option value="es">{t("language.es")}</option>
    </Select>
  );
}
