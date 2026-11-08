import { describe, expect, it } from "vitest";
import { TraceBuffer } from "./traceBuffer";

function times(buffer: TraceBuffer): number[] {
  const seen: number[] = [];
  buffer.forEachPoint((tMs) => seen.push(tMs));
  return seen;
}

describe("TraceBuffer", () => {
  it("gives points back oldest first", () => {
    const buffer = new TraceBuffer(3);
    buffer.push(1, 100, -20);
    buffer.push(2, 110, -21);
    expect(times(buffer)).toEqual([1, 2]);
  });

  it("forgets the oldest once it is full", () => {
    const buffer = new TraceBuffer(3);
    for (const t of [1, 2, 3, 4, 5]) buffer.push(t, 100, -20);
    expect(times(buffer)).toEqual([3, 4, 5]);
  });

  it("moves its version on every change, so a painter knows when to draw", () => {
    const buffer = new TraceBuffer(3);
    const before = buffer.version;
    buffer.push(1, 100, -20);
    const afterPush = buffer.version;
    buffer.clear();
    expect(afterPush).not.toBe(before);
    expect(buffer.version).not.toBe(afterPush);
  });

  it("knows the newest time", () => {
    const buffer = new TraceBuffer(3);
    expect(buffer.lastMs).toBeNull();
    buffer.push(7, 100, -20);
    expect(buffer.lastMs).toBe(7);
  });

  it("is empty after clear", () => {
    const buffer = new TraceBuffer(3);
    buffer.push(1, 100, -20);
    buffer.clear();
    expect(times(buffer)).toEqual([]);
    expect(buffer.lastMs).toBeNull();
  });
});
