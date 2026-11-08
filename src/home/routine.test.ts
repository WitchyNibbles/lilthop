import { FIRST_EXERCISE } from "../domain/exercises";
import { describe, expect, it } from "vitest";
import { savedResult } from "../test/fakeBackend";
import { moonPhaseToday, todaysRoutine } from "./routine";

const AFTERNOON = new Date(2026, 10, 6, 14, 0);
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

describe("todaysRoutine", () => {
  it("is the day's plan with nothing done", () => {
    const routine = todaysRoutine(["pitch", "stability"], [], AFTERNOON);
    expect(routine.items.map((item) => item.exercise.id)).toEqual([
      "pitch_awareness",
      "pitch_raising",
      "sustained_tone",
    ]);
    expect(routine.items.some((item) => item.done)).toBe(false);
    expect(routine.next?.id).toBe("pitch_awareness");
  });

  it("ticks only what was done today", () => {
    const today = savedResult({
      exerciseId: "pitch_awareness",
      createdAt: seconds(new Date(2026, 10, 6, 8, 0)),
    });
    const yesterday = savedResult({
      exerciseId: "sustained_tone",
      createdAt: seconds(new Date(2026, 10, 5, 23, 0)),
    });
    const routine = todaysRoutine(
      ["pitch", "stability"],
      [today, yesterday],
      AFTERNOON,
    );
    expect(routine.items.map((item) => item.done)).toEqual([
      true,
      false,
      false,
    ]);
    expect(routine.next?.id).toBe("pitch_raising");
  });

  it("has nothing next when all is done", () => {
    const done = ["pitch_awareness", "pitch_raising"].map((exerciseId) =>
      savedResult({ exerciseId, createdAt: seconds(AFTERNOON) }),
    );
    expect(todaysRoutine(["pitch"], done, AFTERNOON).next).toBeNull();
  });

  it("is empty with no goals", () => {
    expect(todaysRoutine([], [], AFTERNOON)).toEqual({ items: [], next: null });
  });
});

describe("moonPhaseToday", () => {
  const item = (done: boolean) => ({ exercise: FIRST_EXERCISE, done });
  const routine = (...done: boolean[]) => ({
    items: done.map(item),
    next: null,
  });

  it("waxes by the share of the routine done", () => {
    expect(moonPhaseToday(routine(true, false, false, false), true)).toBe(0.25);
    expect(moonPhaseToday(routine(true, true), true)).toBe(1);
  });

  it("is new before anything happened", () => {
    expect(moonPhaseToday(routine(false, false), false)).toBe(0);
  });

  it("shows a sliver for practice outside the routine", () => {
    const phase = moonPhaseToday(routine(false, false), true);
    expect(phase).toBeGreaterThan(0);
    expect(phase).toBeLessThan(0.25);
  });

  it("is full on a practised day with no routine to measure against", () => {
    expect(moonPhaseToday(routine(), true)).toBe(1);
    expect(moonPhaseToday(routine(), false)).toBe(0);
  });
});
