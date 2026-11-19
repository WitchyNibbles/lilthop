import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// TypeScript 7 ships no compiler API yet, and typescript-eslint needs one. So the
// project installs both, the way the TypeScript 7 release notes say: the package
// named `typescript` is the TypeScript 6 API, and `tsc` is TypeScript 7.
//
// Two packages offer a `tsc` command: TypeScript 7, and `@typescript/old`, the
// TypeScript 6 that `@typescript/typescript6` depends on. When packages at the top
// of node_modules offer the same command, npm links the one whose path sorts first,
// so the TypeScript 7 alias has to sort before `@typescript/old`. The release notes
// name it `@typescript/native`, but typescript-eslint 8.73 declares an optional peer
// with that name that must be TypeScript 7.1 or later, and npm reports 7.0 there as
// an invalid install. So 7.0 goes under `@typescript/native-7`. Once the project
// moves to 7.1, it can take the `@typescript/native` name again.

const require = createRequire(import.meta.url);
const projectRoot = dirname(require.resolve("../package.json"));

/** What an npm command prints, run in the project the way `npm run` runs scripts. */
function npm(args: string): string {
  return execSync(`npm ${args}`, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
}

describe("TypeScript toolchain", () => {
  it("gives typescript-eslint the TypeScript 6 compiler API", () => {
    expect(ts.version).toMatch(/^6\./);
    expect(ts.createProgram).toBeTypeOf("function");
  });

  it(
    "type-checks with the native TypeScript 7 compiler",
    { timeout: 30_000 },
    () => {
      // npm exec finds `tsc` in node_modules/.bin, where `npm run build` and the
      // checks find it.
      expect(npm("exec --no -- tsc --version")).toMatch(/^Version 7\./);
    },
  );

  it(
    "installs every package inside the ranges its dependents declare",
    { timeout: 30_000 },
    () => {
      // npm ls exits non-zero, naming the package, when an installed version falls
      // outside a declared range, optional peers included.
      expect(() => npm("ls --all")).not.toThrow();
    },
  );
});
