import { describe, expect, it } from "vitest";
import {
  clamp01,
  mean,
  median,
  percentile,
  rampDown,
  rampUp,
  robustStandardDeviation,
  semitonesBetween,
  standardDeviation,
} from "./statistics";

describe("median", () => {
  it("takes the middle of an odd list regardless of order", () => {
    expect(median([5, 1, 3])).toBe(3);
  });
  it("averages the two middle values of an even list", () => {
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
  it("is 0 for an empty list", () => {
    expect(median([])).toBe(0);
  });
});

describe("percentile", () => {
  const values = [10, 20, 30, 40, 50];
  it("interpolates between neighbours", () => {
    expect(percentile(values, 50)).toBe(30);
    expect(percentile(values, 25)).toBe(20);
    expect(percentile(values, 10)).toBeCloseTo(14);
  });
  it("returns the ends at 0 and 100", () => {
    expect(percentile(values, 0)).toBe(10);
    expect(percentile(values, 100)).toBe(50);
  });
  it("does not depend on input order", () => {
    expect(percentile([50, 10, 30, 20, 40], 75)).toBe(40);
  });
  it("is 0 for an empty list", () => {
    expect(percentile([], 50)).toBe(0);
  });
});

describe("mean and standard deviation", () => {
  it("mean of nothing is 0", () => {
    expect(mean([])).toBe(0);
  });
  it("computes the population standard deviation", () => {
    expect(standardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2);
  });
});

describe("robustStandardDeviation", () => {
  it("is the p10-p90 spread divided by 2.563", () => {
    const values = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(robustStandardDeviation(values)).toBeCloseTo(80 / 2.563, 6);
  });
  it("is not moved by one glitch among many values", () => {
    const steady = Array.from({ length: 100 }, (_, i) => 100 + (i % 2));
    expect(robustStandardDeviation([...steady, 5000])).toBeCloseTo(
      robustStandardDeviation(steady),
      1,
    );
  });
});

describe("pitch distances", () => {
  it("an octave is 12 semitones", () => {
    expect(semitonesBetween(100, 200)).toBeCloseTo(12);
  });
  it("is negative going down", () => {
    expect(semitonesBetween(200, 100)).toBeCloseTo(-12);
  });
});

describe("ramps", () => {
  it("rampUp is 0 at or below the floor and 1 at or above the full mark", () => {
    expect(rampUp(5, 10, 20)).toBe(0);
    expect(rampUp(10, 10, 20)).toBe(0);
    expect(rampUp(15, 10, 20)).toBe(0.5);
    expect(rampUp(25, 10, 20)).toBe(1);
  });
  it("rampDown is 1 at or below the full mark and 0 at or above the zero mark", () => {
    expect(rampDown(5, 10, 30)).toBe(1);
    expect(rampDown(20, 10, 30)).toBe(0.5);
    expect(rampDown(30, 10, 30)).toBe(0);
  });
  it("clamp01 keeps values in range", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.4)).toBe(0.4);
  });
});
