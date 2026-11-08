import type { Zone } from "./liveFeed";

export const HERTZ = "Hz";

const READOUT_WIDTH = 4;
const NO_READING = "---";

/**
 * Always the same number of characters: with a mono font the text can never change width.
 * The digits start at the left edge, in line with the label, unless `side` says otherwise.
 */
export function formatReadout(
  value: number | null,
  side: "start" | "end" = "start",
): string {
  const text = value === null ? NO_READING : String(Math.round(value));
  return side === "start"
    ? text.padEnd(READOUT_WIDTH, " ")
    : text.padStart(READOUT_WIDTH, " ");
}

interface ReadoutProps {
  readonly label: string;
  readonly value: number | null;
  readonly unit: string;
  readonly dimmed: boolean;
  readonly compact?: boolean;
  /** Where the voice is against the band; the tone of the number follows it. */
  readonly zone?: Zone;
  /** A number the accent colour must not flatter, because no value of it is better. */
  readonly neutral?: boolean;
}

/** A plain element, not `output`: the number must not be announced by a screen reader. */
export function Readout(props: ReadoutProps) {
  const { label, value, unit, dimmed, compact, zone, neutral } = props;
  const isCompact = compact === true;
  const number = (
    <span
      className="readout-value"
      data-dimmed={dimmed}
      data-neutral={neutral}
      data-testid="readout-value"
      data-zone={zone}
    >
      {formatReadout(value, isCompact ? "end" : "start")}
    </span>
  );
  const name = <span className="readout-label">{label}</span>;
  const measure = <span className="readout-unit">{unit}</span>;
  if (isCompact)
    return (
      <div className="readout" data-compact="true">
        {name}
        <span className="readout-line">
          {number}
          {measure}
        </span>
      </div>
    );
  return (
    <div className="readout">
      <span className="readout-head">
        {name}
        {measure}
      </span>
      {number}
    </div>
  );
}
