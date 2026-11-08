import {
  useApp,
  useInSetup,
  useMicContext,
  useRecordingsContext,
  useSessionContext,
} from "../app/appContext";
import { Icon } from "../art/icons";
import { micMessage } from "../live/liveStatus";
import { HERTZ, Readout } from "../live/Readout";
import { useLive } from "../live/useLive";

function RailReading() {
  const { t } = useApp();
  const value = useLive((view) => view.hz);
  const dimmed = useLive((view) => view.pitchDimmed);
  return (
    <Readout
      compact
      dimmed={dimmed}
      label={t("reading.pitch")}
      unit={HERTZ}
      value={value}
    />
  );
}

function MicButton() {
  const { t } = useApp();
  const mic = useMicContext();
  const on = mic.status === "on";
  return (
    <button
      className="btn mic-button"
      data-on={on}
      disabled={mic.status === "starting"}
      onClick={() => void (on ? mic.stop() : mic.start())}
      type="button"
    >
      <Icon name={on ? "micOff" : "mic"} />
      {t(on ? "home.stopMic" : "home.startMic")}
    </button>
  );
}

function MicStateLine({ narrowOnly }: { readonly narrowOnly: boolean }) {
  const { t } = useApp();
  const mic = useMicContext();
  const recording = useRecordingsContext().recorder !== "idle";
  return (
    <p
      className="mic-state"
      data-narrow-only={narrowOnly}
      data-on={mic.status === "on" || recording}
    >
      {t(micMessage(mic.status, recording))}
    </p>
  );
}

/** Practice and setup run the mic in the stage. Here is only what the stage does not offer. */
function StageMicPanel() {
  const { route } = useApp();
  const on = useMicContext().status === "on";
  const { phase } = useSessionContext().state;
  const recording = useRecordingsContext().recorder !== "idle";
  // Stop mic has no other home, and during a session nor does turning it back on.
  const button = on || phase === "running";
  // Practice's live status says it is recording, unless the stage is stacked out of sight or a
  // result has taken its place.
  const narrowOnly = route.screen === "practice" && phase !== "result";
  if (!button && !recording) return null;
  return (
    <section className="mic-panel" data-narrow-only={narrowOnly && !button}>
      {recording ? <MicStateLine narrowOnly={narrowOnly} /> : null}
      {button ? <MicButton /> : null}
    </section>
  );
}

export function MicPanel() {
  const { route } = useApp();
  const inSetup = useInSetup();
  if (inSetup || route.screen === "practice") return <StageMicPanel />;
  return (
    <section className="mic-panel">
      <MicStateLine narrowOnly={false} />
      <div className="mic-reading">
        <RailReading />
      </div>
      <MicButton />
    </section>
  );
}
