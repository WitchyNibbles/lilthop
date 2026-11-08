"""TypeScript and JavaScript parts of Grimoire's quality check. Standard library only.

Copied next to `check.py` into a repo's `.grimoire/`; `check.py` loads it from its own directory.
"""

from __future__ import annotations

import bisect
import importlib
import json
import os
import re
import shutil
import subprocess
import tempfile
from collections.abc import Callable, Iterable, Iterator
from pathlib import Path
from typing import TYPE_CHECKING, NamedTuple

if TYPE_CHECKING:
    import check_repo
    import check_stages
else:
    check_repo = importlib.import_module("grimoire_check_repo")
    check_stages = importlib.import_module("grimoire_check_stages")

# The standard's version: the same in every module of it (check.py refuses a mismatch).
STANDARD_VERSION = 5

# Lines end where ESLint and TypeScript end them: CR, LF, CRLF, U+2028 and U+2029. Unlike
# `str.splitlines()`, \x0b, \x0c and \x85 stay inside a line, as they do for those tools.
LINE_BREAK = re.compile("\r\n|[\r\n\u2028\u2029]")

# Text that switches a check, a rule or coverage off or reshapes it. There is no comment lexer: a
# string, a template literal, a regex literal or JSX holding one counts too, because telling them
# apart from a comment needs a full parser. `\s` also matches line breaks, so a marker split across
# the lines of a block comment is found, as the tools that read it find it.
TS_SUPPRESSIONS = re.compile(
    "|".join(
        (
            r"eslint-disable",  # every form: -line, -next-line, and the block form
            r"/\*\s*eslint(?:\s|$)",  # inline configuration: /* eslint rule: off */
            r"/\*\s*globals?\b",  # /* global x */ declares globals, hiding no-undef
            r"/\*\s*exported\b",  # /* exported x */ marks globals used, hiding no-unused-vars
            r"eslint-env",
            r"@ts-ignore",
            r"@ts-expect-error",
            r"@ts-nocheck",
            r"\bc8\s+ignore",
            r"\bv8\s+ignore",
            r"\bistanbul\s+ignore",
            r"node:coverage\s+(?:ignore|disable|enable)",
            r"prettier-ignore",
            r"biome-ignore",
            r"deno-lint-ignore",
            r"deno-fmt-ignore",  # and -file
            r"@noformat",  # Prettier's checkIgnorePragma skips a file that carries it
            r"@noprettier",
        )
    ),
    re.IGNORECASE,
)


def suppression_lines(text: str) -> list[tuple[int, str]]:
    """The 1-based number and stripped text of each line where suppression-like text starts."""
    starts = [0, *(match.end() for match in LINE_BREAK.finditer(text))]
    found = sorted(
        {bisect.bisect_right(starts, match.start()) for match in TS_SUPPRESSIONS.finditer(text)}
    )
    lines = LINE_BREAK.split(text)
    return [(number, lines[number - 1].strip()) for number in found]


# --- resolved settings -------------------------------------------------------

# How each package manager installs its lockfile; yarn's flag depends on its version.
INSTALL = {
    "npm": "npm ci",
    "pnpm": "pnpm install --frozen-lockfile",
    "yarn": "yarn install --frozen-lockfile",
    "bun": "bun install --frozen-lockfile",
}
# Yarn 2+ writes `__metadata:` into yarn.lock and wants --immutable; yarn 1 (`# yarn lockfile v1`)
# ignores --immutable and rewrites the lockfile, so it gets --frozen-lockfile, which yarn 2+ also
# reads (as a deprecated alias). A lockfile that says neither gets that one too.
YARN_BERRY_INSTALL = "yarn install --immutable"
YARN_BERRY_LOCK = re.compile(r"^__metadata:", re.MULTILINE)
LOCK_HEAD = 65536


# How each package manager adds dev dependencies (npm's own command is install; bun's flag is -d).
ADD_DEV = {
    "npm": "npm install -D",
    "pnpm": "pnpm add -D",
    "yarn": "yarn add -D",
    "bun": "bun add -d",
}


def install_command(root: Path, manager: str) -> str:
    """The command that installs the project's lockfile as it is (never updating it)."""
    if manager != "yarn":
        return INSTALL[manager]
    try:
        with (root / "yarn.lock").open(encoding="utf-8", errors="replace") as lock:
            head = lock.read(LOCK_HEAD)
    except OSError:
        return INSTALL[manager]
    return YARN_BERRY_INSTALL if YARN_BERRY_LOCK.search(head) else INSTALL[manager]


NODE = "node"
ESLINT_BASE = "eslint.config.mjs"
ESLINT_CONFIG = re.compile(r"eslint\.config\.[cm]?[jt]s")
LEGACY_ESLINT_CONFIG = re.compile(r"\.eslintrc(?:\..*)?")
REQUIRED_DEPENDENCIES = ("eslint", "prettier", "typescript", "typescript-eslint")
# The flags tsconfig.base.json turns on: each must resolve to true in every tsconfig.
BASE_FLAGS = (
    "strict",
    "noUncheckedIndexedAccess",
    "exactOptionalPropertyTypes",
    "noImplicitOverride",
    "noFallthroughCasesInSwitch",
    "noUnusedLocals",
    "noUnusedParameters",
)
# What `strict` turns on: turning one of them back off weakens `strict` itself.
STRICT_FLAGS = (
    "alwaysStrict",
    "noImplicitAny",
    "noImplicitThis",
    "strictBindCallApply",
    "strictBuiltinIteratorReturn",
    "strictFunctionTypes",
    "strictNullChecks",
    "strictPropertyInitialization",
    "useUnknownInCatchVariables",
)
# Rules the ESLint base turns on by name; checked even when the base itself resolves weaker.
NAMED_RULES = (
    "@typescript-eslint/ban-ts-comment",
    "@typescript-eslint/consistent-type-imports",
    "@typescript-eslint/switch-exhaustiveness-check",
    "complexity",
    "max-lines",
)
# The standard's ceiling for each limit (a lower one is stricter, so allowed), and ESLint's default
# when a config leaves it unset.
LIMITS = {"complexity": 10, "max-lines": 300}
DEFAULT_LIMITS = {"complexity": 20, "max-lines": 300}
SEVERITIES = {"off": 0, "warn": 1, "error": 2}
SEVERITY_NAMES = {0: "off", 1: "warn", 2: "error"}
OFF = 0
ERROR = 2
OUTPUT_LINES = 3
SHOWN_FILES = 3

