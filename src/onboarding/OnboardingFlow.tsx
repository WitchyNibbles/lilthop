import { useEffect, useRef, useState, type ReactNode } from "react";
import { blankProfile, useApp, useMicContext } from "../app/appContext";
import { useAction } from "../app/useAction";
import type { Profile } from "../domain/contract";
import type { MessageKey } from "../i18n";
import { ActionResult } from "../shell/ActionResult";
import { focusHeading } from "../shell/focusHeading";
import { startingRange, type Baseline } from "./baseline";
import { CalibrationPanel } from "./CalibrationPanel";
import {
  GoalsStep,
  MicStep,
  RangeStep,
  SafetyStep,
  WelcomeStep,
} from "./OnboardingSteps";
import {
  isEmptyRange,
  parseRange,
  rangeText,
  type RangeText,
} from "./RangeFields";
import { useCalibration } from "./useCalibration";

const STEP_TITLES: readonly MessageKey[] = [
  "onboarding.welcome",
  "safety.beforeTitle",
  "onboarding.micTitle",
  "onboarding.baselineTitle",
  "onboarding.targetTitle",
  "common.goals",
];
const SAFETY_STEP = 1;
const MEASURE_STEP = 3;
const RANGE_STEP = 4;
const LAST_STEP = STEP_TITLES.length - 1;
const NO_RANGE: RangeText = { min: "", max: "" };

/** Starts from what was just measured, or else from what was saved before. */
function suggestedRange(baseline: Baseline | null, base: Profile): RangeText {
  if (baseline !== null) return rangeText(startingRange(baseline.hz));
  if (base.targetMaxHz <= 0) return NO_RANGE;
  return rangeText({ minHz: base.targetMinHz, maxHz: base.targetMaxHz });
}

/** The fields a fresh measure replaces; with no measure, what was saved stays. */
function measuredFields(baseline: Baseline | null): Partial<Profile> {
  if (baseline === null) return {};
  return {
    baselineHz: baseline.hz,
    baselineCentroid: baseline.centroid,
    baselineRms: baseline.rms,
  };
}

function rangeFields(range: RangeText): Partial<Profile> {
  const band = parseRange(range);
  if (band === null) return {};
  return { targetMinHz: band.minHz, targetMaxHz: band.maxHz };
}

/** Everything comes from this moment's draft: nothing is read back from what was saved before. */
function finishedProfile(
  base: Profile,
  baseline: Baseline | null,
  range: RangeText,
  goals: readonly string[],
): Profile {
  return {
    ...base,
    ...measuredFields(baseline),
    ...rangeFields(range),
    goals,
    onboarded: true,
    pitchEngine: 2,
  };
}

interface StepActionsProps {
  readonly step: number;
  /** Something was measured, so the measuring step has nothing left to offer but Next. */
  readonly measured: boolean;
  readonly saving: boolean;
  readonly onBack: () => void;
  readonly onSkip: () => void;
  readonly onNext: () => void;
  readonly onFinish: () => void;
}

function GoOnActions(props: StepActionsProps) {
  const { step, measured, saving, onSkip, onNext, onFinish } = props;
  const { t } = useApp();
  if (step === LAST_STEP)
    return (
      <button
        className="btn btn-primary"
        disabled={saving}
        onClick={onFinish}
        type="button"
      >
        {t("onboarding.saveContinue")}
      </button>
    );
  const waitsForMeasure = step === MEASURE_STEP && !measured;
  return (
    <>
      {step === SAFETY_STEP ? null : (
        <button className="btn" onClick={onSkip} type="button">
          {t("common.skip")}
        </button>
      )}
      <button
        className={waitsForMeasure ? "btn" : "btn btn-primary"}
        onClick={onNext}
        type="button"
      >
        {t("common.next")}
      </button>
    </>
  );
}

/** Three columns, so the count stays put from step to step whatever sits either side of it. */
function StepActions(props: StepActionsProps) {
  const { step, onBack } = props;
  const { t } = useApp();
  return (
    <div className="step-actions step-controls">
      <div>
        {step > 0 ? (
          <button className="btn" onClick={onBack} type="button">
            {t("common.back")}
          </button>
        ) : null}
      </div>
      <p className="step-count">
        {t("onboarding.stepOf", { step: step + 1, total: STEP_TITLES.length })}
      </p>
      <div className="step-go-on">
        <GoOnActions {...props} />
      </div>
    </div>
  );
}

interface StepFrameProps {
  readonly step: number;
  readonly children: ReactNode;
  readonly actions: ReactNode;
}

function StepFrame({ step, children, actions }: StepFrameProps) {
  const { t } = useApp();
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    focusHeading();
  }, [step]);
  const title = STEP_TITLES[step] ?? "onboarding.welcome";
  return (
    <div className="onboarding" data-step={step}>
      <h1>{t(title)}</h1>
      <div className="step-body">{children}</div>
      {actions}
    </div>
  );
}

export function OnboardingFlow() {
  const { feed, language, passSafety, profile, saveProfile, theme } = useApp();
  const mic = useMicContext();
  const calibration = useCalibration(feed);
  const saving = useAction();
  const [step, setStep] = useState(0);
  const [typedRange, setTypedRange] = useState<RangeText | null>(null);
  const [rangeInvalid, setRangeInvalid] = useState(false);
  const [goals, setGoals] = useState<readonly string[]>(profile?.goals ?? []);

  const base = profile ?? blankProfile({ language, theme });
  const { state } = calibration;
  const baseline = state.phase === "measured" ? state.baseline : null;
  const range = typedRange ?? suggestedRange(baseline, base);

  const measureAgain = () => {
    calibration.reset();
    setTypedRange(null);
  };

  const go = (next: number) => {
    setRangeInvalid(false);
    setStep(next);
    if (next > SAFETY_STEP) passSafety();
  };

  const next = () => {
    if (step === RANGE_STEP && !isEmptyRange(range) && !parseRange(range)) {
      setRangeInvalid(true);
      return;
    }
    go(step + 1);
  };

  const skip = () => {
    if (step === RANGE_STEP) setTypedRange(NO_RANGE);
    go(step + 1);
  };

  const finish = () => {
    saving.run(async () => {
      if (mic.status === "on") await mic.stop();
      await saveProfile(finishedProfile(base, baseline, range, goals));
      return "";
    });
  };

  const stepBody = [
    <WelcomeStep key="welcome" />,
    <SafetyStep key="safety" />,
    <MicStep key="mic" />,
    <CalibrationPanel
      calibration={{ ...calibration, reset: measureAgain }}
      key="calibrate"
    />,
    <RangeStep
      invalid={rangeInvalid}
      key="range"
      onChange={setTypedRange}
      start={baseline === null ? null : startingRange(baseline.hz).start}
      value={range}
    />,
    <GoalsStep goals={goals} key="goals" onChange={setGoals} />,
  ][step];

  return (
    <StepFrame
      actions={
        <StepActions
          measured={baseline !== null}
          onBack={() => go(step - 1)}
          onFinish={finish}
          onNext={next}
          onSkip={skip}
          saving={saving.state.kind === "busy"}
          step={step}
        />
      }
      step={step}
    >
      {stepBody}
      <ActionResult state={saving.state} />
    </StepFrame>
  );
}
