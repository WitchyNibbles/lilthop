import { useApp } from "../app/appContext";
import type { MessageKey } from "../i18n";
import { SafetyFirst } from "./SafetyFirst";

const SECTIONS: readonly {
  readonly title: MessageKey;
  readonly lines: readonly MessageKey[];
}[] = [
  { title: "safety.beforeTitle", lines: ["safety.s1", "safety.research"] },
  {
    title: "safety.trainingTitle",
    lines: ["safety.s6", "safety.s15", "safety.s3", "safety.s9", "safety.s17"],
  },
  {
    title: "safety.numbersTitle",
    lines: ["safety.s10", "safety.s13", "safety.s14"],
  },
];

const STOP_LINES: readonly MessageKey[] = ["safety.s4", "safety.s16"];

export function SafetyScreen() {
  const { t } = useApp();
  return (
    <article className="safety">
      <h1>{t("safety.title")}</h1>
      <SafetyFirst stopLines={STOP_LINES} />
      {SECTIONS.map(({ title, lines }) => (
        <section className="safety-section" key={title}>
          <h2>{t(title)}</h2>
          {lines.map((line) => (
            <p key={line}>{t(line)}</p>
          ))}
        </section>
      ))}
      <p className="side-note">{t("safety.s2")}</p>
    </article>
  );
}