# Resolves the ESLint config of every file in one Node process, with the project's own ESLint, and
# the standard's base for the same files; prints the groups of files that resolve alike, as JSON.
ESLINT_HELPER = r"""
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

// A config that prints must not corrupt the JSON this helper prints: everything else goes to stderr.
const print = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);
for (const name of ["log", "info", "debug"]) console[name] = console.error;

const require = createRequire(path.join(process.cwd(), "package.json"));
let ESLint;
try {
  ({ ESLint } = await import(pathToFileURL(require.resolve("eslint")).href));
} catch (error) {
  process.stderr.write(`cannot load ESLint: ${String(error).split("\n")[0]}\n`);
  process.exit(1);
}
let text = "";
for await (const chunk of process.stdin) text += chunk;
const request = JSON.parse(text);
const project = new ESLint({ cwd: process.cwd() });
const standard = new ESLint({ cwd: process.cwd(), overrideConfigFile: request.base });

async function resolve(eslint, file) {
  try {
    if (await eslint.isPathIgnored(file)) return { ignored: true };
    const config = await eslint.calculateConfigForFile(file);
    return config === undefined ? { ignored: true } : { config: JSON.parse(JSON.stringify(config)) };
  } catch (error) {
    return { error: String(error).split("\n")[0] };
  }
}

const groups = new Map();
for (const file of request.files) {
  const result = { project: await resolve(project, file), standard: await resolve(standard, file) };
  const key = JSON.stringify(result);
  if (!groups.has(key)) groups.set(key, { ...result, files: [] });
  groups.get(key).files.push(file);
}
// The project's other files: each must be linted too, though tsc does not compile it.
const unlinted = [];
for (const file of request.listed) {
  if ((await resolve(project, file)).ignored) unlinted.push(file);
}
const found = [...groups.values()];
if (unlinted.length > 0) found.push({ unlinted: true, files: unlinted });
print(JSON.stringify(found));
"""


# Inherited settings that change how Node, tsc, ESLint, typescript-eslint, Prettier, Vitest or c8
# load code, read their configuration or report results, checked against Node 24, typescript 6.0,
# eslint 10.11, typescript-eslint 8.71, prettier 3.9, vitest 5.0 and c8 12.0. Every Node tool the
# check runs gets the environment without them.
SCRUBBED_PREFIXES = (
    "NODE_",  # NODE_OPTIONS (--require, --import, --test-*), NODE_PATH, NODE_V8_COVERAGE,
    #           NODE_TEST_CONTEXT (makes node --test report to a parent), NODE_ENV, ...
    "ESLINT_",  # ESLINT_FLAGS (feature flags such as config lookup), ESLINT_USE_FLAT_CONFIG
    "TYPESCRIPT_ESLINT_",  # TYPESCRIPT_ESLINT_PROJECT_SERVICE and the error override
    "TSESTREE_",  # TSESTREE_SINGLE_RUN, TSESTREE_NO_INVALIDATION
    "TS_NODE_",  # ts-node and tsx: loaders a config could pull in
    "TSX_",
    "VITEST",  # VITEST, VITEST_MODE, VITEST_MODULE_DIRECTORIES, VITEST_MAX_WORKERS, ...
    "PRETTIER_",  # PRETTIER_EXPERIMENTAL_CLI swaps the CLI
    "npm_config_",  # npm_config_VITEST_MODULE_DIRECTORIES, and npm's own settings
    "NPM_CONFIG_",
)
SCRUBBED_NAMES = frozenset(
    (
        "UPDATE_SNAPSHOT",  # Vitest rewrites failing snapshots
        "VITE_USER_NODE_ENV",
        "EXPERIMENTAL_MONOCART",  # c8 swaps its coverage engine
        "FORCE_COLOR",  # output is read back: no colour
        "TIMING",  # ESLint appends a timing table
    )
)


def node_env() -> dict[str, str]:
    """The environment every Node tool runs with: the scrubbed settings gone, colour off."""
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in SCRUBBED_NAMES and not key.startswith(SCRUBBED_PREFIXES)
    }
    env["NO_COLOR"] = "1"
    return env


class ToolError(Exception):
    """A tool the settings are read with failed; the message says how."""


def _walk(root: Path, skip: Iterable[Path]) -> Iterator[tuple[Path, list[str]]]:
    """Each directory at or below `root` on disk (git ignore rules can hide a config), and its files.

    Not entered: `node_modules`, `.git`, virtualenvs, the root's `.grimoire/` and the directories in
    `skip` (the projects nested inside, checked on their own).
    """
    skipped = set(skip)
    for directory, subdirs, names in os.walk(root):
        here = Path(directory)
        unwalked = (
            {*check_repo.UNWALKED_DIRS, check_repo.STANDARD_DIR}
            if here == root
            else check_repo.UNWALKED_DIRS
        )
        subdirs[:] = sorted(d for d in subdirs if d not in unwalked and here / d not in skipped)
        yield here, sorted(names)


def tsconfigs(root: Path, skip: Iterable[Path] = ()) -> list[Path]:
    """Every tsconfig.json at or below `root`, found on disk."""
    config = check_repo.TS_CONFIG
    return [here / config for here, names in _walk(root, skip) if config in names]


def _stray_eslint_problems(root: Path, skip: Iterable[Path]) -> list[str]:
    """ESLint configs other than the project's own eslint.config.*: each could replace it."""
    problems = []
    for here, names in _walk(root, skip):
        for name in names:
            rel = (here / name).relative_to(root).as_posix()
            if LEGACY_ESLINT_CONFIG.fullmatch(name):
                problems.append(f"{rel}: not allowed (a legacy ESLint config)")
            elif ESLINT_CONFIG.fullmatch(name) and here != root:
                problems.append(
                    f"{rel}: not allowed (ESLint uses it in place of the project's config below it)"
                )
            elif name == "package.json" and "eslintConfig" in _json_object(here / name):
                problems.append(f"{rel} eslintConfig: not allowed (a legacy ESLint config)")
    return problems


def _json_object(path: Path) -> dict[str, object]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _shown(value: object) -> str:
    return "unset" if value is None else json.dumps(value)


def _declared(data: object) -> set[str]:
    """The packages a parsed package.json depends on, dev dependencies included."""
    names: set[str] = set()
    for key in ("devDependencies", "dependencies"):
        table = data.get(key) if isinstance(data, dict) else None
        if isinstance(table, dict):
            names.update(table)
    return names


