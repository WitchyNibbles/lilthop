import { useApp, useMicContext } from "../app/appContext";
import { Icon } from "../art/icons";
import { NOTICE_MESSAGE } from "../domain/safety";
import { commandErrorMessage } from "../lib/tauri";
import { useLive } from "../live/useLive";
import { micIssueMessage } from "../mic/useMic";

export function useAlert(): { message: string; dismiss: () => void } | null {
  const { dataIssue, dismissDataIssue, t } = useApp();
  const mic = useMicContext();
  if (mic.issue !== null) {
    return {
      message: micIssueMessage(mic.issue, t),
      dismiss: mic.dismissIssue,
    };
  }
  if (dataIssue === null) return null;
  return {
    message: commandErrorMessage(dataIssue, t),
    dismiss: dismissDataIssue,
  };
}

/** On most screens it takes its own row above the page; in practice it sits under the trace. */
export function AlertBanner() {
  const { t } = useApp();
  const alert = useAlert();
  if (alert === null) return null;
  return (
    <div className="alert" role="alert">
      <p>{alert.message}</p>
      <button
        aria-label={t("alert.dismiss")}
        className="btn btn-icon"
        onClick={alert.dismiss}
        title={t("alert.dismiss")}
        type="button"
      >
        <Icon name="close" />
      </button>
    </div>
  );
}

/** Off Practice there is no strip, so the rest reminder borrows the alert's row for its ten seconds. */
export function AlertRow() {
  const { t } = useApp();
  const resting = useLive((view) => view.notice === "restBreak");
  if (!resting) return <AlertBanner />;
  return (
    <div className="alert" data-notice="restBreak" role="alert">
      <Icon name="stopSign" />
      <p>{t(NOTICE_MESSAGE.restBreak)}</p>
    </div>
  );
}
