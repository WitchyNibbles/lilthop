import type { MessageKey } from "../i18n";
import type { MicStatus } from "../mic/useMic";
import type { Zone } from "./liveFeed";

const ZONE_MESSAGE: Readonly<Record<Zone, MessageKey>> = {
  quiet: "reading.listening",
  voice: "reading.hearingYou",
  below: "reading.belowBand",
  in: "reading.inBand",
  above: "reading.aboveBand",
};

const MIC_MESSAGE: Readonly<Record<MicStatus, MessageKey>> = {
  off: "reading.micOff",
  starting: "mic.starting",
  on: "reading.listening",
};

/** A recording is the mic in use whatever the pitch stream is doing, so it is said first. */
export function micMessage(mic: MicStatus, recording: boolean): MessageKey {
  return recording ? "recordings.recording" : MIC_MESSAGE[mic];
}

/** The status in words. With no pitch to compare, the mic state is all there is to say. */
export function liveStatusMessage(
  mic: MicStatus,
  zone: Zone,
  showsZone: boolean,
  recording: boolean,
): MessageKey {
  if (mic === "on" && showsZone && !recording) return ZONE_MESSAGE[zone];
  return micMessage(mic, recording);
}