def missing_dev_dependencies(root: Path) -> list[str]:
    """The packages the standard needs that the project's package.json does not declare, sorted.

    Raises OSError or ValueError when package.json cannot be read.
    """
    declared = _declared(json.loads((root / "package.json").read_text(encoding="utf-8")))
    coverage = "@vitest/coverage-v8" if "vitest" in declared else "c8"
    return sorted(name for name in (*REQUIRED_DEPENDENCIES, coverage) if name not in declared)


def _dependency_problems(root: Path, manager: str, where: str) -> list[str]:
    try:
        missing = missing_dev_dependencies(root)
    except (OSError, ValueError) as error:
        return [f"package.json: cannot be read ({type(error).__name__})"]
    if not missing:
        return []
    add = f"{ADD_DEV[manager]} {' '.join(missing)}"
    return [
        f"package.json: missing dev dependencies {', '.join(missing)} (run (in {where}): {add})"
    ]


PNP_FILES = (".pnp.cjs", ".pnp.loader.mjs", ".pnp.js")
NODE_MODULES_LINKER = re.compile(
    r"""^\s*nodeLinker\s*:\s*["']?node-modules["']?\s*$""", re.MULTILINE
)
PNP = "Yarn Plug'n'Play is not supported: set nodeLinker: node-modules"


def _plug_n_play(root: Path) -> bool:
    """Whether yarn installs this project with Plug'n'Play: its files are there, or yarn 2+ (it has
    a .yarnrc.yml) has no node_modules/.bin and is not told to link node_modules."""
    if any((root / name).exists() for name in PNP_FILES):
        return True
    rc = root / ".yarnrc.yml"
    if not rc.is_file() or (root / "node_modules" / ".bin").is_dir():
        return False
    try:
        return not NODE_MODULES_LINKER.search(rc.read_text(encoding="utf-8", errors="replace"))
    except OSError:
        return True


def tool_problems(root: Path, manager: str, where: str) -> list[str]:
    """Why the project's own tsc and eslint cannot be run (never fetched from the network)."""
    for program in (NODE, "bunx") if manager == "bun" else (NODE,):
        if shutil.which(program) is None:
            return [f"{program} not found on PATH (needed to read the resolved settings)"]
    if manager == "yarn" and _plug_n_play(root):
        return [PNP]
    bins = root / "node_modules" / ".bin"
    if not all((bins / tool).exists() for tool in ("tsc", "eslint")):
        return [f"dependencies not installed: run (in {where}): {install_command(root, manager)}"]
    return []


def _tool(root: Path, manager: str, tool: str) -> list[str]:
    """The project's installed tool, run directly: `yarn <tool>` (v1) frames what it prints."""
    return ["bunx", tool] if manager == "bun" else [str(root / "node_modules" / ".bin" / tool)]


def _output(
    root: Path, command: list[str], given: str | None = None, *, listing: bool = False
) -> str:
    """What a command prints, run from the project's directory; `given` is its standard input.

    A `listing` (tsc --listFilesOnly) that exits non-zero still counts when it lists files: tsc
    exits 1 over config diagnostics (such as TS5052) that the types stage reports anyway.
    """
    try:
        done = subprocess.run(
            command,
            cwd=root,
            input=given,
            stdin=subprocess.DEVNULL if given is None else None,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            env=node_env(),
            check=False,
        )
    except OSError as error:
        raise ToolError(f"cannot be run ({type(error).__name__})") from error
    if done.returncode != 0 and not (listing and _listed(done.stdout)):
        lines = [line.strip() for line in (done.stderr + done.stdout).splitlines() if line.strip()]
        raise ToolError(f"failed (exit {done.returncode}): {' | '.join(lines[:OUTPUT_LINES])}")
    return done.stdout


def _listed(output: str) -> list[Path]:
    """The absolute paths among the lines tsc printed (diagnostics are not paths)."""
    paths = (Path(line.strip()) for line in output.splitlines() if line.strip())
    return [path for path in paths if path.is_absolute()]


def _sources(root: Path, listed: str) -> list[Path]:
    """The project's own lintable files among those tsc lists (no packages, no TypeScript libs)."""
    real = root.resolve()
    found = []
    for path in (listed_path.resolve() for listed_path in _listed(listed)):
        if (
            path.suffix in check_repo.TS_SUFFIXES
            and path.is_relative_to(real)
            and "node_modules" not in path.relative_to(real).parts
        ):
            found.append(root / path.relative_to(real))
    return found


def references(config: Path, shown: dict[str, object]) -> list[Path]:
    """The tsconfig files a tsconfig's `references` name (a directory means its tsconfig.json)."""
    refs = shown.get("references")
    if not isinstance(refs, list):
        return []
    paths = [
        Path(os.path.normpath(config.parent / str(ref.get("path"))))
        for ref in refs
        if isinstance(ref, dict)
    ]
    return [path / check_repo.TS_CONFIG if path.is_dir() else path for path in paths]


def _show(root: Path, manager: str, config: Path) -> dict[str, object] | str:
    """The tsconfig as tsc resolves it (extends, comments and all), or why it cannot be read."""
    rel = config.relative_to(root).as_posix()
    try:
        shown = json.loads(_output(root, [*_tool(root, manager, "tsc"), "--showConfig", "-p", rel]))
    except ToolError as error:
        return f"{rel}: tsc --showConfig {error}"
    except ValueError:
        return f"{rel}: tsc --showConfig printed no JSON"
    return shown if isinstance(shown, dict) else f"{rel}: tsc --showConfig printed no JSON object"


def _is_solution(shown: dict[str, object]) -> bool:
    """A solution-style tsconfig compiles nothing itself, only refers to others (--showConfig
    drops an empty `files`)."""
    return not shown.get("files") and bool(shown.get("references"))


def _followed(
    root: Path, manager: str, skip: Iterable[Path]
) -> list[tuple[Path, dict[str, object] | str]]:
    """Each tsconfig.json found on disk, and every tsconfig one of them refers to whatever its name
    (as Vite's tsconfig.app.json), with what `_show` made of it."""
    pending = tsconfigs(root, skip)
    seen: set[Path] = set()
    followed: list[tuple[Path, dict[str, object] | str]] = []
    while pending:
        config = pending.pop(0)
        if config in seen or not config.is_relative_to(root) or not config.is_file():
            continue
        seen.add(config)
        shown = _show(root, manager, config)
        followed.append((config, shown))
        if isinstance(shown, dict):
            pending += references(config, shown)
    return followed


