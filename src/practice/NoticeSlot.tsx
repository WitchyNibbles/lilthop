import { useApp, useSessionContext } from "../app/appContext";
import { Icon } from "../art/icons";
import { QuietSky } from "../art/QuietSky";
import {
  goesBeforeAlert,
  NOTICE_MESSAGE,
  type NoticeId,
} from "../domain/safety";
import type { Translator } from "../i18n";
import { useLive } from "../live/useLive";
import { useAlert } from "../shell/AlertBanner";
import type { SessionState } from "./useSession";

interface SlotContent {
  readonly notice: NoticeId | null;
  readonly lines: readonly string[];
  /** The missing range is the one line with somewhere to send someone: Settings. */
  readonly opensSettings?: boolean;
}

/** Notices that ask for something, then an alert, then neutral notices, then a session's notes. */
function useSlotContent(): SlotContent {
  const { band, t } = useApp();
  const { state } = useSessionContext();
  const live = useLive((view) => view.notice);
  const alerted = useAlert() !== null;
  const notice = alerted && !goesBeforeAlert(live) ? null : live;
  if (notice !== null) return { notice, lines: [t(NOTICE_MESSAGE[notice])] };
  if (alerted) return { notice, lines: [] };
  if (state.phase === "result" && state.outcome.status === "scored")
    return { notice, lines: [t("result.oneTake"), t("safety.s3")] };
  return { notice, ...neutralContent(state, band !== null, t) };
}

/** The missing range goes first, as it is the line with somewhere to go; then a dropped session. */
function neutralContent(
  state: SessionState,
  hasRange: boolean,
  t: Translator,
): Omit<SlotContent, "notice"> {
  if (!hasRange)
    return { lines: [t("exercise.needsRange")], opensSettings: true };
  if (state.phase === "idle" && state.discarded)
    return { lines: [t("exercise.discarded")] };
  return { lines: [] };
}

function OpenSettingsButton() {
  const { openScreen, t } = useApp();
  return (
    <button
      className="btn"
      onClick={() => openScreen("settings")}
      type="button"
    >
      {t("exercise.openSettings")}
    </button>
  );
}

/** Fills the sill, whose size never changes, so a notice arriving moves nothing. */
export function NoticeSlot() {
  const { notice, lines, opensSettings = false } = useSlotContent();
  const filled = lines.length > 0;
  return (
    <div
      aria-live="polite"
      className="notice-slot"
      data-filled={filled}
      data-notice={notice ?? undefined}
      data-testid="notice-slot"
    >
      {filled ? null : <QuietSky />}
      <div className="notice-card">
        {notice === null ? null : (
          <Icon name={notice === "restBreak" ? "stopSign" : "flame"} />
        )}
        <p>
          {lines.map((line) => (
            <span key={line}>{`${line} `}</span>
          ))}
        </p>
        {opensSettings ? <OpenSettingsButton /> : null}
      </div>
    </div>
  );
}
