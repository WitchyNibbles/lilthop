import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Rule } from "eslint";
import { afterEach, describe, expect, it } from "vitest";
import { caseTwins, caseTwinsPlugin } from "./caseTwins.mjs";

describe("caseTwins", () => {
  it("catches a component and its helpers that differ only in case and extension", () => {
    const twins = caseTwins([
      "src/progress/SessionChart.tsx",
      "src/progress/sessionChart.ts",
    ]);
    expect(twins.get("src/progress/SessionChart.tsx")).toEqual([
      "src/progress/sessionChart.ts",
    ]);
    expect(twins.get("src/progress/sessionChart.ts")).toEqual([
      "src/progress/SessionChart.tsx",
    ]);
  });

  it("catches two files that differ only in case", () => {
    expect(caseTwins(["a/Theme.css", "a/theme.css"]).size).toBe(2);
  });

  it("catches folders that differ only in case", () => {
    const twins = caseTwins(["src/Progress/a.ts", "src/progress/b.ts"]);
    expect(twins.get("src/Progress/")).toEqual(["src/progress/"]);
  });

  it("leaves alone names an import always spells out in full", () => {
    expect(
      caseTwins([
        "src-tauri/Cargo.toml",
        "src-tauri/Cargo.lock",
        "icons/icon.ico",
        "icons/icon.png",
        "src/Chart.tsx",
        "src/Chart.css",
        "src/types.d.ts",
        "src/types.ts",
      ]).size,
    ).toBe(0);
  });
});

describe("the no-case-twins rule", () => {
  let root = "";
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** Files only differ by extension here, so the test runs on Windows and macOS too. */
  function repoWith(files: readonly string[]): string {
    root = mkdtempSync(join(tmpdir(), "case-twins-"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    for (const file of files) {
      mkdirSync(join(root, file, ".."), { recursive: true });
      writeFileSync(join(root, file), "");
    }
    return root;
  }

  function reportsFor(repo: string, file: string): unknown[] {
    const rule = caseTwinsPlugin(repo).rules?.["no-case-twins"] as
      Rule.RuleModule | undefined;
    const reports: unknown[] = [];
    const context = {
      filename: join(repo, file),
      report: (r: unknown) => reports.push(r),
    } as unknown as Rule.RuleContext;
    const listener = rule?.create(context);
    (listener?.Program as ((node: unknown) => void) | undefined)?.({});
    return reports;
  }

  it("fails a file whose twin sits beside it in the repo", () => {
    const repo = repoWith(["src/Chart.tsx", "src/chart.ts", "src/other.ts"]);
    expect(reportsFor(repo, "src/Chart.tsx")).toHaveLength(1);
    expect(reportsFor(repo, "src/other.ts")).toHaveLength(0);
  });
});
