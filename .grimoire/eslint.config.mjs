// Grimoire's ESLint base for TypeScript, installed by `grimoire project`. Spread it LAST in the
// project's eslint.config.*, so nothing after it can weaken it:
//
//   import grimoire from "<relative path>/.grimoire/eslint.config.mjs";
//   export default [...yourConfigs, ...grimoire];
//
// `python3 .grimoire/check.py` resolves the config of every file tsc compiles and fails when a rule
// here resolves weaker, or with other options.
//
// typescript-eslint and ESLint's rules are loaded from the project ESLint runs in, found through the
// working directory (process.cwd()), not next to this file: one .grimoire/ at the repo root serves
// projects that each install their own packages. Run ESLint from the project's directory.
import { createRequire } from "node:module";
import path from "node:path";

// Typed here, not by the packages' own types: a `.grimoire/` above a nested project cannot resolve
// them, and with `checkJs` a project's tsc checks this file. The loader is not called `require` so
// tsc does not treat its calls as imports it must resolve.
const load = createRequire(path.join(process.cwd(), "package.json"));

/** @typedef {{ defaultOptions?: unknown[], meta?: { defaultOptions?: unknown[] } }} Rule */
/** @typedef {{ rules?: Record<string, unknown> }} Config */

/** @type {{ plugin: { rules: Record<string, Rule> }, configs: { recommendedTypeChecked: Config[] } }} */
const tseslint = load("typescript-eslint");
/** @type {{ builtinRules: Map<string, Rule> }} */
const { builtinRules } = load("eslint/use-at-your-own-risk");

const PLUGIN = "@typescript-eslint/";

/**
 * @param {string} name
 * @returns {unknown[]}
 */
function defaults(name) {
  const rule = name.startsWith(PLUGIN)
    ? tseslint.plugin.rules[name.slice(PLUGIN.length)]
    : builtinRules.get(name);
  return rule?.defaultOptions ?? rule?.meta?.defaultOptions ?? [];
}

// Every rule this base turns on gets its options spelled out: a later `"error"` with no options
// keeps the options an earlier config set, so a bare severity would let those survive.
/**
 * @param {Record<string, unknown>} rules
 * @returns {Record<string, unknown>}
 */
function explicit(rules) {
  return Object.fromEntries(
    Object.entries(rules).map(([name, entry]) => {
      const [level, ...options] = Array.isArray(entry) ? entry : [entry];
      const off = level === "off" || level === 0;
      return [name, off || options.length > 0 ? entry : [level, ...defaults(name)]];
    }),
  );
}

// Typed so that a project's tsc sees a list of objects, not `any`: spreading `any` is an unsafe
// assignment the base itself forbids. Any typed ESLint config list takes these objects.
/** @type {object[]} */
const config = [
  ...tseslint.configs.recommendedTypeChecked.map((entry) =>
    entry.rules ? { ...entry, rules: explicit(entry.rules) } : entry,
  ),
  {
    languageOptions: { parserOptions: { projectService: true } },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" },
    rules: explicit({
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
      complexity: ["error", 10], // matches ruff's max-complexity
    }),
  },
];

export default config;