def _flag_problems(
    root: Path, manager: str, config: Path, shown: dict[str, object]
) -> tuple[list[str], list[Path]]:
    """A compiling tsconfig's flags as tsc resolves them, and the project files it compiles."""
    rel = config.relative_to(root).as_posix()
    tsc = _tool(root, manager, "tsc")
    options = shown.get("compilerOptions")
    options = options if isinstance(options, dict) else {}
    problems = [
        f"{rel} compilerOptions.{flag}: must be true (resolved: {_shown(options.get(flag))})"
        for flag in BASE_FLAGS
        if options.get(flag) is not True
    ]
    problems += [  # with strict off, --showConfig shows them all false: strict is named already
        f"{rel} compilerOptions.{flag}: must not be false (it weakens strict)"
        for flag in STRICT_FLAGS
        if options.get(flag) is False and options.get("strict") is True
    ]
    if options.get("noCheck") is True:
        problems.append(
            f"{rel} compilerOptions.noCheck: must not be true (it turns type checks off)"
        )
    try:
        files = _sources(root, _output(root, [*tsc, "--listFilesOnly", "-p", rel], listing=True))
    except ToolError as error:
        return [*problems, f"{rel}: tsc --listFilesOnly {error}"], []
    return problems, files


def _severity(entry: object) -> int | None:
    """A rule entry's (or a bare setting's) severity as a number; None when it is not one."""
    level = entry[0] if isinstance(entry, list) and entry else entry
    if isinstance(level, str):
        return SEVERITIES.get(level)
    return level if type(level) is int else None


def _limit_problem(rule: str, entry: list[object]) -> str | None:
    options = entry[1] if len(entry) > 1 else None
    limit: object = options
    if options is None:
        limit = DEFAULT_LIMITS[rule]
    elif isinstance(options, dict):
        variant = options.get("variant", "classic")
        if rule == "complexity" and variant != "classic":
            return f'ESLint rule {rule}: variant must be "classic" (resolved: {_shown(variant)})'
        limit = options.get("max", options.get("maximum", DEFAULT_LIMITS[rule]))
    if type(limit) is int and limit <= LIMITS[rule]:
        return None
    return f"ESLint rule {rule}: max must be at most {LIMITS[rule]} (resolved: {_shown(limit)})"


def _dict(value: object) -> dict[str, object]:
    return value if isinstance(value, dict) else {}


def _linter_problems(resolved: dict[str, object]) -> list[str]:
    options = _dict(resolved.get("linterOptions"))
    problems = []
    directives = options.get("reportUnusedDisableDirectives")
    if _severity(directives) != ERROR:
        problems.append(
            'ESLint linterOptions.reportUnusedDisableDirectives: must be "error" '
            f"(resolved: {_shown(directives)})"
        )
    if options.get("noInlineConfig") is not True:
        inline = _shown(options.get("noInlineConfig"))
        problems.append(f"ESLint linterOptions.noInlineConfig: must be true (resolved: {inline})")
    return problems


def _language_problems(resolved: dict[str, object], base: dict[str, object]) -> list[str]:
    """The processor, language, parser and projectService must be the standard's own."""
    processor = resolved.get("processor")
    problems = []
    if processor is not None and processor != base.get("processor"):
        problems.append(
            f"ESLint processor: must be {_shown(base.get('processor'))} (resolved: {_shown(processor)})"
        )
    options, base_options = (
        _dict(resolved.get("languageOptions")),
        _dict(base.get("languageOptions")),
    )
    settings = (
        ("language", resolved.get("language"), base.get("language")),
        ("languageOptions.parser", options.get("parser"), base_options.get("parser")),
        (
            "languageOptions.parserOptions.projectService",
            _dict(options.get("parserOptions")).get("projectService"),
            _dict(base_options.get("parserOptions")).get("projectService"),
        ),
    )
    for name, value, expected in settings:
        if value != expected:
            problems.append(
                f"ESLint {name}: must be {_shown(expected)} (resolved: {_shown(value)})"
            )
    return problems


def _rule_problem(name: str, entry: object, expected: object) -> str | None:
    """A rule must keep the standard's severity and options; a limit may only go lower."""
    required = ERROR if name in NAMED_RULES else _severity(expected)
    severity = _severity(entry)
    if required is None or not isinstance(entry, list) or severity is None or severity < required:
        want = SEVERITY_NAMES.get(required or ERROR)
        return f'ESLint rule {name}: must be "{want}" (resolved: {_shown(entry)})'
    if name in LIMITS:
        return _limit_problem(name, entry)
    if isinstance(expected, list) and entry[1:] != expected[1:]:
        return (
            f"ESLint rule {name}: options must be {_shown(expected[1:])} "
            f"(resolved: {_shown(entry[1:])})"
        )
    return None


def config_problems(resolved: dict[str, object], base: dict[str, object]) -> list[str]:
    """How a resolved ESLint config is weaker than, or differs from, the standard's.

    `base` is the standard's own config resolved for the same file: every rule it turns on must
    resolve to the same entry (`max-lines` and `complexity` may set a lower limit), and the named
    rules must be "error" even if the base were edited.
    """
    problems = [*_linter_problems(resolved), *_language_problems(resolved, base)]
    rules, base_rules = _dict(resolved.get("rules")), _dict(base.get("rules"))
    required = {*NAMED_RULES, *(name for name, e in base_rules.items() if _severity(e) != OFF)}
    for name in sorted(required):
        problem = _rule_problem(name, rules.get(name), base_rules.get(name))
        problems.extend([] if problem is None else [problem])
    return problems


def _files_label(root: Path, files: list[Path]) -> str:
    names = sorted(path.relative_to(root).as_posix() for path in files)
    more = f" and {len(names) - SHOWN_FILES} more" if len(names) > SHOWN_FILES else ""
    return ", ".join(names[:SHOWN_FILES]) + more


