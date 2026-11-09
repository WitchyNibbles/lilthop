import { describe, expect, it } from "vitest";
import { groupTexts, renderNotices } from "./noticeText.mjs";

const names = (found: { name: string }[]) => found.map((d) => d.name);

function dependency(name: string, texts: [string, string][]) {
  return {
    ecosystem: "crate" as const,
    name,
    version: "1.0.0",
    license: "MIT",
    chosen: "MIT",
    dir: "",
    texts: texts.map(([file, text]) => ({ file, text })),
  };
}

describe("groupTexts", () => {
  it("shows one text once, with every package that uses it", () => {
    const groups = groupTexts([
      dependency("a", [["LICENSE", "same"]]),
      dependency("b", [["LICENSE-MIT", "same"]]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.files).toEqual(["LICENSE", "LICENSE-MIT"]);
    expect(names(groups[0]?.users ?? [])).toEqual(["a", "b"]);
  });

  it("keeps texts apart when a word differs", () => {
    const groups = groupTexts([
      dependency("a", [["LICENSE", "Copyright 2020 A"]]),
      dependency("b", [["LICENSE", "Copyright 2021 B"]]),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("counts a package once when two of its files hold the same text", () => {
    const [group] = groupTexts([
      dependency("a", [
        ["LICENSE", "same"],
        ["COPYING", "same"],
      ]),
    ]);
    expect(group?.users).toHaveLength(1);
  });

  it("puts the most shared text first, ties in text order", () => {
    const groups = groupTexts([
      dependency("a", [["L", "zebra"]]),
      dependency("b", [["L", "apple"]]),
      dependency("c", [["L", "common"]]),
      dependency("d", [["L", "common"]]),
    ]);
    expect(groups.map((g) => g.text)).toEqual(["common", "apple", "zebra"]);
  });
});

describe("renderNotices", () => {
  const crates = [
    dependency("alpha", [["LICENSE-MIT", "MIT text"]]),
    dependency("beta", [["LICENSE", "MIT text"]]),
    { ...dependency("gamma", []), chosen: "ISC", license: "ISC" },
  ];
  const npm = {
    ...dependency("react", [["LICENSE", "React text"]]),
    ecosystem: "npm" as const,
  };

  it("lists the packages, the ones without a licence file, and each text once", () => {
    const notes = renderNotices({ dependencies: [...crates, npm] });
    expect(notes).toContain("### Rust crates (3)");
    expect(notes).toContain("- alpha 1.0.0: MIT");
    expect(notes).toContain("### npm packages (1)");
    expect(notes).toContain("- react 1.0.0: MIT");
    expect(notes).toContain("## Packages without a licence file (1)");
    const [, afterBare = ""] = notes.split(
      "## Packages without a licence file",
    );
    expect(afterBare.split("## Licence texts")[0]).toContain(
      "- gamma 1.0.0: ISC",
    );
    expect(notes.split("## Packages without")[0]).toContain(
      "- gamma 1.0.0: ISC",
    );
    expect(notes).toContain("## Licence texts (2)");
    expect(notes).toContain("Used by (2): alpha 1.0.0, beta 1.0.0");
    expect(notes.match(/MIT text\n/g)).toHaveLength(1);
    expect(notes.endsWith("\n")).toBe(true);
  });

  it("says where the source of the MPL-2.0 packages is", () => {
    const notes = renderNotices({ dependencies: crates });
    expect(notes).toContain(
      "The source code of the packages under MPL-2.0 is on crates.io, at the versions listed here.",
    );
  });

  it("gives Microsoft's WebView2 loader its own section with the real licence text", () => {
    const notes = renderNotices({ dependencies: crates });
    const [before = "", section = ""] = notes.split("## Vendored code");
    expect(before).toContain("SQLite, which comes inside the `rusqlite` crate");
    expect(before).toContain("WebView2LoaderStatic.lib");
    expect(section).toContain("Microsoft.Web.WebView2");
    expect(section).toContain("1.0.3800.47");
    expect(section).toContain(
      "Copyright (C) Microsoft Corporation. All rights reserved.",
    );
    expect(section).toContain(
      "The name of Microsoft Corporation, or the names of its contributors\nmay not be used",
    );
    expect(section).toContain("SUCH DAMAGE.");
  });

  it("credits the font behind the logo wordmark in the intro", () => {
    const notes = renderNotices({ dependencies: crates });
    const [intro = ""] = notes.split("## Packages");
    expect(intro).toContain(
      'The logo in `docs/brand/` draws the "Lilthop" wordmark from outlines of the Atkinson Hyperlegible Next font',
    );
    expect(intro).toContain(
      "Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors (https://github.com/googlefonts/atkinson-hyperlegible-next)",
    );
    expect(intro).toContain(
      "under OFL-1.1. Its licence text is under the `@fontsource-variable/atkinson-hyperlegible-next` package below.",
    );
  });

  it("says so when every package has a licence file", () => {
    const [first] = crates;
    const notes = renderNotices({ dependencies: first ? [first] : [] });
    expect(notes).toContain("## Packages without a licence file (0)\n\nNone.");
  });

  it("fences a text that holds backticks with a longer fence", () => {
    const notes = renderNotices({
      dependencies: [dependency("a", [["LICENSE", "use ```code``` here"]])],
    });
    expect(notes).toContain("````\nuse ```code``` here\n````");
  });

  it("gives the same file for the same input", () => {
    const input = { dependencies: [...crates, npm] };
    expect(renderNotices(input)).toBe(renderNotices(input));
  });
});
