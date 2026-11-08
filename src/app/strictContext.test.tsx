import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { strictContext } from "./strictContext";

describe("strictContext", () => {
  it("throws a named error outside its provider", () => {
    const [, useValue] = strictContext<number>("Numbers");
    expect(() => renderHook(() => useValue())).toThrow(/Numbers/);
  });
});
