import { useEffect, useRef } from "react";
import { useApp, useLoadFailed } from "../app/appContext";
import { HomeScreen } from "../home/HomeScreen";
import { CalibrateScreen } from "../onboarding/CalibrateScreen";
import { PracticeScreen } from "../practice/PracticeScreen";
import { ProgressScreen } from "../progress/ProgressScreen";
import { RecordingsScreen } from "../recordings/RecordingsScreen";
import { SafetyScreen } from "../safety/SafetyScreen";
import { SettingsScreen } from "../settings/SettingsScreen";
import { AlertRow } from "./AlertBanner";
import { focusHeading } from "./focusHeading";
import { LoadFailedScreen } from "./LoadFailedScreen";
import { Rail } from "./Rail";

function CurrentScreen() {
  const { route } = useApp();
  const loadFailed = useLoadFailed();
  if (loadFailed) return <LoadFailedScreen />;
  switch (route.screen) {
    case "home":
      return <HomeScreen />;
    case "practice":
      return <PracticeScreen />;
    case "progress":
      return <ProgressScreen />;
    case "recordings":
      return <RecordingsScreen />;
    case "settings":
      return <SettingsScreen />;
    case "safety":
      return <SafetyScreen />;
    case "calibrate":
      return <CalibrateScreen />;
  }
}

/** A new screen is a new page to a keyboard or screen reader: start reading at its heading. */
function useFocusOnNavigation(): void {
  const { route } = useApp();
  const shown = useRef(route.screen);
  useEffect(() => {
    if (shown.current === route.screen) return;
    shown.current = route.screen;
    focusHeading();
  }, [route.screen]);
}

export function Shell() {
  const { route, t } = useApp();
  useFocusOnNavigation();
  return (
    <div className="shell">
      <button className="skip-link" onClick={focusHeading} type="button">
        {t("nav.skip")}
      </button>
      <Rail />
      <div className="stage-frame">
        {route.screen === "practice" ? null : <AlertRow />}
        <main className="stage" key={route.screen}>
          <CurrentScreen />
        </main>
      </div>
    </div>
  );
}
