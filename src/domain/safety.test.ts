import { describe, expect, it } from "vitest";
import { MESSAGES } from "../i18n";
import { MIN_DISPLAY_MS, NOTICE_MESSAGE, NOTICE_PRIORITY } from "./safety";
import { firstShown, noticesSeen, run, speak } from "./safetyTestKit";
import { concat, endMs, silent, stream, voiced } from "./testFrames";

describe("clipping", () => {
  it("fires when a frame peaks at 0.99 or more", () => {
    const frames = stream(2, (t) => ({
      ...voiced(200),
      peak: t > 1 ? 0.995 : 0.3,
    }));
    const shown = run(frames);
    expect(noticesSeen(shown)).toEqual(new Set(["clipping"]));
    const at = firstShown(shown, "clipping") ?? 0;
    expect(at).toBeGreaterThan(1000);
    expect(at).toBeLessThan(1100);
  });

  it("does not fire at 0.98", () => {
    const frames = stream(2, () => ({ ...voiced(200), peak: 0.98 }));
    expect(noticesSeen(run(frames)).size).toBe(0);
  });

  it("is a mic notice: it fires on a hiss as well as on voice", () => {
    const frames = stream(1, () => ({
      f0: 0,
      rms: 0.4,
      peak: 1,
      centroid: 4000,
    }));
    expect(noticesSeen(run(frames))).toEqual(new Set(["clipping"]));
  });
});

describe("only one notice at a time, most important first", () => {
  it("the order is a constant that lists every notice once, clipping first", () => {
    expect([...NOTICE_PRIORITY].sort()).toEqual(
      ["aboveRange", "clipping", "louder", "pitchJump", "restBreak"].sort(),
    );
    expect(NOTICE_PRIORITY[0]).toBe("clipping");
  });

  it("every notice has text in both languages", () => {
    for (const id of NOTICE_PRIORITY) {
      expect(MESSAGES.en[NOTICE_MESSAGE[id]]).toBeTruthy();
      expect(MESSAGES.es[NOTICE_MESSAGE[id]]).toBeTruthy();
    }
  });

  it("with clipping, louder and above-range all true, clipping is shown", () => {
    const base = speak(10, 0.05, 0, 300);
    const both = stream(
      4,
      () => ({ ...voiced(300), rms: 0.12, peak: 1 }),
      endMs(base),
    );
    const shown = run(concat(base, both));
    const during = shown.filter((s) => s.tMs > endMs(base) + 2500);
    expect(during.length).toBeGreaterThan(10);
    expect(during.every((s) => s.notice === "clipping")).toBe(true);
  });

  it("when the top one ends, the next most important active one takes over", () => {
    const base = speak(10, 0.05);
    const loudAndClipping = stream(
      3,
      () => ({ ...voiced(200), rms: 0.12, peak: 1 }),
      endMs(base),
    );
    const loudOnly = speak(6, 0.12, endMs(loudAndClipping));
    const shown = run(concat(base, loudAndClipping, loudOnly));
    const order = shown
      .map((s) => s.notice)
      .filter((n, i, all) => n !== null && n !== all[i - 1]);
    expect(order).toEqual(["clipping", "louder"]);
  });

  it("louder outranks above-range when both become due on the same frame", () => {
    const base = speak(10, 0.05, 0, 250);
    const high = speak(3, 0.05, endMs(base), 270);
    const highAndLoud = speak(4, 0.12, endMs(high), 270);
    const shown = run(concat(base, high, highAndLoud));
    const firstNotice = shown.find((s) => s.notice !== null);
    expect(firstNotice?.notice).toBe("louder");
    expect(noticesSeen(shown)).toEqual(new Set(["louder"]));
  });
});

describe("no flicker", () => {
  const clip = (on: boolean) => ({ ...voiced(200), peak: on ? 1 : 0.2 });

  it("a notice stays for at least 3 s after a single frame", () => {
    const frames = stream(8, (t) => clip(t > 1 && t < 1.03));
    const shown = run(frames);
    const start = firstShown(shown, "clipping") ?? 0;
    const visible = shown.filter(
      (s) => s.tMs >= start && s.tMs < start + MIN_DISPLAY_MS,
    );
    expect(MIN_DISPLAY_MS).toBeGreaterThanOrEqual(3000);
    expect(visible.every((s) => s.notice === "clipping")).toBe(true);
    expect(shown[shown.length - 1]?.notice).toBeNull();
  });

  it("a condition toggling every 200 ms keeps the notice steady for at least 3 s", () => {
    const frames = stream(12, (t) =>
      clip(t < 6 && Math.floor(t / 0.2) % 2 === 0),
    );
    const shown = run(frames);
    const start = firstShown(shown, "clipping") ?? 0;
    const steady = shown.filter((s) => s.tMs >= start && s.tMs < start + 3000);
    expect(steady.length).toBeGreaterThan(100);
    expect(steady.every((s) => s.notice === "clipping")).toBe(true);
    const changes = shown.filter(
      (s, i) => i > 0 && s.notice !== shown[i - 1]?.notice,
    );
    expect(changes).toHaveLength(1);
  });

  it("goes away once the condition has stayed gone", () => {
    const frames = stream(10, (t) => clip(t < 1));
    const shown = run(frames);
    const last = shown[shown.length - 1];
    expect(last?.notice).toBeNull();
    const hiddenAt = shown.find((s) => s.tMs > 1000 && s.notice === null)?.tMs;
    expect(hiddenAt ?? 0).toBeGreaterThanOrEqual(3000);
    expect(hiddenAt ?? 0).toBeLessThan(6000);
  });

  it("shows nothing at all while nothing is due", () => {
    expect(noticesSeen(run(silent(5))).size).toBe(0);
  });
});
