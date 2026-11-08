import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach } from "vitest";

/** A scratch folder per test, removed after it. */
export function scratchFolder() {
  const folder = { path: "" };
  beforeEach(() => {
    folder.path = mkdtempSync(join(tmpdir(), "notices-"));
  });
  afterEach(() => {
    rmSync(folder.path, { recursive: true, force: true });
  });
  return {
    get path() {
      return folder.path;
    },
    write(file: string, text: string) {
      const full = join(folder.path, file);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text);
    },
  };
}

export type Kind = "normal" | "build" | "dev";

export interface Crate {
  name: string;
  license?: string | null;
  deps?: Record<string, Kind[]>;
}

/** What `cargo metadata` prints for a few crates; "app" is the root. */
export function metadata(crates: Crate[], folder: string) {
  const id = (name: string) => `registry#${name}@1.0.0`;
  return {
    packages: crates.map((c) => ({
      id: id(c.name),
      name: c.name,
      version: "1.0.0",
      license: c.license === undefined ? "MIT" : c.license,
      manifest_path: join(folder, "crates", c.name, "Cargo.toml"),
    })),
    resolve: {
      root: id("app"),
      nodes: crates.map((c) => ({
        id: id(c.name),
        deps: Object.entries(c.deps ?? {}).map(([name, kinds]) => ({
          pkg: id(name),
          dep_kinds: kinds.map((kind) => ({
            kind: kind === "normal" ? null : kind,
          })),
        })),
      })),
    },
  };
}
