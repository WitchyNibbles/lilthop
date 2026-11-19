import { execFileSync, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// TypeScript 7 ships no compiler API yet, and typescript-eslint needs one. So the
// project installs both, the way the TypeScript 7 release notes say: the package
// named `typescript` is the TypeScript 6 API, and `tsc` is TypeScript 7.
//
// The notes put TypeScript 7 under the name `@typescript/native`. typescript-eslint
// 8.73 declares an optional peer with that name that must be TypeScript 7.1 or
// later, so npm reports 7.0 there as an invalid install. 7.0 goes under
// `typescript-7` instead, the name the 7.0 RC notes used. Once the project moves to
// 7.1, it can take the `@typescript/native` name again.

const require = createRequire(import.meta.url);
const projectRoot = dirname(require.resolve("../package.json"));

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? Reflect.get(value, key)
    : undefined;
}

/** What the `tsc` that `npm run build` and the checks call says its version is. */
function tscVersion(): string {
  const manifest = require.resolve("typescript-7/package.json");
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

  it(
    "installs every package inside the ranges its dependents declare",
    {
      timeout: 30_000,
    },
    () => {
      // npm ls exits non-zero, naming the package, when an installed version falls
      // outside a declared range, optional peers included.
      expect(() =>
        execSync("npm ls --all", { cwd: projectRoot, stdio: "pipe" }),
      ).not.toThrow();
    },
  );
});
