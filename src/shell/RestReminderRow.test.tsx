import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PitchFrame } from "../domain/contract";
import { voiced } from "../domain/testFrames";
import { translator } from "../i18n";
import { boot, goTo, play, startMic } from "../test/driveApp";

const t = translator("en");
const MINUTE_MS = 60_000;
const HOP_MS = 100;

/** Coarser than real frames: the reminder only counts time. */
function talk(fromMs: number, toMs: number): PitchFrame[] {
  return Array.from({ length: (toMs - fromMs) / HOP_MS }, (_, i) => ({
    tMs: fromMs + i * HOP_MS,
    ...voiced(200),
  }));
}

const reminder = () => screen.queryAllByText(t("safety.s7"));

async function talkUntilDue(screenName: string) {
  await boot();
  await startMic();
  goTo(screenName);
  play(talk(0, 15 * MINUTE_MS + 1_000));
}

describe("a rest reminder that comes due away from Practice", () => {
  it.each(["Home", "Progress", "Recordings", "Settings"])(
    "shows in the alert row on %s",
    async (name) => {
      await talkUntilDue(name);
      expect(reminder()).toHaveLength(1);
    },
  );

  it("goes after its ten seconds, and that counts as shown", async () => {
    await talkUntilDue("Home");
    play(talk(15 * MINUTE_MS + 1_000, 15 * MINUTE_MS + 13_000));
    expect(reminder()).toHaveLength(0);
    goTo("Practice");
    play(talk(15 * MINUTE_MS + 13_000, 15 * MINUTE_MS + 20_000));
    expect(reminder()).toHaveLength(0);
  });

  it("says it once on Practice, in the strip", async () => {
    await talkUntilDue("Practice");
    expect(reminder()).toHaveLength(1);
    expect(screen.getByTestId("notice-slot")).toHaveTextContent(t("safety.s7"));
  });
});
