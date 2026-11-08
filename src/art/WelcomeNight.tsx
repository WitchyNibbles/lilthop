import { Bunny } from "./Bunny";
import { Moon } from "./Moon";

const STARS = [
  { cx: 62, cy: 48, r: 1.4 },
  { cx: 118, cy: 92, r: 1 },
  { cx: 176, cy: 36, r: 1.2 },
  { cx: 232, cy: 76, r: 1.6 },
  { cx: 288, cy: 28, r: 1 },
  { cx: 338, cy: 66, r: 1.3 },
  { cx: 372, cy: 142, r: 1 },
  { cx: 512, cy: 164, r: 1.2 },
] as const;

const FOUR_POINTS =
  "c1 5.6 1.8 6.4 7.4 7.4-5.6 1-6.4 1.8-7.4 7.4-1-5.6-1.8-6.4-7.4-7.4 5.6-1 6.4-1.8 7.4-7.4z";

/** The first thing anyone sees: the app's own night, and the thread the voice will draw in it. */
export function WelcomeNight() {
  return (
    <div
      aria-hidden="true"
      className="welcome-night"
      data-testid="welcome-night"
    >
      <svg
        className="welcome-sky"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 560 320"
      >
        {STARS.map((star) => (
          <circle className="welcome-star" key={star.cx} {...star} />
        ))}
        <path className="welcome-spark" d={`M96 34${FOUR_POINTS}`} />
        <path className="welcome-spark" d={`M304 104${FOUR_POINTS}`} />
        <path
          className="welcome-hill-far"
          d="M0 262c70-34 146-40 226-22s172 26 334-34v114H0z"
        />
        <path
          className="welcome-hill-near"
          d="M0 284c56-26 112-36 176-30s190 44 384 14v52H0z"
        />
        <path
          className="welcome-thread"
          d="M152 202c26-34 50-40 76-24s48 16 74-14 56-42 86-34"
        />
        <circle className="welcome-tip" cx="388" cy="130" r="4" />
      </svg>
      <Moon phase={0.72} />
      <Bunny perked={false} />
    </div>
  );
}
