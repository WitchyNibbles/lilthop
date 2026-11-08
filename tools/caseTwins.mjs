import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** Extensions an import may leave out, so `./Chart` can mean any of them. */
const MODULE_EXTENSION = /\.(?:[cm]?[jt]sx?|json)$/i;

/** @param {string} path */
function windowsKey(path) {
  return path.toLowerCase().replace(MODULE_EXTENSION, "");
}

/**
 * Every directory the paths sit in, each ending in "/", so a folder can clash too.
 * @param {readonly string[]} paths
 * @returns {string[]}
 */
function directoriesOf(paths) {
  const directories = new Set(
    paths.flatMap((path) =>
      path
        .split("/")
        .slice(0, -1)
        .map((_, i, parts) => `${parts.slice(0, i + 1).join("/")}/`),
    ),
  );
  return [...directories];
}

/**
 * Paths that are one path on Windows and macOS: equal once case, and an
 * extension an import can leave out, are ignored. Linux tells them apart, so
 * nothing else would catch them before a user does.
 * @param {readonly string[]} paths
 * @returns {Map<string, string[]>} each clashing path, with the paths it clashes with
 */
export function caseTwins(paths) {
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const path of [...paths, ...directoriesOf(paths)]) {
    const key = windowsKey(path);
    groups.set(key, [...(groups.get(key) ?? []), path]);
  }
  /** @type {Map<string, string[]>} */
  const twins = new Map();
  for (const group of groups.values()) {
    for (const path of group) {
      if (group.length > 1)
        twins.set(
          path,
          group.filter((other) => other !== path),
        );
    }
  }
  return twins;
}

/** @param {string} root */
function filesIn(root) {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\n")
    .filter((path) => path !== "" && existsSync(join(root, path)));
}

/**
 * @param {Map<string, string[]>} twins
 * @param {string} path
 */
function clashesOf(twins, path) {
  const folders = directoriesOf([path]);
  return [path, ...folders].flatMap((p) => twins.get(p) ?? []);
}

/**
 * An ESLint plugin whose one rule fails a file that clashes with another path
 * in the repo once case and extension are ignored.
 * @param {string} root
 * @returns {import("eslint").ESLint.Plugin}
 */
export function caseTwinsPlugin(root) {
  const twins = caseTwins(filesIn(root));
  /** @type {import("eslint").Rule.RuleModule} */
  const rule = {
    meta: {
      type: "problem",
      schema: [],
      messages: {
        clash:
          "{{path}} clashes with {{others}} once case and extension are ignored. Windows and macOS can load the wrong one: rename one.",
      },
    },
    create(context) {
      const path = relative(root, context.filename).split(sep).join("/");
      const others = clashesOf(twins, path);
      return {
        Program(node) {
          if (others.length > 0)
            context.report({
              node,
              messageId: "clash",
              data: { path, others: others.join(", ") },
            });
        },
      };
    },
  };
  return { rules: { "no-case-twins": rule } };
}
