import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { metadata, scratchFolder } from "./test/noticeFixtures";
import {
  cargoMetadata,
  licenseFilesIn,
  normaliseText,
  shippedCrates,
  shippedNpm,
} from "./noticeSources.mjs";

const work = scratchFolder();
const names = (found: { name: string }[]) => found.map((d) => d.name);

describe("shippedCrates", () => {
  it("lists crates reached through normal dependencies, not the app itself", () => {
    const found = shippedCrates([
      metadata(
        [
          { name: "app", deps: { a: ["normal"] } },
          { name: "a", deps: { b: ["normal"] } },
          { name: "b" },
        ],
        work.path,
      ),
    ]);
    expect(names(found)).toEqual(["a", "b"]);
  });

  it("leaves out build-only and dev-only crates and what only they pull in", () => {
    const found = shippedCrates([
      metadata(
        [
          {
            name: "app",
            deps: { cc: ["build"], mock: ["dev"], a: ["normal"] },
          },
          { name: "a", deps: { gen: ["build"] } },
          { name: "cc", deps: { which: ["normal"] } },
          { name: "mock" },
          { name: "gen" },
          { name: "which" },
        ],
        work.path,
      ),
    ]);
    expect(names(found)).toEqual(["a"]);
  });

  it("counts a crate that is a build dependency in one place and a normal one in another", () => {
    const found = shippedCrates([
      metadata(
        [
          { name: "app", deps: { both: ["build", "normal"] } },
          { name: "both" },
        ],
        work.path,
      ),
    ]);
    expect(names(found)).toEqual(["both"]);
  });

  it("joins the crates of every target once", () => {
    const windows = metadata(
      [
        { name: "app", deps: { shared: ["normal"], winapi: ["normal"] } },
        { name: "shared" },
        { name: "winapi" },
      ],
      work.path,
    );
    const linux = metadata(
      [
        { name: "app", deps: { shared: ["normal"], alsa: ["normal"] } },
        { name: "shared" },
        { name: "alsa" },
      ],
      work.path,
    );
    expect(names(shippedCrates([windows, linux]))).toEqual([
      "alsa",
      "shared",
      "winapi",
    ]);
  });

  it("carries version, licence and folder", () => {
    const [crate] = shippedCrates([
      metadata(
        [
          { name: "app", deps: { a: ["normal"] } },
          { name: "a", license: "ISC" },
        ],
        work.path,
      ),
    ]);
    expect(crate).toEqual({
      ecosystem: "crate",
      name: "a",
      version: "1.0.0",
      license: "ISC",
      dir: join(work.path, "crates", "a"),
    });
  });

  it("gives a crate with no licence an empty one", () => {
    const [crate] = shippedCrates([
      metadata(
        [
          { name: "app", deps: { a: ["normal"] } },
          { name: "a", license: null },
        ],
        work.path,
      ),
    ]);
    expect(crate?.license).toBe("");
  });
});

describe("shippedNpm", () => {
  it("skips dev-only packages and the project itself", () => {
    const found = shippedNpm(
      {
        packages: {
          "": { version: "1.0.0" },
          "node_modules/react": { version: "19.0.0", license: "MIT" },
          "node_modules/lint": { version: "1.0.0", license: "MIT", dev: true },
        },
      },
      work.path,
    );
    expect(found).toEqual([
      {
        ecosystem: "npm",
        name: "react",
        version: "19.0.0",
        license: "MIT",
        dir: join(work.path, "node_modules/react"),
      },
    ]);
  });

  it("names scoped and nested packages by their own name", () => {
    const found = shippedNpm(
      {
        packages: {
          "node_modules/@scope/a": { version: "1.0.0", license: "MIT" },
          "node_modules/a/node_modules/b": { version: "2.0.0", license: "ISC" },
        },
      },
      work.path,
    );
    expect(names(found)).toEqual(["@scope/a", "b"]);
  });

  it("reads the licence from the package when the lock file has none", () => {
    work.write("node_modules/old/package.json", '{"license":"BSD-3-Clause"}');
    work.write("node_modules/none/package.json", "{}");
    const found = shippedNpm(
      {
        packages: {
          "node_modules/old": { version: "1.0.0" },
          "node_modules/none": { version: "1.0.0" },
        },
      },
      work.path,
    );
    expect(found.map((d) => d.license)).toEqual(["", "BSD-3-Clause"]);
  });
});

describe("licenseFilesIn", () => {
  it("reads licence, copying and notice files and nothing else", () => {
    work.write("pkg/LICENSE-MIT", "mit text\r\n");
    work.write("pkg/LICENSE-APACHE", "apache text");
    work.write("pkg/NOTICE", "notice text");
    work.write("pkg/COPYING.md", "copying text");
    work.write("pkg/LICENSE.spdx", "SPDXVersion");
    work.write("pkg/license.rs", "fn main() {}");
    work.write("pkg/README.md", "readme");
    work.write("pkg/LICENSE-EMPTY", "  \n");
    work.write("pkg/licenses/inner", "inside a folder");
    expect(licenseFilesIn(join(work.path, "pkg"))).toEqual([
      { file: "COPYING.md", text: "copying text" },
      { file: "LICENSE-APACHE", text: "apache text" },
      { file: "LICENSE-MIT", text: "mit text" },
      { file: "NOTICE", text: "notice text" },
    ]);
  });

  it("finds nothing in a package without a licence file", () => {
    work.write("pkg/Cargo.toml", "");
    expect(licenseFilesIn(join(work.path, "pkg"))).toEqual([]);
  });
});

describe("normaliseText", () => {
  it("ignores line endings and blank lines around the text", () => {
    expect(normaliseText("\n\nA\r\nB\r\n\n")).toBe("A\nB");
  });

  it("drops spaces at the end of a line but keeps indentation", () => {
    expect(normaliseText("  A \t\n    B  ")).toBe("A\n    B");
  });
});

describe("cargoMetadata", () => {
  it("asks cargo for one target and parses the answer", () => {
    work.write(
      "fake-cargo.mjs",
      "console.log(JSON.stringify({ args: process.argv.slice(2) }));",
    );
    const answer = cargoMetadata(
      [process.execPath, join(work.path, "fake-cargo.mjs")],
      "m/Cargo.toml",
      "x86_64-pc-windows-msvc",
    );
    expect(answer).toEqual({
      args: [
        "metadata",
        "--format-version",
        "1",
        "--manifest-path",
        "m/Cargo.toml",
        "--filter-platform",
        "x86_64-pc-windows-msvc",
      ],
    });
  });
});
