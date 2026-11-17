import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");

const NOT_FOUND = "(no version found)";
const VERSION = String.raw`\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?`;

function readText(file: string): string {
  return readFileSync(join(root, file), "utf8");
}

function jsonField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  const found: unknown = Reflect.get(value, key);
  return found;
}

function jsonVersion(file: string, ...path: string[]): string {
  const value = path.reduce(jsonField, JSON.parse(readText(file)) as unknown);
  return typeof value === "string" ? value : NOT_FOUND;
}

function firstMatch(text: string, pattern: RegExp): string {
  return pattern.exec(text)?.[1] ?? NOT_FOUND;
}

function allMatches(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[1] ?? NOT_FOUND);
}

describe("the app's version", () => {
  it("is the same in every file that carries it", () => {
    const reference = jsonVersion("package.json", "version");

    const found = {
      "package.json": reference,
      "package-lock.json (.version)": jsonVersion(
        "package-lock.json",
        "version",
      ),
      'package-lock.json (.packages[""].version)': jsonVersion(
        "package-lock.json",
        "packages",
        "",
        "version",
      ),
      "src-tauri/tauri.conf.json": jsonVersion(
        "src-tauri/tauri.conf.json",
        "version",
      ),
      "src-tauri/Cargo.toml": firstMatch(
        readText("src-tauri/Cargo.toml"),
        /^\[package\]\r?\n(?:(?!\[).*\r?\n)*?version\s*=\s*"([^"]+)"/m,
      ),
      "src-tauri/Cargo.lock": firstMatch(
        readText("src-tauri/Cargo.lock"),
        /\[\[package\]\]\r?\nname = "lilthop"\r?\nversion = "([^"]+)"/,
      ),
    };

    const expected = Object.fromEntries(
      Object.keys(found).map((file) => [file, reference]),
    );
    expect(found, "a file carries another version").toEqual(expected);
  });

  it("is the one the README's download links point at", () => {
    const reference = jsonVersion("package.json", "version");
    const readme = readText("README.md");

    const mentions = {
      "README.md (releases/tag/v or releases/download/v)": allMatches(
        readme,
        new RegExp(String.raw`releases/(?:tag|download)/v(${VERSION})`, "g"),
      ),
      "README.md (Lilthop_<version>_ file names)": allMatches(
        readme,
        new RegExp(String.raw`Lilthop_(${VERSION})_`, "g"),
      ),
      "README.md (Lilthop-<version>- file names)": allMatches(
        readme,
        new RegExp(String.raw`Lilthop-(${VERSION})-`, "g"),
      ),
      'README.md ("Version <version>," line)': allMatches(
        readme,
        new RegExp(String.raw`^Version (${VERSION}),`, "gm"),
      ),
    };

    for (const [where, versions] of Object.entries(mentions)) {
      // A reworded README must not pass by having nothing left to check.
      expect(versions.length, `${where}: no version found`).toBeGreaterThan(0);
      expect(versions, where).toEqual(versions.map(() => reference));
    }
  });
});
