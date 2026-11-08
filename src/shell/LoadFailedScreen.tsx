import { useState } from "react";
import { useApp } from "../app/appContext";
import { AppCommandError, startFresh } from "../lib/tauri";
import { ConfirmDialog } from "./ConfirmDialog";

/** Asks first: it ends the move for good, and what happens to the old folder should be clear. */
function StartFreshButton(props: {
  readonly disabled: boolean;
  readonly onConfirmed: () => void;
}) {
  const { t } = useApp();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <button
        className="btn"
        disabled={props.disabled}
        onClick={() => setConfirming(true)}
        type="button"
      >
        {t("load.startFresh")}
      </button>
      {confirming ? (
        <ConfirmDialog
          action={t("load.startFreshAction")}
          body={t("load.startFreshConfirmBody")}
          cancel={t("common.cancel")}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            props.onConfirmed();
          }}
          title={t("load.startFreshConfirmTitle")}
        />
      ) : null}
    </>
  );
}

/** Setup would write a blank profile over the real one, so this stands in until a read works. */
export function LoadFailedScreen() {
  const { openScreen, profileRead, readError, reloadData, t } = useApp();
  const [tried, setTried] = useState(false);
  const [freshFailed, setFreshFailed] = useState(false);
  const retrying = profileRead === "retrying";
  // Earlier data that could not be copied over is a different worry from a profile that won't read.
  const moveFailed =
    readError instanceof AppCommandError &&
    readError.kind === "migration_failed";

  const tryAgain = () => {
    setTried(true);
    // Home is where setup catches a first run, whichever screen this covered.
    openScreen("home");
    reloadData();
  };

  // The move can't ever work on some machines, so there is a way out that leaves the old folder alone.
  const beginEmpty = () => {
    setFreshFailed(false);
    startFresh().then(tryAgain, () => {
      setFreshFailed(true);
    });
  };

  return (
    <div className="onboarding">
      <h1>{t(moveFailed ? "load.moveTitle" : "load.title")}</h1>
      <div className="step-body">
        <p role="alert">
          {t(moveFailed ? "error.migration_failed" : "load.body")}
        </p>
        {tried && !retrying ? (
          <p role="status">
            {t(moveFailed ? "load.moveStillFailed" : "load.stillFailed")}
          </p>
        ) : null}
        {moveFailed ? <p>{t("load.startFreshNote")}</p> : null}
        {freshFailed ? <p role="status">{t("load.startFreshFailed")}</p> : null}
      </div>
      <div className="step-actions">
        <button
          className="btn btn-primary"
          disabled={retrying}
          onClick={tryAgain}
          type="button"
        >
          {t("error.retry")}
        </button>
        {moveFailed ? (
          <StartFreshButton disabled={retrying} onConfirmed={beginEmpty} />
        ) : null}
      </div>
    </div>
  );
}
