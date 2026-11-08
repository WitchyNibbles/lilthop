import { Moon } from "../art/Moon";
import type { Language } from "../domain/contract";
import type { PracticeDay } from "../domain/stats";

function weekdayOf(today: Date, daysAgo: number, language: Language): string {
  const day = new Date(today);
  day.setDate(day.getDate() - daysAgo);
  return new Intl.DateTimeFormat(language, { weekday: "narrow" }).format(day);
}

export function dayPhase(
  daysAgo: number,
  practised: boolean,
  todayPhase: number,
): number {
  if (daysAgo === 0) return todayPhase;
  return practised ? 1 : 0;
}

interface MoonStripProps {
  readonly days: readonly PracticeDay[];
  readonly label: string;
  readonly language: Language;
  readonly today: Date;
  /** Today waxes with the routine; other days are simply practised or not. */
  readonly todayPhase: number;
}

export function MoonStrip(props: MoonStripProps) {
  const { days, label, language, today, todayPhase } = props;
  return (
    <div aria-label={label} className="moon-strip" role="img">
      {days.map(({ daysAgo, practised }) => (
        <span className="moon-day" data-today={daysAgo === 0} key={daysAgo}>
          <Moon phase={dayPhase(daysAgo, practised, todayPhase)} />
          <span className="moon-weekday">
            {weekdayOf(today, daysAgo, language)}
          </span>
        </span>
      ))}
    </div>
  );
}
