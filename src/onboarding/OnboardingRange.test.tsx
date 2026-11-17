import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { stage } from "../test/driveApp";
import {
  click,
  heading,
  measure,
  savedProfile,
  t,
  toCalibration,
} from "./onboardingTestKit";

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

  it("keeps the suggested range when the range step is skipped", async () => {
    await toCalibration();
    await measure(130);
    await click(t("common.next"));
    const [min, max] = stage().getAllByRole<HTMLInputElement>("spinbutton");
    const suggested = {
      targetMinHz: Number(min?.value),
      targetMaxHz: Number(max?.value),
    };
    expect(suggested.targetMinHz).toBeGreaterThan(0);
    await click(t("common.skip"));
    await click(t("onboarding.saveContinue"));
    expect(savedProfile()).toMatchObject(suggested);
  });

  function typeRange(min: string, max: string) {
    fireEvent.change(stage().getByLabelText(t("common.minHz")), {
      target: { value: min },
    });
    fireEvent.change(stage().getByLabelText(t("common.maxHz")), {
      target: { value: max },
    });
  }

  it("saves a typed range when the range step is skipped", async () => {
    await toRange();
    typeRange("170", "210");
    await click(t("common.skip"));
    await click(t("onboarding.saveContinue"));
    expect(savedProfile()).toMatchObject({
      targetMinHz: 170,
      targetMaxHz: 210,
    });
  });

  it("saves no range when the typed one makes no sense and the step is skipped", async () => {
    await toRange();
    typeRange("300", "200");
    await click(t("common.skip"));
    await click(t("onboarding.saveContinue"));
    expect(savedProfile()).toMatchObject({ targetMinHz: 0, targetMaxHz: 0 });
  });
});