def _group_problems(root: Path, group: object) -> list[str]:
    """The problems of files that resolved alike, named by their files."""
    group = _dict(group)
    files = group.get("files")
    if not isinstance(files, list) or not files:
        raise ToolError("printed an unexpected group")
    label = _files_label(root, [Path(str(file)) for file in files])
    if group.get("unlinted") is True:
        return [f"{label}: ignored by ESLint"]
    project, standard = _dict(group.get("project")), _dict(group.get("standard"))
    if "error" in project:
        return [f"{label}: ESLint cannot resolve its config ({project['error']})"]
    if project.get("ignored"):
        return [f"{label}: ignored by ESLint but compiled by tsc"]
    if "error" in standard:
        return [f"{label}: the standard's ESLint config cannot be resolved ({standard['error']})"]
    if "config" not in standard:
        return [f"{label}: the standard's ESLint config does not lint it"]
    found = config_problems(_dict(project.get("config")), _dict(standard.get("config")))
    return [f"{label}: {problem}" for problem in found]


def _eslint_problems(
    root: Path, base: Path, files: list[Path], listed: Iterable[Path] = ()
) -> list[str]:
    """Every compiled file's resolved ESLint config, compared with the standard's for that file;
    and every other `listed` file ESLint ignores."""
    compiled = set(files)
    others = [str(file) for file in listed if file not in compiled]
    request = json.dumps(
        {"base": str(base), "files": [str(file) for file in files], "listed": others}
    )
    command = [NODE, "--input-type=module", "-e", ESLINT_HELPER]
    try:
        groups = json.loads(_output(root, command, request))
        if not isinstance(groups, list):
            raise ToolError("printed no JSON list")
        return [problem for group in groups for problem in _group_problems(root, group)]
    except ValueError:
        return ["resolving the ESLint configs printed no JSON"]
    except ToolError as error:
        return [f"resolving the ESLint configs {error}"]


def _compiled(root: Path, manager: str, skip: Iterable[Path]) -> tuple[list[str], list[Path]]:
    """Every followed tsconfig's problems, and the project files they compile."""
    problems: list[str] = []
    files: dict[Path, None] = {}
    for config, shown in _followed(root, manager, skip):
        if isinstance(shown, str):
            problems.append(shown)
        elif not _is_solution(shown):
            found, compiled = _flag_problems(root, manager, config, shown)
            problems += found
            files.update(dict.fromkeys(compiled))
    return problems, list(files)


class Inside(NamedTuple):
    """What a project holds that its settings check needs to know."""

    nested: tuple[Path, ...] = ()  # the projects inside it, verified on their own
    listed: tuple[Path, ...] = ()  # its TypeScript and JavaScript files git lists (no others count)


NOTHING_INSIDE = Inside()


class Settings(NamedTuple):
    problems: list[str]
    compiled: list[Path]  # the listed files the tsconfigs compile; empty when not read that far


def resolved_settings(
    root: Path,
    manager: str | None,
    standard: Path,
    where: str = ".",
    inside: Inside = NOTHING_INSIDE,
) -> Settings:
    """How the TypeScript project at `root` resolves weaker than the standard, or cannot be read;
    and the listed files its tsconfigs compile.

    Every tsconfig is resolved by the project's own `tsc --showConfig`; every file the tsconfigs
    compile that git lists (`inside.listed`) gets its ESLint config resolved by the project's
    ESLint and compared with what `standard/eslint.config.mjs` resolves to for that file. `where`
    names the project's directory in messages. ESLint must not ignore any of the `inside.listed`
    files either.
    """
    if manager not in INSTALL:
        return Settings(["no lockfile"], [])
    skip = list(inside.nested)
    problems = _dependency_problems(root, manager, where)
    base = standard / ESLINT_BASE
    if not base.is_file():
        problems.append(f"{standard.name}/{ESLINT_BASE}: missing (re-run grimoire project)")
    problems += tool_problems(root, manager, where)
    if problems:
        return Settings(problems, [])
    problems, compiled = _compiled(root, manager, skip)
    # Only files git lists: build output tsc reads (a workspace package's dist/*.d.ts) is the
    # project's, but git-ignored, and neither linted nor the project's to lint.
    listed = set(inside.listed)
    files = [path for path in compiled if path in listed]
    if not files and not problems:
        problems.append(f"no {check_repo.TS_CONFIG} compiles a source file in the project")
    problems += _stray_eslint_problems(root, skip)
    problems += _eslint_problems(root, base, files, inside.listed) if files else []
    return Settings(problems, files)


def settings_problems(
    root: Path,
    manager: str | None,
    standard: Path,
    where: str = ".",
    inside: Inside = NOTHING_INSIDE,
) -> list[str]:
    """`resolved_settings`' problems only."""
    return resolved_settings(root, manager, standard, where, inside).problems


# --- the stages ----------------------------------------------------------------

# Prettier gets the files by name, at most this many per run, to stay inside command-line limits.
CHUNK = 500


class Target(NamedTuple):
    """A TypeScript project the stages run in."""

    root: Path
    manager: str  # its package manager (a key of INSTALL)
    where: str  # its directory as messages name it, `.` for the repo's top
    tail: Callable[[str, str], None]  # shows a failed stage's output (check.py's own)


def _missing(target: Target, stage: str, tool: str) -> bool:
    """Say so and return True when the project's own `tool` is not installed."""
    if (target.root / "node_modules" / ".bin" / tool).exists():
        return False
    install = install_command(target.root, target.manager)
    print(f"{stage}: {tool} is not installed (run (in {target.where}): {install})")
    return True


def _run_project_tool(target: Target, tool: str, *args: str) -> tuple[int, str]:
    return _run(target.root, [*_tool(target.root, target.manager, tool), *args])


def _run(root: Path, command: list[str]) -> tuple[int, str]:
    """Run a Node tool from the project's directory: its exit code and combined output."""
    try:
        done = subprocess.run(
            command,
            cwd=root,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            env=node_env(),
            check=False,
        )
    except OSError as error:
        return 127, f"{command[0]}: cannot be run ({error})"
    return done.returncode, done.stdout + done.stderr


def _stage(target: Target, stage: str, commands: list[list[str]]) -> tuple[str, bool]:
    """Run each command; the stage fails, showing what the failing ones printed, if any fails."""
    runs = (_run(target.root, command) for command in commands)
    failed = [output for code, output in runs if code]
    if failed:
        target.tail(stage, "\n".join(failed))
        return "fail", False
    return "ok", True


