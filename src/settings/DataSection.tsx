import { useEffect, useState } from "react";
import {
  useApp,
  useMicContext,
  useRecordingsContext,
  useSessionContext,
} from "../app/appContext";
import { useAction } from "../app/useAction";
import type { ExportFormat, RestoreSummary } from "../domain/contract";
import type { Translator } from "../i18n";
import {
  AppCommandError,
  backupCreate,
  backupRestore,
  canMoveEarlierData,
  deleteAllData,
  exportData,
  moveEarlierData,
} from "../lib/tauri";
import { ActionResult } from "../shell/ActionResult";
import { ConfirmDialog } from "../shell/ConfirmDialog";

function restoredMessage(summary: RestoreSummary, t: Translator): string {
  const { results, recordings, profile } = summary;
  return t(profile ? "data.restoredProfile" : "data.restored", {
    results,
    recordings,
  });
}

export function DataSection() {
  const { openScreen, reloadData, reportDataIssue, t } = useApp();
  const mic = useMicContext();
  const session = useSessionContext();
  const recordings = useRecordingsContext();
  const action = useAction();
  const [confirming, setConfirming] = useState(false);
  const [canMove, setCanMove] = useState(false);
  const busy = action.state.kind === "busy";

  // If the backend can't say, the way back stays hidden; Start fresh never loses data.
  useEffect(() => {
    let current = true;
    canMoveEarlierData().then(
      (can) => current && setCanMove(can),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, []);

  const exportAs = (format: ExportFormat) => {
    action.run(async () => {
      const name = await exportData(format);
      return name === null ? t("data.cancelled") : t("data.exported", { name });
    });
  };

  const backup = () => {
    action.run(async () => {
      const name = await backupCreate();
      return name === null ? t("data.cancelled") : t("data.backedUp", { name });
    });
  };

  const restore = () => {
    action.run(async () => {
      const summary = await backupRestore();
      if (summary === null) return t("data.cancelled");
      reloadData();
      return restoredMessage(summary, t);
    });
  };

  const moveEarlier = () => {
    action.run(async () => {
      // A failed move keeps the fresh start and the Start fresh choice, so the error shows here.
      await moveEarlierData();
      reloadData();
      setCanMove(false);
      return t("data.movedEarlier");
    });
  };

  const deleteEverything = () => {
    setConfirming(false);
    action.run(async () => {
      session.reset();
      if (mic.status === "on") await mic.stop();
      const report = await deleteAllData();
      recordings.clear();
      reloadData();
      openScreen("home");
      // The page is replaced by the welcome, so the alert row is where this can be read.
      if (report.couldNotCheck) {
        reportDataIssue(
          new AppCommandError("earlier_data_unchecked", "", "delete_all_data"),
        );
      }
      return t("data.deleted");
    });
  };

  return (
    <section className="settings-section">
      <h2>{t("settings.yourData")}</h2>
      <div className="data-actions">
        <button
          className="btn"
          disabled={busy}
          onClick={() => exportAs("json")}
          type="button"
        >
          {t("data.exportJson")}
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() => exportAs("csv")}
          type="button"
        >
          {t("data.exportCsv")}
        </button>
        <button className="btn" disabled={busy} onClick={backup} type="button">
          {t("data.backup")}
        </button>
        <button className="btn" disabled={busy} onClick={restore} type="button">
          {t("data.restore")}
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() => setConfirming(true)}
          type="button"
        >
          {t("data.deleteAll")}
        </button>
        {canMove ? (
          <button
            className="btn"
            disabled={busy}
            onClick={moveEarlier}
            type="button"
          >
            {t("data.moveEarlier")}
          </button>
        ) : null}
      </div>
      <ActionResult state={action.state} />
      {confirming ? (
        <ConfirmDialog
          action={t("data.confirmAction")}
          body={t("data.confirmBody")}
          cancel={t("common.cancel")}
          onCancel={() => setConfirming(false)}
          onConfirm={deleteEverything}
          title={t("data.confirmTitle")}
        />
      ) : null}
    </section>
  );
}
