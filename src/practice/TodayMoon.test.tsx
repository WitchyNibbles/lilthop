import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { litPath } from "../art/Moon";
import { translator } from "../i18n";
import { setReducedMotion } from "../test/fakeBrowser";
import { TodayMoon } from "./TodayMoon";

vi.mock("../home/useRoutine", () => ({
  useTodayMoon: () => ({ phase: 0.5, done: 1, total: 2 }),
}));
vi.mock("../app/appContext", () => ({
  useApp: () => ({ t: translator("en") }),
}));

/** The app runs in StrictMode, and a fast save is already in when the panel first draws. */
function mountAfterTheSave() {
  render(
    <StrictMode>
      <TodayMoon from={0.25} />
    </StrictMode>,
  );
  const lit = screen.getByTestId("today-moon").querySelector(".moon-lit");
  return () => lit?.getAttribute("d");
}

/** The fill runs on the frame clock, so the test drives that clock instead of waiting for it. */
const FILL_MS = 1_400;

function runOn(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("today's moon", () => {
  it("starts where the day stood and fills to where it is now", () => {
    vi.useFakeTimers({
      toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
    });
    const drawn = mountAfterTheSave();
    expect(drawn()).toBe(litPath(0.25));
    runOn(FILL_MS / 2);
    expect(drawn()).not.toBe(litPath(0.25));
    expect(drawn()).not.toBe(litPath(0.5));
    runOn(FILL_MS);
    expect(drawn()).toBe(litPath(0.5));
    runOn(FILL_MS);
    expect(drawn()).toBe(litPath(0.5));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("goes straight to the end with reduced motion on", () => {
    setReducedMotion(true);
    expect(mountAfterTheSave()()).toBe(litPath(0.5));
  });
});
