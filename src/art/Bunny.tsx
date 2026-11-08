/**
 * Drawn by hand on a 64 px grid: head, two ears behind it, a small hat tipped over one ear.
 * Ears rest slightly out and rise when `perked`; the motion lives in live.css.
 */
export function Bunny({ perked }: { readonly perked: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="bunny"
      data-perked={perked}
      data-testid="bunny"
      viewBox="0 0 64 64"
    >
      <path
        className="bunny-ear bunny-ear-left"
        d="M24.5 32C19 25 14.5 15.5 16.5 8.5c.6-2 2.8-2.6 4.4-1.2 5.2 4.6 8.6 13 9.6 21.7"
      />
      <path
        className="bunny-ear bunny-ear-right"
        d="M39.5 32c5.5-7 10-16.5 8-23.5-.6-2-2.8-2.6-4.4-1.2-5.2 4.6-8.6 13-9.6 21.7"
      />
      <path
        className="bunny-ear-inner bunny-ear-left"
        d="M24.8 26.4c-2.8-4.4-4.9-9.4-5-13.6"
      />
      <path
        className="bunny-ear-inner bunny-ear-right"
        d="M39.2 26.4c2.8-4.4 4.9-9.4 5-13.6"
      />
      <path
        className="bunny-head"
        d="M32 28c-9 0-16 6.3-16 14.8C16 51 23 57 32 57s16-6 16-14.2C48 34.3 41 28 32 28z"
      />
      <g className="bunny-hat" transform="rotate(9 32 28)">
        <path
          className="bunny-hat-cone"
          d="M25 29.5c1.4-6.8 4-14.4 7.4-19 .8-1.1 2.2-1.6 3.4-1.3l5.2 1.4c-3.1.5-4.4 1.8-4.9 3.9L39 29.5"
        />
        <path className="bunny-hat-brim" d="M19.5 30.2c6.8 2.6 18.2 2.6 25 0" />
        <path className="bunny-hat-band" d="M25.8 26.2c4 1.2 8.7 1.2 12.4 0" />
      </g>
      <path className="bunny-eye" d="M25.5 41.5v2.5M38.5 41.5v2.5" />
      <path
        className="bunny-mouth"
        d="M30.6 47.2h2.8L32 48.8zM32 48.8c0 2-1.8 3-3.4 2M32 48.8c0 2 1.8 3 3.4 2"
      />
    </svg>
  );
}
