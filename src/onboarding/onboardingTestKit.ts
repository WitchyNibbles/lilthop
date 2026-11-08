// Boots the first-run flow and walks its steps, for the onboarding tests.
import { act } from "@testing-library/react";
import type { Profile } from "../domain/contract";
import { stream, voiced } from "../domain/testFrames";
import { translator } from "../i18n";
import { boot, clickAndSettle, play, stage } from "../test/driveApp";
import { backend } from "../test/fakeBackend";

export const t = translator("en");

function carriesProfile(args: unknown): args is { profile: Profile } {
  return typeof args === "object" && args !== null && "profile" in args;
}

export function savedProfile(): Profile {
  const args = backend.lastCallTo("set_profile")?.args;
  if (!carriesProfile(args)) throw new Error("no profile was saved");
  return args.profile;
}

export const click = (name: string) =>
  clickAndSettle(stage().getByRole("button", { name }));
export const heading = (name: string) => stage().getByRole("heading", { name });

export async function bootFresh() {
  backend.respond("get_profile", null);
  await boot();
}

export async function toMicStep() {
  await bootFresh();
  await click(t("common.next"));
  await click(t("common.next"));
}

export async function toCalibration() {
  await toMicStep();
  await click(t("common.next"));
}

export async function measure(hz: number) {
  await click(t("home.startMic"));
  await click(t("calibration.start"));
  play(stream(10.5, () => voiced(hz, 1900)));
  await act(async () => {
    await Promise.resolve();
  });
}
