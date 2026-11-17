import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { endMs, steadyHz } from "../domain/testFrames";
import { translator } from "../i18n";
import {
  finishSession,
  goTo,
  lastSavedResult,
  openPractice,
  play,
  rail,
  stage,
  startSession,
} from "../test/driveApp";

const t = translator("en");

async function discardOn(id: string) {
  await openPractice(id);
  startSession();
  fireEvent.click(stage().getByRole("button", { name: t("exercise.discard") }));
  expect(stage().getByText(t("exercise.discarded"))).toBeInTheDocument();
}

describe("the discard note", () => {
  it("is gone once another exercise is opened from the routine", async () => {
    await discardOn("glides");
    fireEvent.click(rail().getByRole("button", { name: /Pitch awareness/ }));
    expect(
      stage().getByRole("heading", { name: "Pitch awareness" }),
    ).toBeInTheDocument();
    expect(stage().queryByText(t("exercise.discarded"))).toBeNull();
  });

  it("is gone after a look at another screen", async () => {
    await discardOn("glides");
    goTo("Home");
    goTo("Practice");
    expect(stage().queryByText(t("exercise.discarded"))).toBeNull();
  });
});

describe("a running session", () => {
  it("keeps running when another screen is opened and Practice again", async () => {
    await openPractice("pitch_awareness");
    startSession();
    const first = steadyHz(4, 200);
    play(first);
    goTo("Settings");
    goTo("Practice");
    expect(
      stage().getByRole("button", { name: t("exercise.discard") }),
    ).toBeEnabled();
    play(steadyHz(4, 200, endMs(first)));
    await finishSession();
    expect(lastSavedResult().voicedS).toBeCloseTo(8, 0);
  });
});
