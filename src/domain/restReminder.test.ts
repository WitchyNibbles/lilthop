import { describe, expect, it } from "vitest";
import type { PitchFrame } from "./contract";
import { SafetyMonitor } from "./safety";
import { RestBreakRule } from "./safetyRules";
import { CONTEXT, firstShown, run, type Shown } from "./safetyTestKit";
import { concat, stream, voiced } from "./testFrames";

const at = (minutes: number, seconds = 0) => (minutes * 60 + seconds) * 1000;

function frames(
  fromMs: number,
  toMs: number,
  extra: Partial<PitchFrame> = {},
): PitchFrame[] {
  const make = () => ({ ...voiced(200), ...extra });
  return stream((toMs - fromMs) / 1000, make, fromMs);
}

const LOUD = { rms: 0.2, peak: 0.4 };
const CLIPPED = { peak: 1 };

const reminders = (shown: readonly Shown[]) =>
  shown.filter((s) => s.notice === "restBreak");
const noticeAt = (shown: readonly Shown[], tMs: number) =>
  shown.find((s) => s.tMs >= tMs)?.notice;
const firstAfter = (shown: readonly Shown[], tMs: number) =>
  reminders(shown).find((s) => s.tMs > tMs)?.tMs ?? 0;

describe("a rest reminder held up behind another notice", () => {
  it("stays due behind clipping and shows once it clears, for its full ten seconds", () => {
    const shown = run(
      concat(
        frames(0, at(14, 55)),
        frames(at(14, 55), at(15, 15), CLIPPED),
        frames(at(15, 15), at(16)),
      ),
    );
    const first = firstShown(shown, "restBreak") ?? 0;
    expect(first).toBeGreaterThanOrEqual(at(15, 15));
    expect(first).toBeLessThan(at(15, 17));
    const last = reminders(shown).slice(-1)[0]?.tMs ?? 0;
    expect(last - first).toBeGreaterThanOrEqual(9_000);
  });

  it("keeps the beat from the old due time once it has been shown", () => {
    const shown = run(
      concat(
        frames(0, at(14, 55)),
        frames(at(14, 55), at(15, 15), CLIPPED),
        frames(at(15, 15), at(31)),
      ),
    );
    const next = firstAfter(shown, at(20));
    expect(next).toBeGreaterThanOrEqual(at(30));
    expect(next).toBeLessThan(at(30, 1));
  });

  it("takes the strip from louder after waiting 30 s, then louder comes back", () => {
    const shown = run(
      concat(
        frames(0, at(14, 40)),
        frames(at(14, 40), at(15, 50), LOUD),
        frames(at(15, 50), at(31)),
      ),
    );
    const first = firstShown(shown, "restBreak") ?? 0;
    expect(first).toBeGreaterThanOrEqual(at(15, 30));
    expect(first).toBeLessThan(at(15, 31));
    expect(noticeAt(shown, first + 9_000)).toBe("restBreak");
    expect(noticeAt(shown, first + 12_000)).toBe("louder");
    const next = firstAfter(shown, at(20));
    expect(next).toBeGreaterThanOrEqual(at(30));
    expect(next).toBeLessThan(at(30, 1));
  });

  it("gets through a mic that clips for good", () => {
    const shown = run(
      concat(frames(0, at(14, 55)), frames(at(14, 55), at(17), CLIPPED)),
    );
    const first = firstShown(shown, "restBreak") ?? 0;
    expect(first).toBeGreaterThanOrEqual(at(15, 30));
    expect(first).toBeLessThan(at(15, 31));
    expect(noticeAt(shown, first + 9_000)).toBe("restBreak");
    expect(noticeAt(shown, first + 12_000)).toBe("clipping");
  });

  it("does not jump the queue before it has waited 30 s", () => {
    const shown = run(
      concat(frames(0, at(14, 55)), frames(at(14, 55), at(15, 29), CLIPPED)),
    );
    expect(reminders(shown)).toHaveLength(0);
  });

  it("does not lose its turn when the mic stops while it waits", () => {
    const rule = new RestBreakRule();
    const first = new SafetyMonitor({ ...CONTEXT, restBreak: rule });
    concat(
      frames(0, at(14, 55)),
      frames(at(14, 55), at(15, 10), CLIPPED),
    ).forEach((frame) => first.push(frame));
    rule.newStream(1_000);
    const second = new SafetyMonitor({ ...CONTEXT, restBreak: rule });
    const shown = frames(0, at(0, 2)).map((frame) => second.push(frame));
    expect(shown).toContain("restBreak");
  });
});

describe("a rest reminder pushed aside once it is up", () => {
  it("is not counted twice when it comes back inside its ten seconds", () => {
    const shown = run(
      concat(
        frames(0, at(15, 4)),
        frames(at(15, 4), at(15, 5), CLIPPED),
        frames(at(15, 5), at(31)),
      ),
    );
    const next = firstAfter(shown, at(20));
    expect(next).toBeGreaterThanOrEqual(at(30));
    expect(next).toBeLessThan(at(30, 1));
  });
});
