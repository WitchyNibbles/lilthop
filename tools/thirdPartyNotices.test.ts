import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { metadata, scratchFolder } from "./test/noticeFixtures";
import { main } from "./thirdPartyNotices.mjs";

const work = scratchFolder();

afterEach(() => {
  vi.restoreAllMocks();
});

/** A project with an app, one crate and react. */
function project(crateLicense: string) {
  work.write(
    "meta.json",
    JSON.stringify(
      metadata(
        [
          { name: "app", deps: { a: ["normal"] } },
          { name: "a", license: crateLicense },
        ],
        work.path,
      ),
    ),
  );
  work.write("crates/a/LICENSE", "Crate A licence");
  work.write(
    "package-lock.json",
    JSON.stringify({
      packages: {
        "": {},
        "node_modules/react": { version: "19.0.0", license: "MIT" },
        "node_modules/devtool": { version: "1.0.0", license: "MIT", dev: true },
      },
    }),
  );
  work.write("node_modules/react/LICENSE", "React licence");
}

const args = (...more: string[]) => [
  "--root",
  work.path,
  "--metadata",
  join(work.path, "meta.json"),
  ...more,
];

const notices = () =>
  readFileSync(join(work.path, "THIRD-PARTY-NOTICES.md"), "utf8");

describe("main", () => {
  it("writes THIRD-PARTY-NOTICES.md from saved cargo metadata", () => {
    project("MIT");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(main(args())).toBe(0);
    const text = notices();
    expect(text).toContain("- a 1.0.0: MIT");
    expect(text).toContain("- react 19.0.0: MIT");
    expect(text).toContain("Crate A licence");
    expect(text).toContain("React licence");
    expect(text).not.toContain("devtool");
    expect(log).toHaveBeenCalledWith("THIRD-PARTY-NOTICES.md: 2 packages");
  });

  it("uses a saved licence text for a crate that ships none", () => {
    project("MIT");
    rmSync(join(work.path, "crates/a/LICENSE"));
    work.write("tools/notice-overrides/a/LICENSE", "Text kept from upstream");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(main(args())).toBe(0);
    const text = notices();
    expect(text).toContain("Text kept from upstream");
    expect(text).toContain("## Packages without a licence file (0)");
  });

  it("prefers the crate's own licence file over a saved one", () => {
    project("MIT");
    work.write("tools/notice-overrides/a/LICENSE", "Text kept from upstream");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(main(args())).toBe(0);
    expect(notices()).toContain("Crate A licence");
    expect(notices()).not.toContain("Text kept from upstream");
  });

  it("lists a crate with neither as without a licence file", () => {
    project("MIT");
    rmSync(join(work.path, "crates/a/LICENSE"));
    work.write("tools/notice-overrides/other-crate/LICENSE", "Not for a");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(main(args())).toBe(0);
    expect(notices()).toContain("## Packages without a licence file (1)");
    expect(notices()).not.toContain("Not for a");
  });

  it("writes where --out says", () => {
    project("MIT");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(main(args("--out", join(work.path, "other.md")))).toBe(0);
    expect(readFileSync(join(work.path, "other.md"), "utf8")).toContain(
      "# Third-party",
    );
  });

  it("stops, and writes nothing, when a package has a licence that does not fit", () => {
    project("LGPL-2.1-or-later");
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    expect(main(args())).toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("a 1.0.0"));
    expect(() => notices()).toThrow();
  });

  it("stops on an option it does not know", () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    expect(main(["--nope", "1"])).toBe(1);
    expect(error).toHaveBeenCalledWith("unknown option --nope");
  });

  it("stops with a message when a file is missing", () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    expect(
      main(["--root", work.path, "--metadata", join(work.path, "none.json")]),
    ).toBe(1);
    expect(error).toHaveBeenCalledOnce();
  });

  it("runs when node starts the file, as `npm run notices` does", async () => {
    project("MIT");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const before = { argv: process.argv, code: process.exitCode };
    process.argv = [
      "node",
      join(import.meta.dirname, "thirdPartyNotices.mjs"),
      ...args(),
    ];
    try {
      vi.resetModules();
      await import("./thirdPartyNotices.mjs");
      expect(process.exitCode).toBe(0);
    } finally {
      process.argv = before.argv;
      process.exitCode = before.code;
    }
    expect(notices()).toContain("- a 1.0.0: MIT");
  });
});
