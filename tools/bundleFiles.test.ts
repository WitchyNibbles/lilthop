import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const tauriFolder = join(root, "src-tauri");

interface Bundle {
  icon: string[];
  licenseFile: string;
  resources: Record<string, string>;
}

const { bundle } = JSON.parse(
  readFileSync(join(tauriFolder, "tauri.conf.json"), "utf8"),
) as { bundle: Bundle };

describe("files the installer is built from", () => {
  it("has every icon the bundle lists", () => {
    const missing = bundle.icon.filter(
      (icon) => !existsSync(join(tauriFolder, icon)),
    );
    expect(missing).toEqual([]);
  });

  it("has the licence file and every resource the bundle lists", () => {
    const listed = [bundle.licenseFile, ...Object.keys(bundle.resources)];
    const missing = listed.filter(
      (file) => !existsSync(join(tauriFolder, file)),
    );
    expect(missing).toEqual([]);
  });

  it("ships the licence and the third-party notices next to the app", () => {
    expect(Object.values(bundle.resources).sort()).toEqual([
      "LICENSE",
      "THIRD-PARTY-NOTICES.md",
    ]);
  });
});

describe("the icon source", () => {
  const svg = readFileSync(
    join(tauriFolder, "icons", "source", "lilthop.svg"),
    "utf8",
  );

  it("is a 1024 px square with concrete colours only", () => {
    expect(svg).toContain('viewBox="0 0 1024 1024"');
    expect(svg).not.toMatch(/var\(/);
    expect(svg).not.toMatch(/(?:href|url\()/);
    expect(svg).not.toMatch(/<(?:text|style|image)\b/);
  });

  it("is the one the page uses as its tab icon", () => {
    const page = readFileSync(join(root, "index.html"), "utf8");
    expect(page).toContain("/src-tauri/icons/source/lilthop.svg");
  });
});
