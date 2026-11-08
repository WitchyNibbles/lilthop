import { useApp } from "../app/appContext";
import { Moon } from "../art/Moon";
import type { Language } from "../domain/contract";
import { practiceDays } from "../domain/stats";
import { dayPhase } from "../home/MoonStrip";
import { useTodayMoon } from "../home/useRoutine";

const WEEK = 7;
/** 1 January 2024 was a Monday, so these seven days give the weekday names in order. */
const A_MONDAY = new Date(2024, 0, 1);

function weekdayNames(language: Language): string[] {
  const format = new Intl.DateTimeFormat(language, { weekday: "narrow" });
  return Array.from({ length: WEEK }, (_, i) => {
    const day = new Date(A_MONDAY);
    day.setDate(day.getDate() + i);
    return format.format(day);
  });
}

/** Columns before the 1st, in a week that starts on Monday. */
function leadingBlanks(today: Date): number {
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  return (first.getDay() + WEEK - 1) % WEEK;
}

function daysInMonth(today: Date): number {
  return new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
}

export function MoonMonth({ today }: { readonly today: Date }) {
  const { language, results, t } = useApp();
  const { phase: todayPhase } = useTodayMoon();
  const passed = practiceDays(results, today.getDate(), today);
  const count = passed.filter((day) => day.practised).length;
  const month = new Intl.DateTimeFormat(language, {
    month: "long",
    year: "numeric",
  }).format(today);
  const rest = daysInMonth(today) - passed.length;
  return (
    <section className="moon-month-section">
      <h2>{month}</h2>
      <div
        aria-label={t("progress.monthLabel", { month, count })}
        className="moon-month"
        role="img"
      >
        {weekdayNames(language).map((name, i) => (
          <span className="moon-weekday" key={i}>
            {name}
          </span>
        ))}
        {Array.from({ length: leadingBlanks(today) }, (_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {passed.map(({ daysAgo, practised }) => (
          <Moon
            key={daysAgo}
            phase={dayPhase(daysAgo, practised, todayPhase)}
          />
        ))}
        {Array.from({ length: rest }, (_, i) => (
          <span className="moon-future" key={`future-${i}`} />
        ))}
      </div>
    </section>
  );
}
