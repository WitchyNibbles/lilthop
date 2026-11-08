import { useEffect, useState } from "react";
import { useApp } from "../app/appContext";
import { Icon } from "../art/icons";
import { clampTempo, startMetronome } from "./metronome";

export function MetronomeControl({ startBpm }: { readonly startBpm: number }) {
  const { t } = useApp();
  const [on, setOn] = useState(false);
  const [draft, setDraft] = useState(String(startBpm));
  const tempo = clampTempo(Number(draft));

  useEffect(() => (on ? startMetronome(tempo) : undefined), [on, tempo]);

  return (
    <div className="metronome">
      <button
        aria-label={t("metronome.label")}
        aria-pressed={on}
        className="btn btn-icon"
        onClick={() => setOn(!on)}
        title={t("metronome.label")}
        type="button"
      >
        <Icon name="metronome" />
      </button>
      <input
        aria-label={t("metronome.tempo")}
        className="tempo-input mono"
        max={240}
        min={30}
        onBlur={() => setDraft(String(tempo))}
        onChange={(event) => setDraft(event.target.value)}
        type="number"
        value={draft}
      />
    </div>
  );
}
