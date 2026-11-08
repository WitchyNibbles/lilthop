const STARS = [
  { cx: 34, cy: 24, r: 1.1 },
  { cx: 92, cy: 14, r: 0.8 },
  { cx: 138, cy: 30, r: 1 },
  { cx: 196, cy: 12, r: 1.2 },
  { cx: 248, cy: 26, r: 0.8 },
] as const;

/** The strip under the trace with nothing to say: a bit of night, so it reads as a place. */
export function QuietSky() {
  return (
    <svg
      aria-hidden="true"
      className="quiet-sky"
      data-testid="quiet-sky"
      preserveAspectRatio="xMidYMax slice"
      viewBox="0 0 360 76"
    >
      {STARS.map((star) => (
        <circle className="quiet-star" key={star.cx} {...star} />
      ))}
      <path
        className="quiet-moon"
        d="M322 12a13 13 0 1 0 11 20 10.5 10.5 0 0 1-11-20z"
      />
      <path className="quiet-hill" d="M0 62c58-14 104-12 158-3s112 12 202-7" />
    </svg>
  );
}