def format_stage(target: Target, files: list[Path]) -> tuple[str, bool]:
    """`prettier --check` over the project's files (as below its root) that git lists.

    The list leaves out what the caller leaves out (vendored and generated files, nested projects,
    `.grimoire/`); Prettier skips the kinds of file it does not know. No repo setting can skip a
    file: an empty ignore file stands in for .prettierignore, and the pragma options that make
    Prettier pass over files (requirePragma, checkIgnorePragma) are switched off on the command
    line, which wins over every config file and its overrides.
    """
    if _missing(target, "format", "prettier"):
        return "fail", False
    names = [f"./{path.as_posix()}" for path in files]
    chunks = [names[i : i + CHUNK] for i in range(0, len(names), CHUNK)]
    with tempfile.TemporaryDirectory(prefix="grimoire-prettier-") as tmp:
        empty = Path(tmp) / "ignore"
        empty.write_text("", encoding="utf-8")
        prettier = [
            *_tool(target.root, target.manager, "prettier"),
            "--check",
            "--ignore-unknown",
            f"--ignore-path={empty}",
            "--no-require-pragma",
            "--no-check-ignore-pragma",
        ]
        return _stage(target, "format", [[*prettier, *chunk] for chunk in chunks])


# Characters ESLint's patterns (minimatch) read as globs; each is written as a class `[c]`.
PATTERN_CHARS = frozenset("*?[]{}()!+@")


def _pattern(path: Path) -> str:
    return "".join(f"[{char}]" if char in PATTERN_CHARS else char for char in path.as_posix())


def lint_stage(target: Target, ignored: list[Path]) -> tuple[str, bool]:
    """`eslint --max-warnings 0 .`, leaving out the paths (below the root) in `ignored`."""
    if _missing(target, "lint", "eslint"):
        return "fail", False
    patterns = [arg for path in ignored for arg in ("--ignore-pattern", _pattern(path))]
    eslint = [*_tool(target.root, target.manager, "eslint"), "--max-warnings", "0"]
    return _stage(target, "lint", [[*eslint, *patterns, "."]])


class TypesPlan(NamedTuple):
    """What the types stage runs, each tsconfig named from the project's directory."""

    built: list[str]  # given to one `tsc -b --force`: those no build outside their loop reaches
    checked: list[str]  # the tsconfigs that compile files and no build reaches: `tsc --noEmit -p`


def _reached(start: Path, refs: dict[Path, list[Path]]) -> set[Path]:
    """The tsconfigs `start` refers to, directly or through others."""
    pending, reached = list(refs.get(start, [])), set()
    while pending:
        config = pending.pop()
        if config not in reached:
            reached.add(config)
            pending += refs.get(config, [])
    return reached


def _types_plan(root: Path, shown: dict[Path, dict[str, object]]) -> TypesPlan:
    """The build and the checks that cover every tsconfig in `shown` (as `_show` read them)."""
    refs = {config: references(config, data) for config, data in shown.items()}
    builds = [config for config in shown if refs[config]]
    reach = {config: _reached(config, refs) for config in builds}
    # tsc -b builds what a tsconfig refers to: name only the tops, the builds no build outside
    # their own loop reaches (so every member of a loop no other build reaches is named).
    tops = [c for c in builds if not any(c in reach[o] and o not in reach[c] for o in builds)]
    built = set(builds).union(*reach.values())
    checked = [c for c, data in shown.items() if not _is_solution(data) and c not in built]
    return TypesPlan(
        [c.relative_to(root).as_posix() for c in tops],
        [c.relative_to(root).as_posix() for c in checked],
    )


def types_stage(target: Target, skip: Iterable[Path]) -> tuple[str, bool]:
    """tsc over every tsconfig the settings check follows; never tsconfig.json alone.

    The tsconfigs that refer to others (solution-style ones included) are built first, in one
    `tsc -b --force` that orders the projects and builds each once (writing their output, as the
    references and imports through a workspace package's `exports` need; --force, as a .tsbuildinfo
    newer than an edited source would otherwise pass it unchecked). Then each tsconfig that compiles
    files and no build reached is checked with `tsc --noEmit -p`.
    """
    if _missing(target, "types", "tsc"):
        return "fail", False
    passed = True
    shown: dict[Path, dict[str, object]] = {}
    for config, found in _followed(target.root, target.manager, skip):
        if isinstance(found, str):
            print(f"types: {found}")
            passed = False
        else:
            shown[config] = found
    if not any(not _is_solution(found) for found in shown.values()):
        if passed:
            print(f"types: no {check_repo.TS_CONFIG} compiles a source file in the project")
        return "fail", False
    plan = _types_plan(target.root, shown)
    runs = [(f"types ({rel})", ["--noEmit", "-p", rel]) for rel in plan.checked]
    if plan.built:  # first: the others may import what it builds
        runs.insert(0, (f"types (tsc -b {' '.join(plan.built)})", ["-b", "--force", *plan.built]))
    for label, args in runs:
        code, output = _run_project_tool(target, "tsc", *args)
        if code != 0:
            target.tail(label, output)
            passed = False
    return ("ok" if passed else "fail"), passed


def test_runner(root: Path) -> str | None:
    """The project's test runner: "vitest", or "c8" (c8 with node:test); None for anything else."""
    declared = _declared(_json_object(root / "package.json"))
    return next((runner for runner in ("vitest", "c8") if runner in declared), None)


NO_TEST_RUNNER = "no supported test runner (vitest or c8 + node:test)"
TAP_PASS = re.compile(r"^# pass (\d+)$", re.MULTILINE)
TAP_FAIL = re.compile(r"^# fail (\d+)$", re.MULTILINE)
LCOV = "lcov.info"


def _vitest_counts(report: Path) -> tuple[int, int] | None:
    """Passed and failed tests from Vitest's JSON report; None when it is missing or unreadable."""
    data = _json_object(report)
    passed, failed = data.get("numPassedTests"), data.get("numFailedTests")
    if type(passed) is int and type(failed) is int:
        return passed, failed
    return None


def _tap_counts(output: str) -> tuple[int, int] | None:
    """Passed and failed tests from node --test's TAP summary (the last one printed)."""
    passed, failed = TAP_PASS.findall(output), TAP_FAIL.findall(output)
    return (int(passed[-1]), int(failed[-1])) if passed and failed else None


class TestRun(NamedTuple):
    """What the tests stage runs."""

    mode: str  # "fast" or "full"
    paths: list[str]  # the named tests (fast mode), below the project's root
    out: Path  # where reports go; full mode leaves the lcov report in out/coverage
    base: str | None  # the commit changed lines are measured from (full mode)
    runner: str | None  # the project's test runner (see test_runner)


