import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { stream, voiced } from "../domain/testFrames";
import { translator } from "../i18n";
import { boot, clickAndSettle, goTo, play, stage } from "../test/driveApp";
import { backend, PROFILE } from "../test/fakeBackend";

const t = translator("en");
const click = (name: string) =>
  clickAndSettle(stage().getByRole("button", { name }));

describe("what was measured", () => {
  it("sets the level and brightness numbers in their place", async () => {
    backend.respond("get_profile", { ...PROFILE, pitchEngine: 1 });
    await boot();
    await click(t("calibration.again"));
    await click(t("home.startMic"));
    await click(t("calibration.start"));
    play(stream(10.5, () => voiced(190, 2100)));
    await act(async () => {
      await Promise.resolve();
    });
    expect(stage().getByText(t("safety.s13"))).toBeInTheDocument();
    expect(stage().getByText(t("safety.s14"))).toBeInTheDocument();
  });
});

describe("the invitation for old measurements", () => {
  it("is not shown to someone already on the new engine", async () => {
    await boot();
    expect(screen.queryByText(t("recalibrate.invite"))).toBeNull();
  });

  it("appears once, and Not now settles it", async () => {
    backend.respond("get_profile", { ...PROFILE, pitchEngine: 1 });
    await boot();
    expect(stage().getByText(t("recalibrate.invite"))).toBeInTheDocument();
    await click(t("recalibrate.notNow"));
    expect(screen.queryByText(t("recalibrate.invite"))).toBeNull();
    expect(backend.lastCallTo("set_profile")?.args).toEqual({
      profile: { ...PROFILE, pitchEngine: 2 },
    });
  });

  it("leads to measuring, and saves the new numbers with engine 2", async () => {
    backend.respond("get_profile", { ...PROFILE, pitchEngine: 1 });
    await boot();
    await click(t("calibration.again"));
    await click(t("home.startMic"));
    await click(t("calibration.start"));
    play(stream(10.5, () => voiced(190, 2100)));
    await act(async () => {
      await Promise.resolve();
    });
    await click(t("recalibrate.save"));
    expect(stage().getByText(t("recalibrate.saved"))).toBeInTheDocument();
    expect(backend.lastCallTo("set_profile")?.args).toMatchObject({
      profile: {
        baselineCentroid: 2100,
        targetMinHz: PROFILE.targetMinHz,
        pitchEngine: 2,
      },
    });
  });
});

describe("the suggested range after a new measure", () => {
  async function measureAgainAt(hz: number) {
    await boot();
    goTo("Settings");
    await click(t("settings.calibrate"));
    await click(t("home.startMic"));
    await click(t("calibration.start"));
    play(stream(10.5, () => voiced(hz, 2100)));
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("shows the range the rule gives for the new baseline", async () => {
    await measureAgainAt(190);
    expect(
      stage().getByText(t("recalibrate.suggested", { min: 175, max: 226 })),
    ).toBeInTheDocument();
  });

  it("leaves the saved range alone when only the numbers are saved", async () => {
    await measureAgainAt(190);
    await click(t("recalibrate.save"));
    expect(backend.lastCallTo("set_profile")?.args).toMatchObject({
      profile: {
        targetMinHz: PROFILE.targetMinHz,
        targetMaxHz: PROFILE.targetMaxHz,
      },
    });
  });

  it("saves the new baseline and the suggested range when asked to", async () => {
    await measureAgainAt(190);
    await click(t("recalibrate.useSuggested"));
    const saved = backend.lastCallTo("set_profile")?.args;
    expect(saved).toMatchObject({
      profile: {
        baselineCentroid: 2100,
        targetMinHz: 175,
        targetMaxHz: 226,
        pitchEngine: 2,
      },
    });
  });
});

describe("recalibrating from Settings", () => {
  it("gets there and back", async () => {
    await boot();
    goTo("Settings");
    await click(t("settings.calibrate"));
    expect(
      stage().getByRole("heading", { name: t("onboarding.baselineTitle") }),
    ).toBeInTheDocument();
    await click(t("recalibrate.backToSettings"));
    expect(
      stage().getByRole("heading", { name: t("settings.title") }),
    ).toBeInTheDocument();
  });
});

describe("measuring from Settings before onboarding is done", () => {
  it("still saves, with no profile to start from", async () => {
    backend.respond("get_profile", null);
    await boot();
    await click(t("common.next"));
    await click(t("common.next"));
    goTo("Settings");
    await click(t("settings.calibrate"));
    await click(t("home.startMic"));
    await click(t("calibration.start"));
    play(stream(10.5, () => voiced(182, 1900)));
    await click(t("recalibrate.save"));
    expect(stage().getByText(t("recalibrate.saved"))).toBeInTheDocument();
    expect(backend.lastCallTo("set_profile")?.args).toMatchObject({
      profile: { onboarded: false, pitchEngine: 2 },
    });
  });
});
