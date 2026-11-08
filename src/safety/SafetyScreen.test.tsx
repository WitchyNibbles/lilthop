import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { translator, type MessageKey } from "../i18n";
import { boot, goTo, stage } from "../test/driveApp";

const t = translator("en");

describe("the safety page", () => {
  it("opens from the stop signs and says everything it promises", async () => {
    await boot();
    goTo("Practice");
    fireEvent.click(stage().getByRole("button", { name: t("safety.s4") }));
    expect(
      stage().getByRole("heading", { name: t("safety.title") }),
    ).toBeInTheDocument();
    const keys = [
      "safety.s1",
      "safety.s2",
      "safety.s3",
      "safety.s4",
      "safety.s5",
      "safety.s6",
      "safety.s9",
      "safety.s10",
      "safety.s13",
      "safety.s14",
      "safety.s15",
      "safety.s16",
      "safety.s17",
      "safety.research",
    ] as const;
    for (const key of keys)
      expect(stage().getByText(t(key))).toBeInTheDocument();
  });

  it("puts raising gently and all day counts under training, and the changes to watch with the stop signs", async () => {
    await boot();
    goTo("Settings");
    fireEvent.click(
      stage().getByRole("button", { name: t("settings.readSafety") }),
    );
    const section = (title: MessageKey) =>
      stage()
        .getByRole("heading", { name: t(title) })
        .closest("section");
    const training = section("safety.trainingTitle");
    expect(training).toHaveTextContent(t("safety.s15"));
    expect(training).toHaveTextContent(t("safety.s17"));
    const stop = section("safety.stopTitle");
    expect(stop).toHaveTextContent(t("safety.s4"));
    expect(stop).toHaveTextContent(t("safety.s16"));
  });

  it("leads with stop and see a doctor, as headed sections", async () => {
    await boot();
    goTo("Settings");
    fireEvent.click(
      stage().getByRole("button", { name: t("settings.readSafety") }),
    );
    const headings = stage()
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings.slice(0, 2)).toEqual([
      t("safety.stopTitle"),
      t("safety.doctorTitle"),
    ]);
    expect(
      stage().getByText(t("safety.s4")).closest(".safety-first"),
    ).not.toBeNull();
    expect(
      stage().getByText(t("safety.s5")).closest(".safety-first"),
    ).not.toBeNull();
  });
});
