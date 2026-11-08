import { useApp } from "../app/appContext";
import { Icon } from "../art/icons";

export function StopSigns() {
  const { openScreen, t } = useApp();
  return (
    <button
      className="stop-signs"
      onClick={() => openScreen("safety")}
      title={t("safety.title")}
      type="button"
    >
      <Icon name="stopSign" />
      <span>{t("safety.s4")}</span>
    </button>
  );
}
