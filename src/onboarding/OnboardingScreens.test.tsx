import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { rail, stage } from "../test/driveApp";
import {
  bootFresh,
  click,
  heading,
  measure,
  t,
  toCalibration,
  toMicStep,
} from "./onboardingTestKit";

describe("the measured values", () => {
  it("are set in the mono face", async () => {
    await toCalibration();
    await measure(182);
    const value = stage().getByText("182 Hz");
    expect(value).toHaveClass("mono");
    expect(stage().getByText("1900 Hz")).toHaveClass("mono");
  });
});

describe("the step count", () => {
  it("sits in the control row, between Back and Next, not above the heading", async () => {
    await bootFresh();
    await click(t("common.next"));
    const count = stage().getByText(
      t("onboarding.stepOf", { step: 2, total: 6 }),
    );
    const row = count.closest(".step-actions");
    expect(row).not.toBeNull();
    const back = stage().getByRole("button", { name: t("common.back") });
    const next = stage().getByRole("button", { name: t("common.next") });
    const follows = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(back.compareDocumentPosition(count) & follows).toBeTruthy();
    expect(count.compareDocumentPosition(next) & follows).toBeTruthy();
    expect(heading(t("safety.beforeTitle")).previousElementSibling).toBeNull();
  });
});

describe("one mic control during setup", () => {
  const seen = (text: string) =>
    screen
      .queryAllByText(text)
      .filter((line) => !line.classList.contains("sr-only"));

  it("offers Start mic and says the mic is off once on the mic step", async () => {
    await toMicStep();
    expect(
      screen.getAllByRole("button", { name: t("home.startMic") }),
    ).toHaveLength(1);
    expect(
      rail().queryByRole("button", { name: t("home.startMic") }),
    ).toBeNull();
    expect(seen(t("reading.micOff"))).toHaveLength(1);
  });

  it("offers Start mic once when measuring", async () => {
    await toCalibration();
    expect(
      screen.getAllByRole("button", { name: t("home.startMic") }),
    ).toHaveLength(1);
    expect(seen(t("reading.micOff")).length).toBeLessThanOrEqual(1);
  });

  it("keeps one way to stop the mic once it runs, on every step", async () => {
    await toMicStep();
    await click(t("home.startMic"));
    expect(
      screen.getAllByRole("button", { name: t("home.stopMic") }),
    ).toHaveLength(1);
    await click(t("common.next"));
    expect(
      screen.getAllByRole("button", { name: t("home.stopMic") }),
    ).toHaveLength(1);
    await click(t("common.skip"));
    expect(
      rail().getByRole("button", { name: t("home.stopMic") }),
    ).toBeInTheDocument();
  });
});

describe("one primary at a time on the measuring step", () => {
  const primaries = () =>
    stage()
      .getAllByRole("button")
      .filter((button) => button.classList.contains("btn-primary"));
  const nextButton = () =>
    stage().getByRole("button", { name: t("common.next") });

  it("keeps Next secondary until something is measured", async () => {
    await toCalibration();
    expect(primaries()).toHaveLength(1);
    expect(nextButton()).not.toHaveClass("btn-primary");
  });

  it("still lets someone go on without measuring", async () => {
    await toCalibration();
    await click(t("common.next"));
    expect(heading(t("onboarding.targetTitle"))).toBeInTheDocument();
  });

  it("makes Next the primary once there is a measure", async () => {
    await toCalibration();
    await measure(150);
    expect(primaries()).toEqual([nextButton()]);
  });
});

describe("the rail during setup", () => {
  const current = () =>
    rail()
      .getAllByRole("button")
      .filter((button) => button.hasAttribute("aria-current"));

  it("marks no page as current and asks for no goals", async () => {
    await bootFresh();
    expect(current()).toHaveLength(0);
    expect(rail().queryByText(t("home.noGoals"))).toBeNull();
  });

  it("marks a page again if someone leaves setup for it after the safety step", async () => {
    await toMicStep();
    fireEvent.click(rail().getByRole("button", { name: t("nav.settings") }));
    expect(current().map((button) => button.textContent)).toEqual([
      t("nav.settings"),
    ]);
  });

  it("goes back to normal once setup is done", async () => {
    await bootFresh();
    for (const name of ["common.next", "common.next"] as const)
      await click(t(name));
    for (let step = 0; step < 3; step++) await click(t("common.skip"));
    await click(t("onboarding.saveContinue"));
    expect(current().map((button) => button.textContent)).toEqual([
      t("nav.home"),
    ]);
  });
});

describe("the welcome step", () => {
  it("opens on the app's own night: bunny and moon, drawn, hidden from screen readers", async () => {
    await bootFresh();
    const night = stage().getByTestId("welcome-night");
    expect(night).toHaveAttribute("aria-hidden", "true");
    expect(within(night).getByTestId("bunny")).toBeInTheDocument();
    expect(night.querySelector(".moon")).not.toBeNull();
  });
});
