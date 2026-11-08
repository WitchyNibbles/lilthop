import type { Ref } from "react";

const CENTRE = 16;
const RADIUS = 13;
const TOP = CENTRE - RADIUS;
const BOTTOM = CENTRE + RADIUS;

/** The lit part of a waxing moon, 0 new to 1 full: a half circle and a terminator arc back. */
export function litPath(phase: number): string {
  if (phase <= 0) return "";
  const lit = Math.min(phase, 1);
  const terminator = (RADIUS * Math.abs(1 - 2 * lit)).toFixed(2);
  const bulge = lit < 0.5 ? 0 : 1;
  return (
    `M${CENTRE} ${TOP}A${RADIUS} ${RADIUS} 0 0 1 ${CENTRE} ${BOTTOM}` +
    `A${terminator} ${RADIUS} 0 0 ${bulge} ${CENTRE} ${TOP}Z`
  );
}

function moonName(phase: number): "new" | "waxing" | "full" {
  if (phase <= 0) return "new";
  return phase >= 1 ? "full" : "waxing";
}

interface MoonProps {
  /** 0 is a new moon, 1 is full. */
  readonly phase: number;
  /** For drawing the lit part by hand, when it has to move. */
  readonly litRef?: Ref<SVGPathElement>;
}

/** A practised day is a full moon with soft maria; a day off is simply a new moon. */
export function Moon({ phase, litRef }: MoonProps) {
  return (
    <svg
      aria-hidden="true"
      className="moon"
      data-moon={moonName(phase)}
      viewBox="0 0 32 32"
    >
      <circle className="moon-disc" cx={CENTRE} cy={CENTRE} r={RADIUS} />
      <path className="moon-lit" d={litPath(phase)} ref={litRef} />
      <circle className="moon-mare" cx="11.5" cy="12.5" r="3.2" />
      <circle className="moon-mare" cx="19.5" cy="18.5" r="4.2" />
      <circle className="moon-mare" cx="12.5" cy="21" r="1.8" />
    </svg>
  );
}
