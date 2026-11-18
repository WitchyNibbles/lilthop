import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// TypeScript 7 ships no compiler API yet, and typescript-eslint needs one. So the
// project installs both, the way the TypeScript 7 release notes say: the package
// named `typescript` is the TypeScript 6 API, and `tsc` is TypeScript 7.

const require = createRequire(import.meta.url);

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

/** What the `tsc` that `npm run build` and the checks call says its version is. */
function tscVersion(): string {
  const manifest = require.resolve("@typescript/native/package.json");
  const bin = field(field(require(manifest), "bin"), "tsc");
  if (typeof bin !== "string") {
    throw new Error(`${manifest} names no tsc binary`);
  }
  const tsc = join(dirname(manifest), bin);
  return execFileSync(process.execPath, [tsc, "--version"], {
    encoding: "utf8",
  });
}

describe("TypeScript toolchain", () => {
  it("gives typescript-eslint the TypeScript 6 compiler API", () => {
    expect(ts.version).toMatch(/^6\./);
    expect(ts.createProgram).toBeTypeOf("function");
  });

  it("type-checks with the native TypeScript 7 compiler", () => {
    expect(tscVersion()).toMatch(/^Version 7\./);
  });
});
