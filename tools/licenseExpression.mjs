// Which licence expressions can sit inside a GPL-3.0-or-later app, and which
// side of an `OR` we take.

/**
 * Licences that can sit inside a GPL-3.0-or-later app. The OFL is for the two
 * bundled fonts: they are separate works shipped next to the program.
 */
const COMPATIBLE = new Set([
  "0BSD",
  "Apache-2.0",
  "Apache-2.0 WITH LLVM-exception",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "ISC",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "OFL-1.1",
  "Unicode-3.0",
  "Unlicense",
  "Zlib",
]);

/**
 * The alternatives of an SPDX expression, each a list of licences that all
 * apply. `MIT OR Apache-2.0` is two alternatives of one licence. Old crates
 * write `/` for `OR`. `A WITH B` stays one licence called "A WITH B", which is
 * allowed only if it is listed above; `+` is not understood. Both come back as
 * licences nobody allows, so the generator stops and asks for a look.
 * @param {string} expression
 * @returns {string[][]}
 */
export function alternatives(expression) {
  const tokens = expression
    .replaceAll("/", " OR ")
    .replaceAll("(", " ( ")
    .replaceAll(")", " ) ")
    .split(/\s+/)
    .filter((token) => token !== "");
  const result = parseOr(tokens);
  if (tokens.length > 0)
    throw new Error(`cannot read the licence expression "${expression}"`);
  return result;
}

/** @param {string[]} tokens */
function parseOr(tokens) {
  let result = parseAnd(tokens);
  while (tokens[0] === "OR") {
    tokens.shift();
    result = [...result, ...parseAnd(tokens)];
  }
  return result;
}

/** @param {string[]} tokens */
function parseAnd(tokens) {
  let result = parseAtom(tokens);
  while (tokens[0] === "AND") {
    tokens.shift();
    const right = parseAtom(tokens);
    result = result.flatMap((left) => right.map((r) => [...left, ...r]));
  }
  return result;
}

/**
 * @param {string[]} tokens
 * @returns {string[][]}
 */
function parseAtom(tokens) {
  const token = tokens.shift();
  if (token === "(") {
    const inside = parseOr(tokens);
    if (tokens.shift() !== ")") throw new Error("missing closing bracket");
    return inside;
  }
  if (token === undefined || [")", "OR", "AND"].includes(token))
    throw new Error("licence expression is cut short");
  if (tokens[0] !== "WITH") return [[token]];
  tokens.shift();
  const exception = tokens.shift();
  if (
    exception === undefined ||
    ["(", ")", "OR", "AND", "WITH"].includes(exception)
  )
    throw new Error("licence expression is cut short");
  return [[`${token} WITH ${exception}`]];
}

/** @param {string[]} alternative */
function allowed(alternative) {
  return alternative.every((license) => COMPATIBLE.has(license));
}

/**
 * Can the expression be met with licences that work in a GPL-3.0-or-later app?
 * One that cannot be read (or is empty) counts as no.
 * @param {string} expression
 */
export function isCompatible(expression) {
  try {
    return alternatives(expression).some(allowed);
  } catch {
    return false;
  }
}

/**
 * The expression with the options we do not take dropped, so `MIT OR
 * Apache-2.0 OR LGPL-2.1-or-later` becomes `MIT OR Apache-2.0`. An expression
 * that needs no choice comes back as written.
 * @param {string} expression
 */
export function chosenTerms(expression) {
  const options = alternatives(expression);
  if (options.every(allowed)) return expression.trim();
  const kept = options.filter(allowed);
  if (kept.length === 0) throw new Error(`no usable option in "${expression}"`);
  return kept.map((option) => option.join(" AND ")).join(" OR ");
}
