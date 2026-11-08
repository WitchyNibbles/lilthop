import { useApp, useMicContext, useSessionContext } from "../app/appContext";
import type { MessageKey, Translator } from "../i18n";
import { HERTZ, Readout } from "../live/Readout";
import type { Zone } from "../live/liveFeed";
import { useLive } from "../live/useLive";
import { useLiveStatus } from "../live/useLiveStatus";
import { ZoneMark } from "../live/ZoneMark";
import type { ReadoutKind } from "./readoutKind";
import { ResultPanel } from "./ResultPanel";

const DECIBELS = "dB";

/** Where the voice is right now. With the mic off, nowhere. */
function useZone(): Zone {
  const mic = useMicContext();
  const zone = useLive((view) => view.zone);
  return mic.status === "on" ? zone : "quiet";
}

function PitchReading({ t }: { readonly t: Translator }) {
  const value = useLive((view) => view.hz);
  const dimmed = useLive((view) => view.pitchDimmed);
  const zone = useZone();
  return (
    <Readout
      dimmed={dimmed}
      label={t("reading.pitch")}
      unit={HERTZ}
      value={value}
      zone={zone}
    />
  );
}

function LevelReading({ t }: { readonly t: Translator }) {
  const value = useLive((view) => view.levelDb);
  const dimmed = useLive((view) => view.soundDimmed);
  return (
    <Readout
      dimmed={dimmed}
      label={t("reading.level")}
      unit={DECIBELS}
      value={value}
    />
  );
}

function BrightnessReading({ t }: { readonly t: Translator }) {
  const value = useLive((view) => view.brightnessHz);
  const dimmed = useLive((view) => view.pitchDimmed);
  return (
    <Readout
      dimmed={dimmed}
      label={t("reading.brightness")}
      neutral
      unit={HERTZ}
      value={value}
    />
  );
}

const READINGS = {
  pitch: PitchReading,
  level: LevelReading,
  brightness: BrightnessReading,
} satisfies Record<ReadoutKind, unknown>;

function LiveStatus({ kind }: { readonly kind: ReadoutKind }) {
  const { t } = useApp();
  const zone = useZone();
  const showsZone = kind !== "level";
  const status = useLiveStatus(showsZone);
  return (
    <div className="live-state">
      {showsZone ? <ZoneMark zone={zone} /> : null}
      <p className="live-status">{t(status)}</p>
    </div>
  );
}

function BandLine() {
  const { band, t } = useApp();
  if (band === null) return null;
  return (
    <p className="band-line">
      <span>{t("common.target")}</span>
      <span className="mono">{`${band.minHz}–${band.maxHz} ${HERTZ}`}</span>
    </p>
  );
}

interface LiveColumnProps {
  readonly kind: ReadoutKind;
  /** The safety line that sits under the reading. */
  readonly note: MessageKey;
}

export function LiveColumn({ kind, note }: LiveColumnProps) {
  const { t } = useApp();
  const { phase } = useSessionContext().state;
  const Reading = READINGS[kind];
  return (
    <div className="live-column">
      <div aria-live="polite" className="result-region">
        <ResultPanel />
      </div>
      {phase === "result" ? null : (
        <>
          <Reading t={t} />
          <LiveStatus kind={kind} />
          {kind === "pitch" ? <BandLine /> : null}
        </>
      )}
      <p className="side-note">{t(note)}</p>
    </div>
  );
}
