import { describe, expect, it } from "vitest";
import {
  alternatives,
  chosenTerms,
  isCompatible,
} from "./licenseExpression.mjs";

describe("alternatives", () => {
  it("reads OR as separate options", () => {
    expect(alternatives("MIT OR Apache-2.0")).toEqual([
      ["MIT"],
      ["Apache-2.0"],
    ]);
  });

  it("reads the old slash as OR", () => {
    expect(alternatives("MIT/Apache-2.0")).toEqual([["MIT"], ["Apache-2.0"]]);
    expect(alternatives("Apache-2.0 / MIT")).toEqual([["Apache-2.0"], ["MIT"]]);
  });

  it("reads AND as licences that all apply", () => {
    expect(alternatives("BSD-3-Clause AND MIT")).toEqual([
      ["BSD-3-Clause", "MIT"],
    ]);
  });

  it("spreads a bracketed choice over an AND", () => {
    expect(alternatives("(MIT OR Apache-2.0) AND Unicode-3.0")).toEqual([
      ["MIT", "Unicode-3.0"],
      ["Apache-2.0", "Unicode-3.0"],
    ]);
  });

  it("keeps a WITH exception together with its licence", () => {
    expect(alternatives("Apache-2.0 WITH LLVM-exception OR MIT")).toEqual([
      ["Apache-2.0 WITH LLVM-exception"],
      ["MIT"],
    ]);
  });

  it("refuses what it cannot read", () => {
    expect(() => alternatives("Apache-2.0 WITH")).toThrow();
    expect(() => alternatives("Apache-2.0 WITH OR MIT")).toThrow();
    expect(() => alternatives("")).toThrow();
    expect(() => alternatives("MIT OR")).toThrow();
    expect(() => alternatives("(MIT")).toThrow();
    expect(() => alternatives("MIT) OR ISC")).toThrow();
  });
});

describe("isCompatible", () => {
  it("accepts a plain permissive licence", () => {
    expect(isCompatible("MIT")).toBe(true);
    expect(isCompatible("Unicode-3.0")).toBe(true);
    expect(isCompatible("MPL-2.0")).toBe(true);
  });

  it("accepts an expression with one usable option", () => {
    expect(isCompatible("MIT OR Apache-2.0 OR LGPL-2.1-or-later")).toBe(true);
  });

  it("refuses an expression whose every option needs something else", () => {
    expect(isCompatible("LGPL-2.1-or-later")).toBe(false);
    expect(isCompatible("MIT AND LGPL-2.1-or-later")).toBe(false);
    expect(isCompatible("GPL-2.0-only")).toBe(false);
  });

  it("accepts Apache-2.0 with the LLVM exception, alone or as an option", () => {
    expect(isCompatible("Apache-2.0 WITH LLVM-exception")).toBe(true);
    expect(isCompatible("Apache-2.0 WITH LLVM-exception OR MIT")).toBe(true);
    expect(
      isCompatible("(MIT OR Apache-2.0 WITH LLVM-exception) AND ISC"),
    ).toBe(true);
  });

  it("does not take other exceptions on trust", () => {
    expect(isCompatible("GPL-2.0-only WITH Classpath-exception-2.0")).toBe(
      false,
    );
    expect(isCompatible("MIT WITH Some-exception")).toBe(false);
    expect(isCompatible("LGPL-2.1-or-later WITH LLVM-exception")).toBe(false);
  });

  it("refuses a missing or unreadable licence", () => {
    expect(isCompatible("")).toBe(false);
    expect(isCompatible("MIT WITH Exception")).toBe(false);
  });
});

describe("chosenTerms", () => {
  it("keeps an expression that needs no choice, as written", () => {
    expect(chosenTerms("  MIT OR Apache-2.0 ")).toBe("MIT OR Apache-2.0");
    expect(chosenTerms("Apache-2.0/MIT")).toBe("Apache-2.0/MIT");
  });

  it("takes the MIT and Apache side when an LGPL option is offered", () => {
    expect(chosenTerms("MIT OR Apache-2.0 OR LGPL-2.1-or-later")).toBe(
      "MIT OR Apache-2.0",
    );
  });

  it("keeps a WITH exception in the licence it chose", () => {
    expect(chosenTerms("Apache-2.0 WITH LLVM-exception")).toBe(
      "Apache-2.0 WITH LLVM-exception",
    );
    expect(
      chosenTerms("Apache-2.0 WITH LLVM-exception OR LGPL-2.1-or-later"),
    ).toBe("Apache-2.0 WITH LLVM-exception");
  });

  it("keeps the AND when it drops an option", () => {
    expect(chosenTerms("(MIT AND ISC) OR LGPL-3.0-only")).toBe("MIT AND ISC");
  });

  it("refuses when no option is usable", () => {
    expect(() => chosenTerms("LGPL-2.1-or-later")).toThrow(/no usable/);
  });
});
