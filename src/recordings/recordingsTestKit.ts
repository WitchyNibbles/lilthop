// Boots the app on Recordings and drives a take, for the recording tests.
import { act, screen } from "@testing-library/react";
import { translator } from "../i18n";
import { boot, clickAndSettle, goTo, stage } from "../test/driveApp";
import { backend, recording } from "../test/fakeBackend";

export const t = translator("en");

export async function open(items = [recording()]) {
  backend.respond("list_recordings", items);
  await boot();
  goTo("Recordings");
  await act(async () => {
    await Promise.resolve();
  });
}

export const record = () =>
  clickAndSettle(stage().getByRole("button", { name: t("recordings.record") }));

export const stopRecording = () =>
  clickAndSettle(
    stage().getByRole("button", { name: t("recordings.stopRecording") }),
  );

export const visibleText = (text: string) =>
  screen
    .queryAllByText(text)
    .filter((line) => !line.classList.contains("sr-only"));
