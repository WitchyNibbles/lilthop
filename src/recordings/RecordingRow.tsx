import { useState } from "react";
import { useApp, useRecordingsContext } from "../app/appContext";
import { Icon } from "../art/icons";
import type { RecordingInfo } from "../domain/contract";
import { commandErrorMessage } from "../lib/tauri";

const MAX_NOTE_CHARS = 4000;
const MAX_TAGS_CHARS = 500;

type SaveState =
  | { readonly kind: "none" | "saving" | "saved" }
  | { readonly kind: "failed"; readonly error: unknown };

function SaveStatus({
  save,
  onRetry,
}: {
  readonly save: SaveState;
  readonly onRetry: () => void;
}) {
  const { t } = useApp();
  if (save.kind === "failed") {
    const reason = commandErrorMessage(save.error, t);
    return (
      <span className="row-save" data-failed="true">
        {t("recordings.saveFailed", { reason })}
        <button className="btn" onClick={onRetry} type="button">
          {t("error.retry")}
        </button>
      </span>
    );
  }
  if (save.kind === "none") return <span className="row-save" />;
  return (
    <span className="row-save">
      {t(save.kind === "saving" ? "recordings.saving" : "recordings.saved")}
    </span>
  );
}

interface RecordingRowProps {
  readonly item: RecordingInfo;
  readonly date: string;
  readonly onDelete: () => void;
}

export function RecordingRow({ item, date, onDelete }: RecordingRowProps) {
  const { t } = useApp();
  const recordings = useRecordingsContext();
  const [draft, setDraft] = useState<RecordingInfo | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "none" });
  const shown = draft ?? item;
  const playing = recordings.playing === item.name;

  /** Only a real change is written: leaving a box untouched must never touch the saved note. */
  const commit = () => {
    if (shown.note === item.note && shown.tags === item.tags) return;
    setSave({ kind: "saving" });
    recordings
      .saveMeta(shown)
      .then(() => {
        setDraft((latest) => (latest === shown ? null : latest));
        setSave({ kind: "saved" });
      })
      .catch((error: unknown) => setSave({ kind: "failed", error }));
  };

  return (
    <li className="recording">
      <div className="recording-head">
        <button
          aria-label={t(playing ? "recordings.stopOne" : "recordings.playOne", {
            date,
          })}
          className="btn btn-icon"
          onClick={() =>
            playing ? recordings.stopPlaying() : recordings.play(item.name)
          }
          title={t(playing ? "recordings.stopPlayback" : "common.play")}
          type="button"
        >
          <Icon name={playing ? "stop" : "play"} />
        </button>
        <span className="recording-date">{date}</span>
        <span className="recording-length">
          {t("recordings.length", { seconds: Math.round(item.durationS) })}
        </span>
        <SaveStatus onRetry={commit} save={save} />
        <button
          aria-label={t("recordings.deleteOne", { date })}
          className="btn btn-icon"
          onClick={onDelete}
          title={t("common.delete")}
          type="button"
        >
          <Icon name="trash" />
        </button>
      </div>
      <div className="recording-fields">
        <input
          aria-label={t("recordings.noteFor", { date })}
          maxLength={MAX_NOTE_CHARS}
          onBlur={commit}
          onChange={(event) => setDraft({ ...shown, note: event.target.value })}
          placeholder={t("recordings.note")}
          type="text"
          value={shown.note}
        />
        <input
          aria-label={t("recordings.tagsFor", { date })}
          maxLength={MAX_TAGS_CHARS}
          onBlur={commit}
          onChange={(event) => setDraft({ ...shown, tags: event.target.value })}
          placeholder={t("recordings.tags")}
          type="text"
          value={shown.tags}
        />
      </div>
    </li>
  );
}
