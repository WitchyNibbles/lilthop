import { act, fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { stream, voiced } from "../domain/testFrames";
import { boot, play, rail, stage } from "../test/driveApp";
import { backend, PROFILE } from "../test/fakeBackend";
import {
  bootFresh,
  click,
  heading,
  measure,
  savedProfile,
  t,
  toCalibration,
  toMicStep,
} from "./onboardingTestKit";

describe("the safety step", () => {
  it("comes first, and says S1, S2, S3, S5, S6 and S9 together", async () => {
    await bootFresh();
    await click(t("common.next"));
    expect(heading(t("safety.beforeTitle"))).toBeInTheDocument();
    const lines = [
      "safety.s1",
      "safety.s2",
      "safety.s3",
      "safety.s5",
      "safety.s6",
      "safety.s9",
    ] as const;
    for (const key of lines)
      expect(stage().getByText(t(key))).toBeInTheDocument();
  });

  it("leads with the Safety page's two headings, stop first", async () => {
    await bootFresh();
    await click(t("common.next"));
    const stop = heading(t("safety.stopTitle"));
    const doctor = heading(t("safety.doctorTitle"));
    expect(stop.closest(".safety-first")).toBe(doctor.closest(".safety-first"));
    const stopped = stop.closest("section");
    expect(stopped).toHaveTextContent(t("safety.s9"));
    expect(doctor.closest("section")).toHaveTextContent(t("safety.s5"));
  });

  it("holds the actual stop signs, after the line that pain means stop", async () => {
    await bootFresh();
    await click(t("common.next"));
    const lines = heading(t("safety.stopTitle"))
      .closest("section")
      ?.querySelectorAll("p");
    expect(lines?.[0]).toHaveTextContent(t("safety.s9"));
    expect(lines?.[1]).toHaveTextContent(t("safety.s4"));
  });
});

describe("the safety step's way out", () => {
  it("has no Skip: Next is the only way past it", async () => {
    await bootFresh();
    await click(t("common.next"));
    expect(
      stage().queryByRole("button", { name: t("common.skip") }),
    ).toBeNull();
    expect(
      stage().getByRole("button", { name: t("common.next") }),
    ).toBeInTheDocument();
  });
});

describe("moving between steps", () => {
  it("puts focus on the new step's heading", async () => {
    await bootFresh();
    await click(t("common.next"));
    expect(heading(t("safety.beforeTitle"))).toHaveFocus();
  });
});

describe("the mic check", () => {
  it("offers the device list and remembers the pick", async () => {
    await toMicStep();
    expect(heading(t("onboarding.micTitle"))).toBeInTheDocument();
    fireEvent.change(stage().getByLabelText(t("settings.inputDevice")), {
      target: { value: "Headset" },
    });
    await click(t("home.startMic"));
    expect(backend.lastCallTo("start_pitch")?.args).toEqual({
      deviceName: "Headset",
    });
  });

  it("lets someone through when the mic fails", async () => {
    backend.fail("start_pitch", { kind: "stream_failed", message: "no mic" });
    await toMicStep();
    await click(t("home.startMic"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      t("error.stream_failed"),
    );
    await click(t("common.skip"));
    await click(t("common.skip"));
    await click(t("common.skip"));
    await click(t("onboarding.saveContinue"));
    expect(savedProfile()).toMatchObject({
      onboarded: true,
      baselineHz: 0,
      targetMinHz: 0,
      targetMaxHz: 0,
      goals: [],
    });
  });
});

describe("calibration", () => {
  it("shows what was measured, in words and numbers", async () => {
    await toCalibration();
    await measure(182);
    expect(stage().getByText("182 Hz")).toBeInTheDocument();
    expect(stage().getByText("1900 Hz")).toBeInTheDocument();
  });

  it("asks for a little more when there is not enough voice yet", async () => {
    await toCalibration();
    await click(t("home.startMic"));
    await click(t("calibration.start"));
    play(stream(2, () => voiced(182, 1900)));
    await click(t("onboarding.finishBaseline"));
    expect(stage().getByText(t("settings.collectMore"))).toBeInTheDocument();
  });

  it("can be measured again", async () => {
    await toCalibration();
    await measure(182);
    await click(t("calibration.again"));
    await click(t("calibration.start"));
    play(stream(10.5, () => voiced(200, 1900)));
    await act(async () => {
      await Promise.resolve();
    });
    expect(stage().getByText("200 Hz")).toBeInTheDocument();
  });
});

describe("the range", () => {
  async function toRange(hz = 180) {
    await toCalibration();
    await measure(hz);
    await click(t("common.next"));
  }

  const shownRange = () => [
    stage().getByLabelText(t("common.minHz")),
    stage().getByLabelText(t("common.maxHz")),
  ];

  it("starts from the suggested range for the measured baseline", async () => {
    await toRange(180);
    const [min, max] = shownRange();
    expect(min).toHaveValue(175);
    expect(max).toHaveValue(220);
  });

  it("starts a little above a lower baseline, and says so", async () => {
    await toRange(120);
    const [min, max] = shownRange();
    expect(min).toHaveValue(127);
    expect(max).toHaveValue(160);
    expect(stage().getByText(t("onboarding.rangeHelp"))).toBeInTheDocument();
  });

  it("sits around a baseline that is already high, and says so", async () => {
    await toRange(200);
    const [min, max] = shownRange();
    expect(min).toHaveValue(178);
    expect(max).toHaveValue(238);
    expect(
      stage().getByText(t("onboarding.rangeHelpAround")),
    ).toBeInTheDocument();
    expect(stage().queryByText(t("onboarding.rangeHelp"))).toBeNull();
  });

  it("keeps where the numbers come from folded away until asked", async () => {
    await toRange();
    const summary = stage().getByText(t("range.sourcesTitle"));
    const details = summary.closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent(t("range.sources"));
  });

  it("shows S11 and S12 and has no direction picker", async () => {
    await toRange();
    expect(stage().getByText(t("safety.s11"))).toBeInTheDocument();
    expect(
      stage().getByText(
        "Your goals are yours: how high, at what pace, or staying as you are. They can change over time.",
      ),
    ).toBeInTheDocument();
    expect(stage().queryByRole("combobox")).toBeNull();
    expect(stage().queryByRole("radio")).toBeNull();
  });

  it("will not go on with a range that makes no sense, and says why", async () => {
    await toRange();
    fireEvent.change(stage().getByLabelText(t("common.minHz")), {
      target: { value: "300" },
    });
    fireEvent.change(stage().getByLabelText(t("common.maxHz")), {
      target: { value: "200" },
    });
    await click(t("common.next"));
    expect(stage().getByText(t("range.invalid"))).toBeInTheDocument();
    expect(heading(t("onboarding.targetTitle"))).toBeInTheDocument();
  });

  it("can go back to measure again", async () => {
    await toRange();
    await click(t("common.back"));
    expect(heading(t("onboarding.baselineTitle"))).toBeInTheDocument();
  });
});

describe("saving", () => {
  it("saves the values just measured, not the old ones", async () => {
    backend.respond("get_profile", {
      ...PROFILE,
      onboarded: false,
      baselineHz: 130,
      baselineCentroid: 1500,
      goals: [],
      pitchEngine: 1,
    });
    await boot();
    await click(t("common.next"));
    await click(t("common.next"));
    await click(t("common.next"));
    await measure(180);
    await click(t("common.next"));
    fireEvent.change(stage().getByLabelText(t("common.minHz")), {
      target: { value: "170" },
    });
    fireEvent.change(stage().getByLabelText(t("common.maxHz")), {
      target: { value: "210" },
    });
    await click(t("common.next"));
    fireEvent.click(stage().getByRole("checkbox", { name: t("goal.pitch") }));
    await click(t("onboarding.saveContinue"));
    const saved = savedProfile();
    expect(saved.baselineHz).toBeCloseTo(180, 0);
    expect(saved.baselineCentroid).toBeCloseTo(1900, 0);
    expect(saved.baselineRms).toBeGreaterThan(0);
    expect(saved).toMatchObject({
      targetMinHz: 170,
      targetMaxHz: 210,
      goals: ["pitch"],
      onboarded: true,
      pitchEngine: 2,
    });
  });

  it("starts the range from a new measure, even after typing one", async () => {
    await toCalibration();
    await measure(180);
    await click(t("common.next"));
    fireEvent.change(stage().getByLabelText(t("common.minHz")), {
      target: { value: "100" },
    });
    await click(t("common.back"));
    await click(t("calibration.again"));
    await click(t("calibration.start"));
    play(stream(10.5, () => voiced(220, 1900)));
    await click(t("common.next"));
    expect(stage().getByLabelText(t("common.minHz"))).toHaveValue(196);
    expect(stage().getByLabelText(t("common.maxHz"))).toHaveValue(262);
  });

  it("lands on Home with the mic off afterwards", async () => {
    await toCalibration();
    await measure(180);
    await click(t("common.next"));
    await click(t("common.next"));
    await click(t("onboarding.saveContinue"));
    expect(stage().queryByText(t("onboarding.saveContinue"))).toBeNull();
    expect(
      within(screen.getByRole("complementary")).getByText(t("reading.micOff")),
    ).toBeInTheDocument();
  });

  it("shows a real error when saving fails, and can try again", async () => {
    await bootFresh();
    await click(t("common.next"));
    await click(t("common.next"));
    await click(t("common.skip"));
    await click(t("common.skip"));
    await click(t("common.skip"));
    backend.fail("set_profile", { kind: "database", message: "disk full" });
    await click(t("onboarding.saveContinue"));
    expect(stage().getByText(t("error.database"))).toBeInTheDocument();
    backend.respond("set_profile", undefined);
    await click(t("onboarding.saveContinue"));
    expect(stage().queryByText(t("onboarding.saveContinue"))).toBeNull();
  });
});

it("keeps the rail available during onboarding", async () => {
  await bootFresh();
  expect(rail().getByRole("button", { name: "Settings" })).toBeInTheDocument();
});
