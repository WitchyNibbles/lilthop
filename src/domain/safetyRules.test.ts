import { describe, expect, it } from "vitest";
import { MESSAGES } from "../i18n";
import { NOTICE_MESSAGE } from "./safety";
import { firstShown, noticesSeen, run, speak } from "./safetyTestKit";
import {
  concat,
  endMs,
  shiftedHz,
  silent,
  steadyHz,
  stream,
  voiced,
} from "./testFrames";

describe("louder than you started", () => {
  it("fires after 2 s at more than twice the starting level, not before", () => {
    const frames = concat(speak(10, 0.05), speak(4, 0.12, 10_000));
    const shown = run(frames);
    const at = firstShown(shown, "louder");
    expect(at).toBeDefined();
    expect(at ?? 0).toBeGreaterThan(12_000 - 60);
    expect(at ?? 0).toBeLessThan(12_200);
  });

  it("does not fire at 1.9 times the starting level", () => {
    const frames = concat(speak(10, 0.05), speak(6, 0.095, 10_000));
    expect(noticesSeen(run(frames)).size).toBe(0);
  });

  it("does not fire for a louder moment shorter than 2 s", () => {
    const frames = concat(
      speak(10, 0.05),
      speak(1.5, 0.15, 10_000),
      speak(5, 0.05, 11_500),
    );
    expect(noticesSeen(run(frames)).size).toBe(0);
  });

  it("says nothing before it has 10 voiced seconds to compare with", () => {
    const frames = concat(speak(5, 0.02), speak(4, 0.2, 5000));
    expect(noticesSeen(run(frames)).size).toBe(0);
  });

  it("compares with the start of this session, not a fixed level: a loud start is its own baseline", () => {
    expect(noticesSeen(run(speak(20, 0.3))).size).toBe(0);
  });

  it("takes the median of the first 10 s, so a few loud moments in it do not move the baseline", () => {
    const start = concat(
      speak(4, 0.05),
      speak(1, 0.5, 4000),
      speak(5, 0.05, 5000),
    );
    const frames = concat(start, speak(4, 0.12, endMs(start)));
    expect(noticesSeen(run(frames))).toEqual(new Set(["louder"]));
  });

  it("a short pause in the middle of loud speech does not restart the 2 s", () => {
    const base = speak(10, 0.05);
    const loud1 = speak(1.2, 0.12, endMs(base));
    const pause = silent(0.3, endMs(loud1));
    const loud2 = speak(1.2, 0.12, endMs(pause));
    expect(noticesSeen(run(concat(base, loud1, pause, loud2)))).toEqual(
      new Set(["louder"]),
    );
  });

  it("a long silence in the middle does restart it", () => {
    const base = speak(10, 0.05);
    const loud1 = speak(1.5, 0.12, endMs(base));
    const pause = silent(1, endMs(loud1));
    const loud2 = speak(1.5, 0.12, endMs(pause));
    expect(noticesSeen(run(concat(base, loud1, pause, loud2))).size).toBe(0);
  });
});

describe("above your range", () => {
  it("fires after 5 s over the top of the range, not at 4.5 s", () => {
    const shown = run(steadyHz(8, 300));
    const at = firstShown(shown, "aboveRange") ?? 0;
    expect(at).toBeGreaterThan(5000 - 100);
    expect(at).toBeLessThan(5300);
  });

  it("never fires for a pitch inside the range", () => {
    expect(noticesSeen(run(steadyHz(20, 250))).size).toBe(0);
  });

  it("is restarted by coming back into the range", () => {
    const frames = concat(
      steadyHz(4, 300),
      steadyHz(0.5, 240, 4000),
      steadyHz(4, 300, 4500),
    );
    expect(noticesSeen(run(frames)).size).toBe(0);
  });

  it("is restarted by more than half a second of silence", () => {
    const first = steadyHz(4, 300);
    const gap = silent(0.8, endMs(first));
    const frames = concat(first, gap, steadyHz(4, 300, endMs(gap)));
    expect(noticesSeen(run(frames)).size).toBe(0);
  });

  it("uses the range it was given", () => {
    expect(noticesSeen(run(steadyHz(8, 300), { targetMaxHz: 400 })).size).toBe(
      0,
    );
  });

  it("a single octave-error frame does not count as a high pitch", () => {
    const frames = stream(10, (t) =>
      voiced(Math.abs(t - 5) < 0.01 ? 600 : 200),
    );
    expect(noticesSeen(run(frames)).size).toBe(0);
  });
});

