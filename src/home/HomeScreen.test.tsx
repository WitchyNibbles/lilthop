import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { steadyHz } from "../domain/testFrames";
import { translator } from "../i18n";
import { backend, PROFILE, savedResult } from "../test/fakeBackend";
import {
  boot,
  finishSession,
  play,
  stage,
  startMic,
  startSession,
} from "../test/driveApp";

const t = translator("en");

function at(hour: number): void {
  vi.useFakeTimers({
    toFake: ["Date"],
    now: new Date(2026, 10, 6, hour, 30),
  });
}

afterEach(() => {
  vi.useRealTimers();
});

const moons = () => stage().getByRole("img", { name: /Days you practiced/ });

describe("Home", () => {
  it("greets by the time of day", async () => {
    at(9);
    await boot();
    expect(
      stage().getByRole("heading", { name: t("home.greetingMorning") }),
    ).toBeInTheDocument();
  });

  it("says good afternoon and good evening too", async () => {
    at(14);
    await boot();
    expect(stage().getByText(t("home.greetingAfternoon"))).toBeInTheDocument();
  });

  it("says good evening at night", async () => {
    at(21);
    await boot();
    expect(stage().getByText(t("home.greetingEvening"))).toBeInTheDocument();
  });

  it("draws 14 moons, a day off as a new moon", async () => {
    backend.respond("get_results", [
      savedResult({ createdAt: Math.floor(Date.now() / 1000) }),
      savedResult({ id: 2, createdAt: Math.floor(Date.now() / 1000) - 86_400 }),
    ]);
    await boot();
    expect(moons()).toHaveAccessibleName(
      t("progress.practiceDays", { days: 14, count: 2 }),
    );
    expect(
      moons().querySelectorAll('[data-moon="full"], [data-moon="waxing"]'),
    ).toHaveLength(2);
    expect(moons().querySelectorAll('[data-moon="new"]')).toHaveLength(12);
  });

  it("has no streak language", async () => {
    await boot();
    expect(screen.getByRole("main").textContent).not.toMatch(/streak|racha/i);
  });

  it("has one way to start: no second list of the plan", async () => {
    at(14);
    await boot();
    expect(stage().queryByRole("list")).toBeNull();
    expect(stage().queryByText(t("exercise.pitch_raising.name"))).toBeNull();
  });

  it("says how long the next step takes", async () => {
    at(14);
    await boot();
    expect(
      stage().getByText(t("home.duration", { minutes: 1 })),
    ).toBeInTheDocument();
  });

  it("offers the next exercise as the one primary action", async () => {
    at(14);
    await boot();
    const start = stage().getByRole("button", {
      name: t("home.startExercise", {
        name: t("exercise.pitch_awareness.name"),
      }),
    });
    expect(start).toHaveClass("btn-primary");
    expect(
      stage()
        .getAllByRole("button")
        .filter((b) => b.classList.contains("btn-primary")),
    ).toHaveLength(1);
    fireEvent.click(start);
    expect(
      stage().getByRole("heading", {
        name: t("exercise.pitch_awareness.name"),
      }),
    ).toBeInTheDocument();
  });

  it("moves on to what is left once something is done", async () => {
    at(14);
    backend.respond("get_profile", {
      ...PROFILE,
      goals: ["pitch", "stability"],
    });
    backend.respond("get_results", [
      savedResult({
        exerciseId: "pitch_awareness",
        createdAt: Math.floor(Date.now() / 1000),
      }),
    ]);
    await boot();
    expect(
      stage().getByRole("button", {
        name: t("home.startExercise", {
          name: t("exercise.pitch_raising.name"),
        }),
      }),
    ).toBeInTheDocument();
  });

  it("says the routine is done, and still leaves a way in", async () => {
    at(21);
    backend.respond(
      "get_results",
      ["pitch_awareness", "pitch_raising"].map((exerciseId, index) =>
        savedResult({
          id: index + 1,
          exerciseId,
          createdAt: Math.floor(Date.now() / 1000),
        }),
      ),
    );
    await boot();
    expect(stage().getByText(t("home.planDone"))).toBeInTheDocument();
    fireEvent.click(
      stage().getByRole("button", { name: t("home.openPractice") }),
    );
    expect(stage().getByRole("combobox")).toBeInTheDocument();
  });

  it("points to Settings when there are no goals", async () => {
    backend.respond("get_profile", { ...PROFILE, goals: [] });
    await boot();
    expect(stage().getByText(t("home.noGoals"))).toBeInTheDocument();
  });

  it("carries S8", async () => {
    await boot();
    expect(stage().getByText(t("safety.s8"))).toBeInTheDocument();
  });

  it("fills today's moon after a saved session", async () => {
    await boot();
    fireEvent.click(stage().getAllByRole("button")[0] ?? document.body);
    await startMic();
    startSession();
    play(steadyHz(10, 200));
    backend.respond("get_results", [
      savedResult({ createdAt: Math.floor(Date.now() / 1000) }),
    ]);
    await finishSession();
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    await waitFor(() =>
      expect(
        moons().querySelectorAll('[data-moon="full"], [data-moon="waxing"]'),
      ).toHaveLength(1),
    );
  });
});
