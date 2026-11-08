import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MoonStrip } from "./MoonStrip";

const DAYS = [
  { daysAgo: 2, practised: true },
  { daysAgo: 1, practised: false },
  { daysAgo: 0, practised: true },
];

function strip() {
  render(
    <MoonStrip
      days={DAYS}
      label="Days"
      language="en"
      today={new Date(2026, 10, 6)}
      todayPhase={1}
    />,
  );
  return screen.getByRole("img", { name: "Days" });
}

describe("MoonStrip", () => {
  it("draws each day as an SVG moon in order, oldest first", () => {
    const moons = [...strip().querySelectorAll("[data-moon]")];
    expect(moons.map((moon) => moon.getAttribute("data-moon"))).toEqual([
      "full",
      "new",
      "full",
    ]);
    expect(moons.every((moon) => moon.tagName === "svg")).toBe(true);
  });

  it("draws today at its own phase", () => {
    render(
      <MoonStrip
        days={DAYS}
        label="Half"
        language="en"
        today={new Date(2026, 10, 6)}
        todayPhase={0.5}
      />,
    );
    const moons = screen.getByRole("img", { name: "Half" });
    expect(moons.querySelectorAll('[data-moon="waxing"]')).toHaveLength(1);
  });

  it("marks today", () => {
    expect(strip().querySelectorAll('[data-today="true"]')).toHaveLength(1);
  });

  it("labels each day by weekday in the language", () => {
    expect(strip()).toHaveTextContent("WTF");
  });
});
