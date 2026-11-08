// Where the notices come from: the crates and npm packages that ship in the
// app, and the licence files in their folders.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * @typedef {{
 *   ecosystem: "crate" | "npm",
 *   name: string,
 *   version: string,
 *   license: string,
 *   dir: string,
 * }} Dependency
 */

/**
 * @typedef {{
 *   packages: {
 *     id: string,
 *     name: string,
 *     version: string,
 *     license?: string | null,
 *     manifest_path: string,
 *   }[],
 *   resolve: {
 *     root: string,
 *     nodes: {
 *       id: string,
 *       deps: { pkg: string, dep_kinds: { kind: string | null }[] }[],
 *     }[],
 *   },
 * }} CargoMetadata
 */

/** @typedef {{ packages: Record<string, { version: string, license?: string, dev?: boolean }> }} Lockfile */

/**
 * @param {string} file
 * @returns {unknown}
 */
export function readJson(file) {
  return parseJson(readFileSync(file, "utf8"));
}

/**
 * @param {string} text
 * @returns {unknown}
 */
function parseJson(text) {
  return JSON.parse(text);
}

/**
 * Crates that a normal (not dev, not build) dependency chain from the app's own
 * package links, on any of the given targets. Takes the JSON that
 * `cargo metadata --filter-platform <target>` prints, one per target.
 * @param {readonly CargoMetadata[]} metadata
 * @returns {Dependency[]}
 */
export function shippedCrates(metadata) {
  /** @type {Map<string, Dependency>} */
  const found = new Map();
  for (const meta of metadata) {
    const packages = new Map(meta.packages.map((p) => [p.id, p]));
    const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
    const seen = new Set([meta.resolve.root]);
    const pending = [meta.resolve.root];
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      for (const dep of nodes.get(id)?.deps ?? []) {
        const normal = dep.dep_kinds.some((k) => !k.kind);
        const pkg = packages.get(dep.pkg);
        if (!normal || !pkg || seen.has(dep.pkg)) continue;
        seen.add(dep.pkg);
        pending.push(dep.pkg);
        found.set(dep.pkg, {
          ecosystem: "crate",
          name: pkg.name,
          version: pkg.version,
          license: pkg.license ?? "",
          dir: dirname(pkg.manifest_path),
        });
      }
    }
  }
  return sortDependencies([...found.values()]);
}

/**
 * Packages in package-lock.json that are not dev-only.
 * @param {Lockfile} lock
 * @param {string} root the folder holding node_modules
 * @returns {Dependency[]}
 */
export function shippedNpm(lock, root) {
  const prefix = "node_modules/";
  return sortDependencies(
    Object.entries(lock.packages)
      .filter(([path, entry]) => path.includes(prefix) && !entry.dev)
      .map(([path, entry]) => {
        const dir = join(root, path);
        return {
          ecosystem: "npm",
          name: path.slice(path.lastIndexOf(prefix) + prefix.length),
          version: entry.version,
          license: entry.license ?? packageLicense(dir),
          dir,
        };
      }),
  );
}

/** @param {string} dir */
function packageLicense(dir) {
  const manifest = /** @type {{ license?: string }} */ (
    readJson(join(dir, "package.json"))
  );
  return manifest.license ?? "";
}

/** @param {Dependency[]} dependencies */
function sortDependencies(dependencies) {
  return dependencies.sort(
    (a, b) =>
      a.name.localeCompare(b.name, "en") ||
      a.version.localeCompare(b.version, "en"),
  );
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice|unlicense)/i;
const NOT_TEXT = /\.(spdx|rs|js|mjs|cjs|ts|json|toml|py|h|c|lock)$/i;

/**
 * The licence, copying and notice files at the top of a package folder.
 * @param {string} dir
 * @returns {{ file: string, text: string }[]}
 */
export function licenseFilesIn(dir) {
  return readdirSync(dir)
    .filter((name) => LICENSE_FILE.test(name) && !NOT_TEXT.test(name))
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort()
    .map((file) => ({
      file,
      text: normaliseText(readFileSync(join(dir, file), "utf8")),
    }))
    .filter(({ text }) => text !== "");
}

/**
 * The licence files of a package: its own, or when it ships none, the ones
 * kept for it in `tools/notice-overrides/<name>/` (copied from its upstream
 * repository, see the README there).
 * @param {Dependency} dependency
 * @param {string} overridesDir
 * @returns {{ file: string, text: string }[]}
 */
export function licenseTextsFor(dependency, overridesDir) {
  const own = licenseFilesIn(dependency.dir);
  if (own.length > 0 || dependency.ecosystem !== "crate") return own;
  const saved = join(overridesDir, dependency.name);
  return existsSync(saved) ? licenseFilesIn(saved) : [];
}

/**
 * Same text, whatever the line endings, trailing spaces or blank lines around it.
 * @param {string} text
 */
export function normaliseText(text) {
  return text
    .replaceAll("\r\n", "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/**
 * `cargo metadata` for one target, parsed.
 * @param {readonly string[]} cargo the program and any arguments before `metadata`
 * @param {string} manifest
 * @param {string} target
 * @returns {CargoMetadata}
 */
export function cargoMetadata(cargo, manifest, target) {
  const [program = "cargo", ...before] = cargo;
  const output = execFileSync(
    program,
    [
      ...before,
      "metadata",
      "--format-version",
      "1",
      "--manifest-path",
      manifest,
      "--filter-platform",
      target,
    ],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 },
  );
  return /** @type {CargoMetadata} */ (parseJson(output));
}
