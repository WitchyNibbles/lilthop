import { useState } from "react";
import { useApp } from "../app/appContext";
import type { MessageKey } from "../i18n";
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

interface FailureCopy {
  readonly title: MessageKey;
  readonly body: MessageKey;
  readonly stillFailed: MessageKey;
}

/** What the screen says for each way the read can fail. */
const COPY = {
  read: {
    title: "load.title",
    body: "load.body",
    stillFailed: "load.stillFailed",
  },
  move: {
    title: "load.moveTitle",
    body: "error.migration_failed",
    stillFailed: "load.moveStillFailed",
  },
  newer: {
    title: "load.newerTitle",
    body: "error.newer_data",
    stillFailed: "load.stillFailed",
  },
} as const satisfies Record<string, FailureCopy>;

type Failure = keyof typeof COPY;

// Earlier data that could not be copied over, or data this version can't read, is a different
// worry from a profile that won't read.
function failureOf(error: unknown): Failure {
  if (!(error instanceof AppCommandError)) return "read";
  if (error.kind === "migration_failed") return "move";
  if (error.kind === "newer_data") return "newer";
  return "read";
}

/** Setup would write a blank profile over the real one, so this stands in until a read works. */
export function LoadFailedScreen() {
  const { openScreen, profileRead, readError, reloadData, t } = useApp();
  const [tried, setTried] = useState(false);
  const [freshFailed, setFreshFailed] = useState(false);
  const retrying = profileRead === "retrying";
  const failure = failureOf(readError);
  const copy = COPY[failure];
  const moveFailed = failure === "move";

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
      <h1>{t(copy.title)}</h1>
      <div className="step-body">
        <p role="alert">{t(copy.body)}</p>
        {tried && !retrying ? <p role="status">{t(copy.stillFailed)}</p> : null}
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
