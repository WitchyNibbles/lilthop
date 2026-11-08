import { useApp, useSessionContext } from "../app/appContext";
import { PitchTrace } from "../live/PitchTrace";
import { useLiveStatus } from "../live/useLiveStatus";
import type { ReadoutKind } from "./readoutKind";

export function LiveTrace({ kind }: { readonly kind: ReadoutKind }) {
  const { band, feed, t, theme } = useApp();
  const { state } = useSessionContext();
  const isLevel = kind === "level";
  const status = useLiveStatus(!isLevel);
  const label = () => {
    if (isLevel) return t("trace.levelLabel");
    if (band === null) return t("trace.pitchLabelNoBand");
    return t("trace.pitchLabel", { min: band.minHz, max: band.maxHz });
  };
  return (
    <PitchTrace
      band={isLevel ? null : band}
      buffer={feed.trace}
      frozen={state.phase === "result"}
      label={label()}
      series={isLevel ? "level" : "pitch"}
      summary={t(status)}
      theme={theme}
    />
  );
}
