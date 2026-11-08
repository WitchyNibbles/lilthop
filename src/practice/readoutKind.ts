import { showsPitch, type Measure } from "../domain/exercises";
import type { MessageKey } from "../i18n";

/** What the live column reads out. */
export type ReadoutKind = "pitch" | "brightness" | "level";

export function readoutKind(measure: Measure): ReadoutKind {
  if (!showsPitch(measure)) return "level";
  return measure === "brightness" ? "brightness" : "pitch";
}

/** The honest note that sits next to each kind of reading. */
const READOUT_NOTE: Readonly<Record<ReadoutKind, MessageKey>> = {
  pitch: "safety.s11",
  brightness: "safety.s14",
  level: "safety.s13",
};

/** Raising gets its own line, S15: go only as high as feels easy. */
export function readoutNote(measure: Measure): MessageKey {
  return measure === "raise"
    ? "safety.s15"
    : READOUT_NOTE[readoutKind(measure)];
}
