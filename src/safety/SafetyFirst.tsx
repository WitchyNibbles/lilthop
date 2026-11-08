import { useApp } from "../app/appContext";
import { Icon } from "../art/icons";
import type { MessageKey } from "../i18n";

/** What matters most, wherever safety is laid out: when to stop, then when to see a doctor. */
export function SafetyFirst({
  stopLines,
}: {
  readonly stopLines: readonly MessageKey[];
}) {
  const { t } = useApp();
  return (
    <div className="safety-first">
      <section data-stop="true">
        <h2>
          <Icon name="stopSign" />
          {t("safety.stopTitle")}
        </h2>
        {stopLines.map((line) => (
          <p key={line}>{t(line)}</p>
        ))}
      </section>
      <section>
        <h2>{t("safety.doctorTitle")}</h2>
        <p>{t("safety.s5")}</p>
      </section>
    </div>
  );
}
