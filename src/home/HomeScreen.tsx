import { useApp, useInSetup } from "../app/appContext";
import { exerciseText } from "../domain/exercises";
import { practiceDays } from "../domain/stats";
import type { MessageKey } from "../i18n";
import { OnboardingFlow } from "../onboarding/OnboardingFlow";
import { MoonStrip } from "./MoonStrip";
import { RecalibrateInvite } from "./RecalibrateInvite";
import { EVENING_FROM_HOUR, type Routine } from "./routine";
import { useRoutine, useTodayMoon } from "./useRoutine";

const MOON_DAYS = 14;
const AFTERNOON_FROM_HOUR = 12;

function greetingFor(hour: number): MessageKey {
  if (hour < AFTERNOON_FROM_HOUR) return "home.greetingMorning";
  return hour < EVENING_FROM_HOUR
    ? "home.greetingAfternoon"
    : "home.greetingEvening";
}

function Moons({ today }: { readonly today: Date }) {
  const { language, results, t } = useApp();
  const days = practiceDays(results, MOON_DAYS, today);
  const { phase } = useTodayMoon();
  const count = days.filter((day) => day.practised).length;
  return (
    <MoonStrip
      days={days}
      label={t("progress.practiceDays", { days: MOON_DAYS, count })}
      language={language}
      today={today}
      todayPhase={phase}
    />
  );
}

function NextStep({ routine }: { readonly routine: Routine }) {
  const { openExercise, openScreen, t } = useApp();
  const { next } = routine;
  if (next !== null) {
    const text = exerciseText(next.id);
    return (
      <div className="next-step">
        <h2>{t(text.name)}</h2>
        <p className="next-time">
          {t("home.duration", {
            minutes: Math.max(1, Math.round(next.durationS / 60)),
          })}
        </p>
        <p>{t(text.description)}</p>
        <button
          className="btn btn-primary"
          onClick={() => openExercise(next)}
          type="button"
        >
          {t("home.startExercise", { name: t(text.name) })}
        </button>
      </div>
    );
  }
  return (
    <div className="next-step">
      <p>{t(routine.items.length > 0 ? "home.planDone" : "home.noGoals")}</p>
      <button
        className="btn btn-primary"
        onClick={() => openScreen("practice")}
        type="button"
      >
        {t("home.openPractice")}
      </button>
    </div>
  );
}

export function HomeScreen() {
  const { loaded, t } = useApp();
  const inSetup = useInSetup();
  const routine = useRoutine();
  const today = new Date();
  if (!loaded) return null;
  if (inSetup) return <OnboardingFlow />;
  return (
    <div className="home">
      <h1>{t(greetingFor(today.getHours()))}</h1>
      <RecalibrateInvite />
      <section className="night">
        <Moons today={today} />
        <NextStep routine={routine} />
      </section>
      <p className="home-rest">{t("safety.s8")}</p>
    </div>
  );
}
