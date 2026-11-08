import type { Zone } from "./liveFeed";

/**
 * The band as a bar, with a chevron above and below it. Which part is drawn solid says where the
 * voice is, so the meaning is in the shape and position and never in a colour.
 */
export function ZoneMark({ zone }: { readonly zone: Zone }) {
  return (
    <svg
      aria-hidden="true"
      className="zone-mark"
      data-testid="zone-mark"
      data-zone={zone}
      viewBox="0 0 28 56"
    >
      <path className="zone-above" d="M6 13 14 5l8 8" />
      <rect className="zone-band" height="14" rx="3" width="20" x="4" y="21" />
      <path className="zone-below" d="m6 43 8 8 8-8" />
    </svg>
  );
}