def _vitest_command(target: Target, tests: TestRun) -> list[str]:
    command = [
        *_tool(target.root, target.manager, "vitest"),
        "run",
        "--update=none",  # a missing snapshot fails, as in CI, instead of being written
        "--reporter=default",
        "--reporter=json",
        f"--outputFile.json={tests.out / 'vitest.json'}",
    ]
    if tests.mode == "fast":
        return [*command, "--passWithNoTests", *tests.paths]
    command += [
        "--coverage",
        "--coverage.reporter=lcov",
        f"--coverage.reportsDirectory={tests.out / 'coverage'}",
    ]
    return [*command, f"--coverage.changed={tests.base}"] if tests.base else command


def _node_test_command(target: Target, tests: TestRun) -> list[str]:
    node_test = [NODE, "--test", "--test-reporter=tap"]
    if tests.mode == "fast":  # no coverage in fast mode, as for Python
        return [*node_test, *tests.paths]
    c8 = [
        *_tool(target.root, target.manager, "c8"),
        "--reporter=lcov",
        f"--report-dir={tests.out / 'coverage'}",
        f"--temp-directory={tests.out / 'c8'}",
    ]
    return [*c8, *node_test]


def tests_stage(target: Target, tests: TestRun) -> tuple[str, bool]:
    """The named tests (fast) or the whole suite with coverage into `out/coverage` (full).

    Vitest runs `vitest run`; c8 runs `node --test` under c8 (plain `node --test` in fast mode).
    """
    runner = tests.runner
    if tests.mode == "fast" and not tests.paths:
        return "0", True
    if runner is None:
        print(f"tests: {NO_TEST_RUNNER}")
        return "fail", False
    if _missing(target, "tests", runner):
        return "fail", False
    tests.out.mkdir(parents=True, exist_ok=True)
    if runner == "vitest":
        code, output = _run(target.root, _vitest_command(target, tests))
        counts = _vitest_counts(tests.out / "vitest.json")
    else:
        code, output = _run(target.root, _node_test_command(target, tests))
        counts = _tap_counts(output)
    if code == 0 and counts is None:
        print(f"tests: {runner} exited 0 without a result summary")
    elif code == 0 and counts is not None and counts[1] == 0:
        if tests.mode == "full" and counts[0] == 0:
            print("tests: no tests ran (full mode needs at least one passing test)")
        else:
            return str(counts[0]), True
    target.tail("tests", output)
    return "fail", False


# --- changed-line coverage -----------------------------------------------------

# Test files by the runners' own conventions. Both runners' coverage leaves out `test/`, `tests/`
# and `__tests__/` directories; by name, Vitest's default include (*.test.*, *.spec.*), and
# node --test's defaults (*.test.*, *-test.*, *_test.*, test-*.*, test.*).
TEST_DIRS = frozenset(("test", "tests", "__tests__"))
VITEST_TEST = re.compile(r"\.(?:test|spec)\.[cm]?[jt]sx?$")
NODE_TEST = re.compile(r"(?:[.\-_]test\.[^.]+|^test-.+\.[^.]+|^test\.[^.]+)$")
# Code no test is expected to load: declaration files, and the configs of these tools only
# (`<tool>.config.<ext>`, at any depth). Any other `*.config.*` file is the project's own code.
TOOL_CONFIGS = (
    "astro",
    "babel",
    "c8",
    "commitlint",
    "cypress",
    "eslint",
    "jest",
    "next",
    "nuxt",
    "nyc",
    "playwright",
    "postcss",
    "prettier",
    "rollup",
    "stylelint",
    "svelte",
    "tailwind",
    "tsup",
    "vite",
    "vitest",
    "webpack",
)
NOT_SOURCE = re.compile(
    r"(?:^(?:" + "|".join(TOOL_CONFIGS) + r")\.config\.[cm]?[jt]s|\.d\.[cm]?ts)$"
)


def is_test_file(rel: Path, runner: str) -> bool:
    if TEST_DIRS.intersection(rel.parts[:-1]):
        return True
    return bool((VITEST_TEST if runner == "vitest" else NODE_TEST).search(rel.name))


# Which files hold code that runs, as the project's TypeScript compiles them one by one: a file of
# only types compiles to nothing, is never loaded, and so never shows in a coverage report.
RUNTIME_HELPER = r"""
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(path.join(process.cwd(), "package.json"));
let ts;
try {
  ts = require("typescript");
} catch (error) {
  process.stderr.write(`cannot load typescript: ${String(error).split("\n")[0]}\n`);
  process.exit(1);
}
let text = "";
for await (const chunk of process.stdin) text += chunk;
const nothing = /^(?:\s|"use strict";|'use strict';|export\s*\{\s*\};)*$/;
const options = {
  module: ts.ModuleKind.ESNext,
  target: ts.ScriptTarget.ESNext,
  jsx: ts.JsxEmit.Preserve,
  removeComments: true,
};
const running = JSON.parse(text).filter((file) => {
  const source = readFileSync(file, "utf8");
  const { outputText } = ts.transpileModule(source, { fileName: file, compilerOptions: options });
  return !nothing.test(outputText);
});
process.stdout.write(JSON.stringify(running));
"""


def _runtime_code(root: Path, files: list[Path]) -> list[Path]:
    """The files (below root) that compile to code that runs; raises ToolError when unknown."""
    request = json.dumps([str(root / rel) for rel in files])
    output = _output(root, [NODE, "--input-type=module", "-e", RUNTIME_HELPER], request)
    try:
        running = json.loads(output)
    except ValueError as error:
        raise ToolError("printed no JSON") from error
    if not isinstance(running, list):
        raise ToolError("printed no JSON list")
    names = {str(name) for name in running}
    return [rel for rel in files if str(root / rel) in names]


def rewrite_lcov(root: Path, lcov: Path, target: Path, repo: Path) -> set[Path] | None:
    """Write `lcov` to `target` with each file named from the repo's top, as diff-cover reads it;
    return the files it measures (resolved), or None when it cannot be read.

    Vitest and c8 name files from the project's directory; diff-cover takes lcov paths to start at
    the git root.
    """
    try:
        lines = lcov.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return None
    top = repo.resolve()
    measured: set[Path] = set()
    written = []
    for line in lines:
        if not line.startswith("SF:"):
            written.append(line)
            continue
        path = (root / line[3:].strip()).resolve()
        measured.add(path)
        written.append(f"SF:{Path(os.path.relpath(path, top)).as_posix()}")
    target.write_text("\n".join(written) + "\n", encoding="utf-8")
    return measured


