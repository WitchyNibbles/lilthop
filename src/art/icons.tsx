import type { ReactNode } from "react";

const PATHS = {
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  stop: <rect height="11" rx="1.5" width="11" x="6.5" y="6.5" />,
  trash: (
    <path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7M10.5 11v5M13.5 11v5" />
  ),
  home: <path d="M4 11.5 12 4.5l8 7V20h-5.5v-5.5h-5V20H4z" />,
  practice: (
    <path d="M2.5 15c2.8 0 3.2-7.5 6.2-7.5s3.2 9.5 6.3 9.5 3.4-7 6.5-7" />
  ),
  progress: <path d="M20 14.6A8.4 8.4 0 1 1 9.4 4a6.8 6.8 0 0 0 10.6 10.6z" />,
  recordings: (
    <>
      <circle cx="12" cy="12" r="8.25" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7.5h9M17.5 7.5H20M4 16.5h2.5M11 16.5h9" />
      <circle cx="15.25" cy="7.5" r="2.25" />
      <circle cx="8.75" cy="16.5" r="2.25" />
    </>
  ),
  mic: (
    <>
      <rect height="11" rx="3" width="6" x="9" y="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </>
  ),
  micOff: (
    <>
      <path d="M9 9V6a3 3 0 0 1 5.8-1M15 11v.1a3 3 0 0 1-4.6 2.4" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 10.3 5.3M18.4 12.6c.1-.4.1-.7.1-1.1M12 18v3M4 4l16 16" />
    </>
  ),
  stopSign: (
    <>
      <path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3z" />
      <path d="M12 7.5v5.5M12 16.4v.1" />
    </>
  ),
  flame: (
    <path d="M12 3c3.4 4 5.5 6.6 5.5 10.2a5.5 5.5 0 0 1-11 0C6.5 9.6 8.6 7 12 3z" />
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  metronome: <path d="M9.2 3.5h5.6L19 20.5H5zM12 15.5l5-8" />,
  chevron: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

/** Authored at 24 px with one stroke weight, so every icon sits in the same line as the bunny. */
export function Icon({ name }: { readonly name: IconName }) {
  return (
    <svg aria-hidden="true" className="icon" viewBox="0 0 24 24">
      {PATHS[name]}
    </svg>
  );
}
