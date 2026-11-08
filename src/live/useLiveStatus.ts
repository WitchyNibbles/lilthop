import { useMicContext, useRecordingsContext } from "../app/appContext";
import type { MessageKey } from "../i18n";
import { liveStatusMessage } from "./liveStatus";
import { useLive } from "./useLive";

export function useLiveStatus(showsZone: boolean): MessageKey {
  const mic = useMicContext();
  const { recorder } = useRecordingsContext();
  const zone = useLive((view) => view.zone);
  return liveStatusMessage(mic.status, zone, showsZone, recorder !== "idle");
}