describe("voice break after 15 minutes", () => {
  const MIN = 60_000;
  const sound = (minutes: number, startMs = 0) =>
    Array.from({ length: Math.floor((minutes * MIN) / 100) }, (_, i) => ({
      tMs: startMs + i * 100,
      ...voiced(200),
    }));

  it("fires at 15 minutes of practice in one sitting, not at 14", () => {
    const shown = run(sound(16));
    const at = firstShown(shown, "restBreak") ?? 0;
    expect(at).toBeGreaterThanOrEqual(15 * MIN);
    expect(at).toBeLessThan(15 * MIN + 1000);
  });

  it("goes away again and comes back after another 15 minutes", () => {
    const shown = run(sound(31));
    const at = shown.filter(
      (s) => s.notice === "restBreak" && s.tMs > 20 * MIN,
    );
    expect(at[0]?.tMs ?? 0).toBeGreaterThanOrEqual(30 * MIN);
    const between = shown.filter((s) => s.tMs > 16 * MIN && s.tMs < 29 * MIN);
    expect(between.every((s) => s.notice === null)).toBe(true);
  });

  it("stays up for about ten seconds, long enough to read at a glance", () => {
    const shown = run(sound(16)).filter((s) => s.notice === "restBreak");
    const lastMs = shown.slice(-1)[0]?.tMs ?? 0;
    expect(lastMs - 15 * MIN).toBeGreaterThanOrEqual(9_000);
    expect(lastMs - 15 * MIN).toBeLessThan(12_000);
  });

  it("a late reminder keeps the 15-minute beat", () => {
    const before = sound(14.9);
    const after = sound(16, 15.2 * MIN);
    const shown = run(concat(before, after));
    expect(firstShown(shown, "restBreak")).toBeLessThan(15.2 * MIN + 1000);
    const next = shown.filter(
      (s) => s.notice === "restBreak" && s.tMs > 20 * MIN,
    );
    expect(next[0]?.tMs ?? 0).toBeGreaterThanOrEqual(30 * MIN);
    expect(next[0]?.tMs ?? 0).toBeLessThan(30 * MIN + 1000);
  });

  it("a rest of 5 minutes or more starts a new sitting", () => {
    const first = sound(10);
    const rest = silent(6 * 60, endMs(first));
    const frames = concat(
      first,
      rest.filter((_, i) => i % 50 === 0),
      sound(10, endMs(rest) + 1000),
    );
    expect(noticesSeen(run(frames)).size).toBe(0);
  });

  it("a rest also forgets a reminder that was still waiting its turn", () => {
    const clipped = (minutes: number, startMs: number) =>
      sound(minutes, startMs).map((frame) => ({ ...frame, peak: 1 }));
    const heldBack = concat(sound(14.9), clipped(0.2, 14.9 * MIN));
    const backAfterRest = 21 * MIN;
    const dueAgainMs = backAfterRest + 15 * MIN;
    const shown = run(
      concat(
        heldBack,
        sound(14.9, backAfterRest),
        clipped(1, dueAgainMs - 0.1 * MIN),
      ),
    );
    expect(firstShown(shown, "restBreak")).toBeGreaterThanOrEqual(
      dueAgainMs + 29_000,
    );
  });

  it("counts time with sound only: an idle mic is not practice", () => {
    expect(noticesSeen(run(silent(16 * 60))).size).toBe(0);
  });

  it("is reminder text, with no limit in it", () => {
    expect(MESSAGES.en[NOTICE_MESSAGE.restBreak]).toBe(
      "Time for a voice break. Have some water and let your voice rest for a bit.",
    );
  });
});

describe("sudden pitch jump", () => {
  it("fires on a real jump of 7 semitones in the middle of speaking", () => {
    const frames = concat(
      steadyHz(1, 200),
      steadyHz(1, shiftedHz(200, 7), 1000),
    );
    expect(noticesSeen(run(frames))).toEqual(new Set(["pitchJump"]));
  });

  it("never fires when the voice simply stops", () => {
    const voice = steadyHz(2, 200);
    const frames = concat(voice, silent(5, endMs(voice)));
    expect(noticesSeen(run(frames)).size).toBe(0);
  });

  it("never fires when the voice starts again after silence, at any pitch", () => {
    const first = steadyHz(1, 200);
    const gap = silent(1, endMs(first));
    const frames = concat(first, gap, steadyHz(1, 450, endMs(gap)));
    expect(noticesSeen(run(frames)).size).toBe(0);
  });

  it("does not fire for a one-octave glide over a second", () => {
    const frames = stream(1.5, (t) => voiced(shiftedHz(150, 12 * t)));
    expect(noticesSeen(run(frames)).size).toBe(0);
  });

  it("does not fire for a one-frame slip", () => {
    const frames = stream(2, (t) => voiced(Math.abs(t - 1) < 0.01 ? 400 : 200));
    expect(noticesSeen(run(frames)).size).toBe(0);
  });

  it("does not fire for a step of 3 semitones", () => {
    const frames = concat(
      steadyHz(1, 200),
      steadyHz(1, shiftedHz(200, 3), 1000),
    );
    expect(noticesSeen(run(frames)).size).toBe(0);
  });
});
