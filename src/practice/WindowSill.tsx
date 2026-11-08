import { goesBeforeAlert } from "../domain/safety";
import { useLive } from "../live/useLive";
import { AlertBanner } from "../shell/AlertBanner";
import { NoticeSlot } from "./NoticeSlot";

/** Only one voice fits under the trace: the notices that ask for something go before an alert. */
function SillAlert() {
  const waits = useLive((view) => goesBeforeAlert(view.notice));
  return waits ? null : <AlertBanner />;
}

/** The strip under the trace. It always keeps its size, so the canvas never changes. */
export function WindowSill() {
  return (
    <div className="window-sill">
      <NoticeSlot />
      <SillAlert />
    </div>
  );
}
