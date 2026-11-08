import { describe, expect, it } from "vitest";
import base from "./base.css?raw";
import live from "./live.css?raw";
import tokens from "./tokens.css?raw";

const sources = import.meta.glob<string>(
  ["../**/*.{ts,tsx,css}", "!../**/*.test.{ts,tsx}", "!../test/**"],
  { query: "?raw", import: "default", eager: true },
);

function block(selector: string): ReadonlyMap<string, string> {
  const start = tokens.indexOf(selector);
  const open = tokens.indexOf("{", start);
  const close = tokens.indexOf("}", open);
  const entries = [
    ...tokens.slice(open, close).matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6});/g),
  ];
  return new Map(entries.map((m) => [m[1] ?? "", m[2] ?? ""]));
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

const SURFACES = [
  "--surface-stage",
  "--surface-rail",
  "--surface-raised",
  "--surface-hover",
];
const TEXT = ["--text", "--text-muted", "--gold", "--lavender", "--pink"];
const GRAPHICS = [
  "--gold",
  "--lavender",
  "--pink",
  "--rule-strong",
  "--focus",
  "--moon-full",
  "--moon-rim",
];

const themes: readonly [string, string][] = [
  ["dark", '[data-theme="dark"]'],
  ["light", '[data-theme="light"]'],
];

describe.each(themes)("%s palette", (_name, selector) => {
  const palette = block(selector);
  const colour = (name: string) => {
    const value = palette.get(name);
    if (value === undefined) throw new Error(`${name} is not a plain colour`);
    return value;
  };

  it.each(TEXT.flatMap((text) => SURFACES.map((s) => [text, s] as const)))(
    "%s reads at 4.5:1 on %s",
    (text, surface) => {
      expect(contrast(colour(text), colour(surface))).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );

  it.each(GRAPHICS.flatMap((g) => SURFACES.map((s) => [g, s] as const)))(
    "%s shows at 3:1 on %s",
    (graphic, surface) => {
      expect(contrast(colour(graphic), colour(surface))).toBeGreaterThanOrEqual(
        3,
      );
    },
  );

  it("the edge of the band shows at 3:1 in the trace window", () => {
    expect(
      contrast(colour("--trace-band-edge"), colour("--surface-window")),
    ).toBeGreaterThanOrEqual(3);
  });

  it("the tip's glow fades to its own gold at zero alpha", () => {
    const start = tokens.indexOf(selector);
    const body = tokens.slice(start, tokens.indexOf("}", start));
    const value = (name: string) =>
      new RegExp(`${name}:\\s*#([0-9a-f]{6})([0-9a-f]{2});`).exec(body);
    const glow = value("--trace-glow");
    const fade = value("--trace-glow-fade");
    expect(fade?.[1]).toBe(glow?.[1]);
    expect(fade?.[2]).toBe("00");
  });

  it("the primary action reads on its own fill and shows on the stage", () => {
    expect(
      contrast(colour("--on-action"), colour("--action")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(colour("--on-action"), colour("--action-hover")),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(colour("--action-edge"), colour("--surface-stage")),
    ).toBeGreaterThanOrEqual(3);
  });
});

describe("the checkbox", () => {
  const rule = /input\[type="checkbox"\] \{([^}]*)\}/.exec(base)?.[1] ?? "";

  it("is drawn by the theme, not the browser", () => {
    expect(rule).toMatch(/appearance:\s*none/);
    expect(base).toMatch(/input\[type="checkbox"\]:checked/);
  });

  it("keeps the focus ring every control gets", () => {
    expect(base).not.toMatch(/checkbox[^{]*\{[^}]*outline:\s*(none|0)/);
  });
});

describe("the craft floor", () => {
  it("has no coloured stripe down the side of anything", () => {
    const stripe = /inset\s+-?[1-9]\d*px\s+0\s+0/;
    const striped = Object.entries(sources)
      .filter(([path, text]) => path.endsWith(".css") && stripe.test(text))
      .map(([path]) => path);
    expect(striped).toEqual([]);
  });
});

describe("tokens", () => {
  it("both themes define the same names", () => {
    const names = (selector: string) => {
      const start = tokens.indexOf(selector);
      const body = tokens.slice(
        tokens.indexOf("{", start),
        tokens.indexOf("}", start),
      );
      return [...body.matchAll(/(--[\w-]+):/g)].map((m) => m[1]).sort();
    };
    expect(names('[data-theme="light"]')).toEqual(names('[data-theme="dark"]'));
  });

  it("no raw hex colour lives outside tokens.css", () => {
    const offenders = Object.entries(sources).filter(
      ([path, text]) =>
        !path.endsWith("/tokens.css") && /#[0-9a-fA-F]{3,8}\b/.test(text),
    );
    expect(offenders.map(([path]) => path)).toEqual([]);
  });
});

describe("a reading with nothing fresh", () => {
  it("dims to the muted text colour, which is held to 4.5:1, not to a see-through gold", () => {
    const rule = /\.readout-value\[data-dimmed="true"\]\s*{([^}]*)}/.exec(live);
    expect(rule?.[1]).toContain("color: var(--text-muted)");
    expect(rule?.[1]).not.toContain("opacity");
  });
});
