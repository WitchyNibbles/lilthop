// Boots the real app against the fake backend and drives it the way a person would.
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect } from "vitest";
import { App } from "../App";
import type { NewResult, PitchFrame } from "../domain/contract";
import { backend } from "./fakeBackend";

export const rail = () => within(screen.getByRole("complementary"));
export const stage = () => within(screen.getByRole("main"));

export async function boot(): Promise<void> {
  render(<App />);
  await waitFor(() => expect(backend.listening("pitch")).toBe(true));
  await act(async () => {
    await Promise.resolve();
  });
}

export function goTo(name: string): void {
  fireEvent.click(rail().getByRole("button", { name }));
}

export async function clickAndSettle(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
  });
}

export async function startMic(): Promise<void> {
  await clickAndSettle(screen.getByRole("button", { name: "Start mic" }));
}

export function pickExercise(id: string): void {
  fireEvent.change(stage().getByRole("combobox"), { target: { value: id } });
}

export function play(frames: readonly PitchFrame[]): void {
  act(() => {
    for (const frame of frames) backend.emit("pitch", frame);
  });
}

export async function openPractice(id: string): Promise<void> {
  await boot();
  goTo("Practice");
  await startMic();
  pickExercise(id);
}

export function startSession(): void {
  fireEvent.click(stage().getByRole("button", { name: "Start session" }));
}

export async function finishSession(): Promise<void> {
  await clickAndSettle(
    stage().getByRole("button", { name: "Finish and save" }),
  );
}

function carriesResult(args: unknown): args is { result: NewResult } {
  return typeof args === "object" && args !== null && "result" in args;
}

export function lastSavedResult(): NewResult {
  const args = backend.lastCallTo("save_result")?.args;
  if (!carriesResult(args)) throw new Error("nothing was saved");
  return args.result;
}
