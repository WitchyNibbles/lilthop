import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { speak } from "../domain/safetyTestKit";
import { concat, stream, voiced } from "../domain/testFrames";
import { translator } from "../i18n";
import { openPractice, play, stage } from "../test/driveApp";
import { backend } from "../test/fakeBackend";

const t = translator("en");
const slot = () => stage().getByTestId("notice-slot");

const failWrite = () =>
  act(() => {
    backend.emit("audio-error", { kind: "write_failed", message: "full" });
  });

const dismiss = () =>
  act(() => {
    screen.getByRole("button", { name: t("alert.dismiss") }).click();
  });

const aboveRange = () => play(stream(6, () => voiced(300)));

describe("an alert in the strip", () => {
  it("goes before a neutral notice, with no time limit on the notice", async () => {
    await openPractice("pitch_awareness");
    aboveRange();
    expect(slot()).toHaveAttribute("data-notice", "aboveRange");
    failWrite();
    expect(screen.getByRole("alert")).toHaveTextContent(
      t("error.write_failed"),
    );
    expect(slot()).not.toHaveAttribute("data-notice");
    expect(stage().queryByText(t("notice.aboveRange"))).toBeNull();
  });

  it("gives the strip back to the notice once dismissed", async () => {
    await openPractice("pitch_awareness");
    aboveRange();
    failWrite();
    dismiss();
    expect(slot()).toHaveAttribute("data-notice", "aboveRange");
    expect(stage().getByText(t("notice.aboveRange"))).toBeInTheDocument();
  });

  it("goes before a pitch jump too", async () => {
    await openPractice("pitch_awareness");
    const low = stream(0.3, () => voiced(200));
    play(low);
    failWrite();
    play(stream(0.1, () => voiced(300), 300));
    expect(slot()).not.toHaveAttribute("data-notice");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("still waits for louder", async () => {
    await openPractice("pitch_awareness");
    failWrite();
    play(concat(speak(10, 0.05), speak(4, 0.12, 10_000)));
    expect(slot()).toHaveAttribute("data-notice", "louder");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still waits for a rest reminder", async () => {
    await openPractice("pitch_awareness");
    failWrite();
    play(
      Array.from({ length: 9_020 }, (_, i) => ({
        tMs: i * 100,
        ...voiced(200),
      })),
    );
    expect(slot()).toHaveAttribute("data-notice", "restBreak");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("still waits for clipping", async () => {
    await openPractice("pitch_awareness");
    failWrite();
    play(stream(0.5, () => ({ ...voiced(200), peak: 1 })));
    expect(slot()).toHaveAttribute("data-notice", "clipping");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