def coverage_gap(root: Path, runner: str, changed: list[Path], measured: set[Path]) -> str | None:
    """Why the report cannot vouch for the changed files (below root), or None when it can.

    Every changed source file that holds code that runs must be in the report: diff-cover reads a
    file that is absent as having no lines to cover, and the runners' coverage settings (Vitest's
    coverage include and exclude; c8's config, .c8rc, .nycrc or package.json "c8") can leave one
    out, as can a file no test loads.
    """
    sources = [
        rel for rel in changed if not is_test_file(rel, runner) and not NOT_SOURCE.search(rel.name)
    ]
    if not sources:
        return None
    try:
        running = _runtime_code(root, sources)
    except ToolError as error:
        return (
            f"cannot tell which changed files hold code that runs (the TypeScript helper {error})"
        )
    missing = sorted(rel.as_posix() for rel in running if (root / rel).resolve() not in measured)
    if not missing:
        return None
    shown = ", ".join(missing[:5]) + (f" and {len(missing) - 5} more" if len(missing) > 5 else "")
    return (
        f"not measured: {shown} (changed, but absent from the coverage report; "
        "no test loads it, or the runner's coverage settings leave it out)"
    )


# --- the project's stages, as check.py runs them -------------------------------


def scan_ts(path: Path) -> list[check_stages.Suppression]:
    """Suppression-like lines in a TypeScript or JavaScript file; strings count too."""
    text = path.read_bytes().decode("utf-8", errors="replace")
    return [
        check_stages.Suppression(path, number, line) for number, line in suppression_lines(text)
    ]


def ts_suppressions(
    project: check_repo.Project, files: list[Path], skipped: set[Path]
) -> tuple[int, bool]:
    root = project.root
    found: list[check_stages.Suppression] = []
    readable = True
    for path in files:
        if path in skipped:
            continue
        try:
            found.extend(scan_ts(path))
        except OSError:  # gone or unreadable since git listed it
            readable = False
            print(f"{path.relative_to(root).as_posix()}: unreadable (suppressions not counted)")
    for hit in found:
        print(f"{hit.path.relative_to(root).as_posix()}:{hit.line}: {hit.text}")
    return len(found), readable and not found


def ts_settings_problems(
    project: check_repo.Project,
    repo: Path,
    nested: Iterable[Path] = (),
    listed: Iterable[Path] = (),
) -> list[str]:
    """How a TypeScript project's resolved tsconfig and ESLint settings are weaker than the standard.

    Runs the project's installed tools. `repo` is the repo's top directory, which holds `.grimoire/`;
    `nested` are the TypeScript projects inside the project, verified on their own; `listed` are its
    TypeScript and JavaScript files git lists, which ESLint must lint whether tsc compiles them or not.
    """
    return settings_problems(
        project.root,
        project.manager,
        repo / check_repo.STANDARD_DIR,
        check_repo.where(repo, project),
        Inside(tuple(nested), tuple(listed)),
    )


def _ts_settings_stage(
    project: check_repo.Project, repo: Path, files: check_repo.TsFiles
) -> check_stages.Outcome:
    listed = [project.root / rel for rel in files.kept() if rel.suffix in check_repo.TS_SUFFIXES]
    problems = ts_settings_problems(project, repo, files.nested, listed)
    problems += check_repo.framework_problems(files)
    for problem in problems:
        print(f"settings: {problem}")
    return ("fail", False) if problems else ("ok", True)


def _changed_ts(project: check_repo.Project, base: str, files: check_repo.TsFiles) -> list[Path]:
    """TypeScript and JavaScript files (below the project's root) changed since `base`."""
    done = check_repo.git(
        project.root, "diff", "--name-only", "--relative", "-z", "--diff-filter=ACMR", base
    )
    changed = {Path(name) for name in done.stdout.split("\0") if name}
    return [rel for rel in files.kept() if rel in changed and rel.suffix in check_repo.TS_SUFFIXES]


def _ts_coverage_stage(
    project: check_repo.Project,
    run: check_stages.Run,
    out: Path,
    files: check_repo.TsFiles,
    runner: str | None,
) -> check_stages.Outcome:
    if run.mode == "fast":
        return "skip", True
    if run.base is None:
        print("note: no base commit to compare; changed-line coverage skipped")
        return "skip", True
    lcov = out / "coverage" / LCOV
    measured = rewrite_lcov(project.root, lcov, out / LCOV, run.repo)
    if measured is None:
        print("coverage: no coverage report was written (see the tests stage)")
        return "fail", False
    if runner is None:  # the setup checks refuse such a project; the tests stage said so too
        print(f"coverage: {NO_TEST_RUNNER}")
        return "fail", False
    gap = coverage_gap(project.root, runner, _changed_ts(project, run.base, files), measured)
    if gap is not None:
        print(f"coverage: {gap}")
        return "fail", False
    return check_stages.changed_line_coverage(project.root, run.base, out / LCOV, locked=False)


def typescript_stages(
    project: check_repo.Project,
    run: check_stages.Run,
    projects: list[check_repo.Project],
    paths: list[str],
    out: Path,
) -> check_stages.Stages:
    files = check_repo.TsFiles.of(project, projects)
    scanned = files.scanned()
    settings = _ts_settings_stage(project, run.repo, files)
    suppressions = ts_suppressions(project, scanned, files.skipped)
    skipped = files.skipped_count()
    if project.manager is None:  # the setup checks refuse such a project; settings said so too
        failed: check_stages.Outcome = ("fail", False)
        return check_stages.Stages(
            settings, suppressions, failed, failed, failed, failed, failed, skipped
        )
    target = Target(
        project.root, project.manager, check_repo.where(run.repo, project), check_stages.show_tail
    )
    runner = test_runner(project.root)
    tests = TestRun(run.mode, paths, out, run.base, runner)
    formatted = format_stage(target, files.kept())
    # Types run before the lint: its build writes what the type-aware lint resolves imports to
    # (a workspace package's `exports` point at its build output, absent from a fresh clone).
    types = types_stage(target, files.nested)
    return check_stages.Stages(
        settings=settings,
        suppressions=suppressions,
        format=formatted,
        lint=lint_stage(target, files.ignored(run.repo)),
        types=types,
        tests=tests_stage(target, tests),
        coverage=_ts_coverage_stage(project, run, out, files, runner),
        skipped=skipped,
    )
