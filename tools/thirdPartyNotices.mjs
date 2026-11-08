// Writes THIRD-PARTY-NOTICES.md: every Rust crate and npm package that ships in
// the app, its licence, and each distinct licence text once. Run it with
// `npm run notices` after a dependency changes. Stops with a list if a
// dependency has no licence that works with GPL-3.0-or-later.
//
//   node tools/thirdPartyNotices.mjs [--root DIR] [--cargo PATH] [--out FILE]
//                                    [--metadata saved-cargo-metadata.json ...]
import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chosenTerms, isCompatible } from "./licenseExpression.mjs";
import {
  cargoMetadata,
  licenseTextsFor,
  readJson,
  shippedCrates,
  shippedNpm,
} from "./noticeSources.mjs";
import { renderNotices } from "./noticeText.mjs";

/** @typedef {import("./noticeSources.mjs").CargoMetadata} CargoMetadata */
/** @typedef {import("./noticeSources.mjs").Lockfile} Lockfile */

/** The targets the app is built for. A crate counts if any of them links it. */
export const TARGETS = [
  "x86_64-pc-windows-msvc",
  "x86_64-unknown-linux-gnu",
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
];

/**
 * @param {readonly string[]} argv
 * @returns {{ root: string, cargo: string, metadata: string[], out: string }}
 */
function parseArguments(argv) {
  const options = {
    root: process.cwd(),
    cargo: process.env["CARGO"] ?? "cargo",
    metadata: /** @type {string[]} */ ([]),
    out: "",
  };
  for (let i = 0; i < argv.length; i += 2) {
    const value = argv[i + 1] ?? "";
    if (argv[i] === "--root") options.root = value;
    else if (argv[i] === "--cargo") options.cargo = value;
    else if (argv[i] === "--metadata") options.metadata.push(value);
    else if (argv[i] === "--out") options.out = value;
    else throw new Error(`unknown option ${argv[i]}`);
  }
  options.out ||= join(options.root, "THIRD-PARTY-NOTICES.md");
  return options;
}

/**
 * Writes the notices file. `--metadata file.json` (once per target) reads saved
 * `cargo metadata` output instead of running cargo.
 * @param {readonly string[]} argv
 * @returns {number} the exit code
 */
export function main(argv) {
  try {
    const { root, cargo, metadata, out } = parseArguments(argv);
    const manifest = join(root, "src-tauri", "Cargo.toml");
    const overrides = join(root, "tools", "notice-overrides");
    const metas = metadata.length
      ? metadata.map((file) => /** @type {CargoMetadata} */ (readJson(file)))
      : TARGETS.map((target) => cargoMetadata([cargo], manifest, target));
    const lock = /** @type {Lockfile} */ (
      readJson(join(root, "package-lock.json"))
    );
    const found = [...shippedCrates(metas), ...shippedNpm(lock, root)];
    const refused = found.filter((d) => !isCompatible(d.license));
    if (refused.length > 0) {
      const list = refused.map(
        (d) => `${d.name} ${d.version} (${d.license || "none"})`,
      );
      throw new Error(
        `licence not usable in a GPL-3.0-or-later app: ${list.join(", ")}`,
      );
    }
    const dependencies = found.map((d) => ({
      ...d,
      chosen: chosenTerms(d.license),
      texts: licenseTextsFor(d, overrides),
    }));
    writeFileSync(out, renderNotices({ dependencies }));
    console.log(`${basename(out)}: ${dependencies.length} packages`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
