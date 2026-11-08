import { useEffect, useState } from "react";
import { useApp, useRecordingsContext } from "../app/appContext";
import { Icon } from "../art/icons";
import type { Language, RecordingInfo } from "../domain/contract";
import type { Translator } from "../i18n";
import { commandErrorMessage } from "../lib/tauri";
import { ConfirmDialog } from "../shell/ConfirmDialog";
import { focusHeading } from "../shell/focusHeading";
import { RecordingRow } from "./RecordingRow";
import type { RecordingsNotice } from "./useRecordings";

function dateOf(item: RecordingInfo, language: Language): string {
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(item.modifiedTs * 1000));
}

function matches(item: RecordingInfo, date: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return [item.note, item.tags, date].some((text) =>
    text.toLowerCase().includes(needle),
  );
}

function noticeText(notice: RecordingsNotice | null, t: Translator): string {
  if (notice === null) return "";
  return notice.kind === "message"
    ? t(notice.key)
    : commandErrorMessage(notice.error, t);
}

function Recorder() {
  const { t } = useApp();
  const recordings = useRecordingsContext();
  const { recorder, notice } = recordings;
  const running = recorder === "recording" || recorder === "stopping";
  return (
    <div className="recorder">
      <button
        className="btn btn-primary"
        disabled={recorder === "starting" || recorder === "stopping"}
        onClick={running ? recordings.stop : recordings.record}
        type="button"
      >
        <Icon name={running ? "stop" : "mic"} />
        {t(running ? "recordings.stopRecording" : "recordings.record")}
      </button>
      <p className="recorder-state">
        {running ? t("recordings.recording") : ""}
      </p>
      <p
        className="action-result"
        data-failed={notice?.kind === "error"}
        role="status"
      >
        {noticeText(notice, t)}
      </p>
    </div>
  );
}

export function RecordingsScreen() {
  const { language, t } = useApp();
  const recordings = useRecordingsContext();
  const { items, loaded, refresh, remove } = recordings;
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<RecordingInfo | null>(null);

  useEffect(refresh, [refresh]);

  // A deleted row takes its focused button with it; do not drop the keyboard at the page top.
  useEffect(() => {
    if (document.activeElement === document.body) focusHeading();
  }, [items]);

  const dated = items.map((item) => ({
    item,
    date: dateOf(item, language),
  }));
  const shown = dated.filter(({ item, date }) => matches(item, date, query));

  return (
    <div className="recordings">
      <h1>{t("recordings.title")}</h1>
      <Recorder />
      {loaded && items.length === 0 ? (
        <div className="empty">
          <p>{t("recordings.none")}</p>
          <p className="side-note">{t("recordings.noneHelp")}</p>
        </div>
      ) : null}
      {items.length > 0 ? (
        <input
          aria-label={t("recordings.search")}
          className="search"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("recordings.search")}
          type="search"
          value={query}
        />
      ) : null}
      {items.length > 0 && shown.length === 0 ? (
        <p className="side-note">{t("recordings.noMatch")}</p>
      ) : null}
      <ul className="recording-list">
        {shown.map(({ item, date }) => (
          <RecordingRow
            date={date}
            item={item}
            key={item.name}
            onDelete={() => setDeleting(item)}
          />
        ))}
      </ul>
      {deleting === null ? null : (
        <ConfirmDialog
          action={t("common.delete")}
          body={t("recordings.confirmBody", {
            date: dateOf(deleting, language),
          })}
          cancel={t("common.cancel")}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            remove(deleting.name);
            setDeleting(null);
          }}
          title={t("recordings.confirmTitle")}
        />
      )}
    </div>
  );
}
