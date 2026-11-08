import { useApp, useMicContext } from "../app/appContext";
import { WelcomeNight } from "../art/WelcomeNight";
import { GOAL_IDS } from "../domain/plan";
import type { MessageKey } from "../i18n";
import { useLiveStatus } from "../live/useLiveStatus";
import { SafetyFirst } from "../safety/SafetyFirst";
import { DeviceSelect } from "../shell/DeviceSelect";
import { LanguageSelect } from "../shell/LanguageSelect";
import type { RangeStart } from "./baseline";
import { RangeFields, RangeSources, type RangeText } from "./RangeFields";

export function WelcomeStep() {
  const { t } = useApp();
  return (
    <>
      <p>{t("onboarding.intro")}</p>
      <WelcomeNight />
      <div className="welcome-language">
        <LanguageSelect />
      </div>
    </>
  );
}

const STOP_LINES: readonly MessageKey[] = [
  "safety.s9",
  "safety.s4",
  "safety.s3",
  "safety.s6",
];

export function SafetyStep() {
  const { t } = useApp();
  return (
    <>
      <p>{t("safety.s1")}</p>
      <SafetyFirst stopLines={STOP_LINES} />
      <p className="side-note">{t("safety.s2")}</p>
    </>
  );
}

export function MicStep() {
  const { t } = useApp();
  const mic = useMicContext();
  const status = useLiveStatus(true);
  return (
    <>
      <p>{t("onboarding.micHelp")}</p>
      <div className="mic-check">
        <DeviceSelect />
        {mic.status === "on" ? null : (
          <button
            className="btn"
            disabled={mic.status === "starting"}
            onClick={() => void mic.start()}
            type="button"
          >
            {t("home.startMic")}
          </button>
        )}
      </div>
      <p className="live-status">{t(status)}</p>
      <p className="side-note">{t("onboarding.micSkip")}</p>
    </>
  );
}

const RANGE_HELP: Readonly<Record<RangeStart, MessageKey>> = {
  lifted: "onboarding.rangeHelp",
  around: "onboarding.rangeHelpAround",
};

interface RangeStepProps {
  /** How the suggested range sits against what was measured; null when nothing was. */
  readonly start: RangeStart | null;
  readonly value: RangeText;
  readonly invalid: boolean;
  readonly onChange: (value: RangeText) => void;
}

export function RangeStep({ start, value, invalid, onChange }: RangeStepProps) {
  const { t } = useApp();
  return (
    <>
      <p>
        {t(start === null ? "onboarding.rangeHelpEmpty" : RANGE_HELP[start])}
      </p>
      <RangeFields onChange={onChange} value={value} />
      <p className="action-result" data-failed={invalid} role="status">
        {invalid ? t("range.invalid") : ""}
      </p>
      <p className="side-note">{t("safety.s11")}</p>
      <p className="side-note">{t("safety.s12")}</p>
      <RangeSources />
    </>
  );
}

interface GoalsStepProps {
  readonly goals: readonly string[];
  readonly onChange: (goals: readonly string[]) => void;
}

export function GoalsStep({ goals, onChange }: GoalsStepProps) {
  const { t } = useApp();
  const toggle = (goal: string) =>
    onChange(
      goals.includes(goal)
        ? goals.filter((chosen) => chosen !== goal)
        : [...goals, goal],
    );
  return (
    <>
      <p>{t("onboarding.goalsHelp")}</p>
      <fieldset className="goal-list">
        <legend className="sr-only">{t("common.goals")}</legend>
        {GOAL_IDS.map((goal) => (
          <label key={goal}>
            <input
              checked={goals.includes(goal)}
              onChange={() => toggle(goal)}
              type="checkbox"
            />
            {t(`goal.${goal}`)}
          </label>
        ))}
      </fieldset>
    </>
  );
}
