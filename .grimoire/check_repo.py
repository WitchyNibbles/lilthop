"""The repo as git sees it, for Grimoire's quality check. Standard library only.

What is listed and in scope, which projects exist, where the base commit is, and the settings that
belong to the repo rather than a project. Copied next to `check.py`, which loads it.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Literal

# The standard's version: the same in every module of it (check.py refuses a mismatch).
STANDARD_VERSION = 5


def git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True, check=False)


@dataclass(frozen=True)
class GitState:
    sha: str | None
    dirty: bool


def git_state(root: Path) -> GitState:
    """The short HEAD sha (None before the first commit) and whether the tree has changes."""
    head = git(root, "rev-parse", "--short=7", "HEAD")
    sha = head.stdout.strip() if head.returncode == 0 else None
    return GitState(sha=sha or None, dirty=bool(git(root, "status", "--porcelain").stdout.strip()))


def listing(root: Path) -> list[Path]:
    """Files git lists below root (tracked, or untracked and not ignored), relative to it."""
    listing = git(root, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
    return [Path(name) for name in listing.stdout.split("\0") if name and (root / name).is_file()]


def nested_roots(files: list[Path]) -> list[Path]:
    """Directories below the root that hold their own `pyproject.toml`: projects of their own."""
    return sorted(
        {
            path.parent
            for path in files
            if path.name == PYPROJECT and path.parent != Path() and not skipped_dir(path)
        }
    )


def project_files(
    root: Path, suffixes: tuple[str, ...], listing: list[Path] | None = None
) -> list[Path]:
    """The project's tracked and untracked-but-not-ignored files with these suffixes.

    Left out: `.grimoire/`, and the directories of Python projects nested below (their own
    project checks them). Pass `listing` (from `listing()`) to avoid asking git again.
    """
    files = all_files(root, listing)
    nested = nested_roots(files)
    return [
        root / path
        for path in files
        if path.parts[0] != STANDARD_DIR
        and path.suffix in suffixes
        and not any(path.is_relative_to(directory) for directory in nested)
    ]


OUT_OF_SCOPE_ATTRIBUTES = ("linguist-vendored", "linguist-generated")
OUT_OF_SCOPE_VALUES = ("set", "true")
PYTHON_SUFFIXES = (".py", ".pyi", ".ipynb")


def local_attributes(root: Path) -> str | None:
    """The repo's `info/attributes` path when it holds anything; git cannot be told to skip it."""
    where = git(root, "rev-parse", "--git-path", "info/attributes").stdout.strip()
    try:
        content = (root / where).read_text(encoding="utf-8", errors="replace") if where else ""
    except OSError:
        return None
    return where if content.strip() else None


def excluded_files(root: Path, files: list[Path]) -> set[Path]:
    """The files the committed `.gitattributes` mark `linguist-vendored` or `linguist-generated`.

    Attributes are read from HEAD's tree, so uncommitted `.gitattributes` edits do not count;
    global and system attributes files are ignored, and local ones fail the settings stage.
    """
    if not files or local_attributes(root):  # the settings stage rejects local attributes
        return set()
    names = [file.relative_to(root).as_posix() for file in files]
    command = ["git", "-c", "core.attributesFile=/dev/null", "check-attr", "--source=HEAD"]
    done = subprocess.run(
        [*command, "-z", "--stdin", *OUT_OF_SCOPE_ATTRIBUTES],
        cwd=root,
        env={**os.environ, "GIT_ATTR_NOSYSTEM": "1"},
        input="\0".join(names) + "\0",
        capture_output=True,
        text=True,
        check=False,
    )
    fields = done.stdout.split("\0")
    marked = {
        fields[i] for i in range(0, len(fields) - 2, 3) if fields[i + 2] in OUT_OF_SCOPE_VALUES
    }
    return {file for file, name in zip(files, names, strict=True) if name in marked}


PYPROJECT = "pyproject.toml"
STANDARD_DIR = ".grimoire"
# What `grimoire project` installs into the root `.grimoire/`; tool caches also land there.
# `__pycache__` is not one of them: Python may load bytecode found there in place of the source.
STANDARD_FILES = (
    "check.py",
    "check_python.py",
    "check_repo.py",
    "check_stages.py",
    "check_ts.py",
    "eslint.config.mjs",
    "grimoire_shard_plugin.py",
    "ruff.toml",
    "tsconfig.base.json",
)
TOOL_CACHES = frozenset((".ruff_cache", ".mypy_cache", ".pytest_cache"))
# A repo with a top-level `contracts/` directory also gets the contracts runtime in
# `.grimoire/lib/`: these files, relative to it, copied from grimoire's `src/`.
CONTRACTS_DIR: Final = "contracts"
LIB_DIR: Final = "lib"
CONTRACTS_LIB: tuple[str, ...] = (
    "dataproof/__init__.py",
    "dataproof/contracts/__init__.py",
    "dataproof/contracts/runtime/__init__.py",
    "dataproof/contracts/runtime/__main__.py",
    "dataproof/contracts/runtime/atomic.py",
    "dataproof/contracts/runtime/browser.py",
    "dataproof/contracts/runtime/cli.py",
    "dataproof/contracts/runtime/dispatch.py",
    "dataproof/contracts/runtime/errors.py",
    "dataproof/contracts/runtime/fixture.py",
    "dataproof/contracts/runtime/fixture_files.py",
    "dataproof/contracts/runtime/gate.py",
    "dataproof/contracts/runtime/har.py",
    "dataproof/contracts/runtime/lock.py",
    "dataproof/contracts/runtime/match.py",
    "dataproof/contracts/runtime/mtom.py",
    "dataproof/contracts/runtime/pages.py",
    "dataproof/contracts/runtime/patterns.py",
    "dataproof/contracts/runtime/portal.py",
    "dataproof/contracts/runtime/portal_cases.py",
    "dataproof/contracts/runtime/portal_dispatch.py",
    "dataproof/contracts/runtime/replay.py",
    "dataproof/contracts/runtime/resolver.py",
    "dataproof/contracts/runtime/scan.py",
    "dataproof/contracts/runtime/schema.py",
    "dataproof/contracts/runtime/schemas/soap-envelope-1.1.xsd",
    "dataproof/contracts/runtime/service.py",
    "dataproof/contracts/runtime/signature.py",
    "dataproof/contracts/runtime/structure.py",
    "dataproof/contracts/runtime/types.py",
    "dataproof/contracts/runtime/validate.py",
    "dataproof/contracts/runtime/values.py",
    "dataproof/contracts/runtime/wssec.py",
    "dataproof/contracts/runtime/xmlparse.py",
    "dataproof/contracts/runtime/xpaths.py",
    "dataproof/detectors.py",
    "dataproof/handles.py",
    "dataproof/identity.py",
    "dataproof/printable.py",
    "dataproof/smallcells.py",
    "dataproof/strictyaml.py",
    "dataproof/synth/__init__.py",
    "dataproof/synth/draws.py",
    "dataproof/synth/fakes.py",
    "dataproof/synth/words.txt",
)


# Directories the config walk never enters: git's own, virtualenvs and packages; and, at the
# project root only, the standard's own `.grimoire/`.
UNWALKED_DIRS = frozenset((".git", ".venv", "venv", "node_modules"))


def shown(paths: list[str], limit: int = 5) -> str:
    more = f" and {len(paths) - limit} more" if len(paths) > limit else ""
    return ", ".join(paths[:limit]) + more


def under(rel: Path, directories: list[Path]) -> bool:
    return any(directory == Path() or rel.is_relative_to(directory) for directory in directories)


def all_files(root: Path, listed: list[Path] | None) -> list[Path]:
    return listing(root) if listed is None else listed


def _installed(below: Path, name: str) -> bool:
    """Whether `.grimoire/<below>/<name>` is a file the standard installs."""
    return below == Path() and name in STANDARD_FILES


PYCACHE = "__pycache__"
# What can be imported from a directory on sys.path besides `.py` source; `.pth` counts too.
LOADABLE_SUFFIXES = (*PYTHON_SUFFIXES, ".pyc", ".pyo", ".pth", ".so", ".pyd")
# The bytecode CPython itself writes into `__pycache__`: `<module>.cpython-3XX[.opt-N].pyc`. Its
# name is no module name, so no import statement reaches it; a plain `x.pyc` there would be
# imported as `__pycache__.x`, `.grimoire/lib` being on sys.path.
CPYTHON_BYTECODE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\.cpython-3[0-9]+(?:\.opt-[12])?\.pyc")
NOT_BYTECODE = (
    f"not allowed (a {PYCACHE} in {STANDARD_DIR}/{LIB_DIR} holds only the bytecode Python writes, "
    "<module>.cpython-3XX.pyc)"
)


def _vendored(below: Path, name: str) -> str | None:
    """Why `.grimoire/<below>/<name>`, below `lib/` with a `contracts/` directory, may not be
    there; None for a file of the contracts runtime, and for what a `__pycache__` there may hold
    (S25): anything but loadable code, except the bytecode Python caches for the runtime."""
    if PYCACHE in below.parts:
        loadable = Path(name).suffix in LOADABLE_SUFFIXES
        return NOT_BYTECODE if loadable and not CPYTHON_BYTECODE.fullmatch(name) else None
    rel = (below / name).relative_to(LIB_DIR).as_posix()
    return None if rel in CONTRACTS_LIB else NOT_THE_RUNTIME


SYMLINK_PROBLEM = "not allowed (a symlink; the standard installs plain files)"
NOT_THE_RUNTIME = (
    f"not allowed ({STANDARD_DIR}/{LIB_DIR} holds only the contracts runtime, "
    f"for a {CONTRACTS_DIR}/ directory)"
)


def unowned_problems(root: Path) -> list[str]:
    """Files in the root `.grimoire/` the standard did not install: nothing checks them.

    Tool caches there may hold anything but Python source or notebooks. With a `contracts/`
    directory, `lib/` holds the contracts runtime (`CONTRACTS_LIB`) and its bytecode caches;
    without one it holds nothing. No symlink is allowed, and neither is a symlinked `.grimoire/`:
    the standard's files would be read from elsewhere.
    """
    top = root / STANDARD_DIR
    if top.is_symlink():
        return [f"{STANDARD_DIR}: {SYMLINK_PROBLEM}"]
    contracts = (root / CONTRACTS_DIR).is_dir()
    problems = {}
    for directory, subdirs, names in os.walk(top):
        here = Path(directory)
        below = here.relative_to(top)
        for name in (*subdirs, *names):
            rel = (here / name).relative_to(root).as_posix()
            if (here / name).is_symlink():
                problems[rel] = SYMLINK_PROBLEM
            elif name in names and (problem := _file_problem(below, name, contracts)):
                problems[rel] = problem
    return [f"{rel}: {problem}" for rel, problem in sorted(problems.items())]


def _file_problem(below: Path, name: str, contracts: bool) -> str | None:
    """Why the file `.grimoire/<below>/<name>` may not be there; None when it may."""
    if below.parts[:1] == (LIB_DIR,):
        return _vendored(below, name) if contracts else NOT_THE_RUNTIME
    cached = any(part in TOOL_CACHES for part in below.parts)
    if Path(name).suffix in PYTHON_SUFFIXES if cached else not _installed(below, name):
        return f"not allowed (the standard installs only {', '.join(STANDARD_FILES)})"
    return None


def attributes_problems(root: Path) -> list[str]:
    where = local_attributes(root)
    if where is None:
        return []
    return [f"{where}: not allowed (local git attributes can hide code from the check)"]


def own_worktrees(repo: Path) -> set[Path]:
    """The repo's linked worktrees, as git records them: other checkouts with their own check."""
    listed = git(repo, "worktree", "list", "--porcelain").stdout.splitlines()
    paths = {
        Path(line.removeprefix("worktree ")).resolve()
        for line in listed
        if line.startswith("worktree ")
    }
    return paths - {repo.resolve()}


def walk_problems(repo: Path, files: list[Path]) -> list[str]:
    """A `.grimoire/` below the repo root, and a `pyproject.toml` git does not list.

    The standard's files live in one `.grimoire/` at the repo root; a hidden `pyproject.toml`
    is still read by ruff and pytest, but no project check looks at it. The repo's own linked
    worktrees (such as `.worktrees/<branch>`) are other checkouts and are not walked.
    """
    known = {repo / path.parent for path in files if path.name == PYPROJECT}
    worktrees = own_worktrees(repo)
    problems = []
    for directory, subdirs, names in os.walk(repo):
        here = Path(directory)
        if STANDARD_DIR in subdirs and here != repo:
            rel = (here / STANDARD_DIR).relative_to(repo).as_posix()
            problems.append(f"{rel}: not allowed ({STANDARD_DIR}/ lives only at the repo root)")
        subdirs[:] = [
            name
            for name in subdirs
            if name not in (*UNWALKED_DIRS, STANDARD_DIR)
            and (here / name).resolve() not in worktrees
        ]
        if PYPROJECT in names and here not in known:
            rel = (here / PYPROJECT).relative_to(repo).as_posix()
            problems.append(f"{rel}: hidden from git; ruff and pytest read it")
    return sorted(problems)


def node_modules_problems(repo: Path) -> list[str]:
    """Each `node_modules` directory holding files git tracks: tsc reads them, no check does.

    Untracked files there (installed dependencies) are left alone.
    """
    tracked = git(repo, "ls-files", "-z", "--cached").stdout.split("\0")
    directories = set()
    for name in tracked:
        parts = Path(name).parts[:-1]
        if NODE_MODULES in parts:
            directories.add(Path(*parts[: parts.index(NODE_MODULES) + 1]).as_posix())
    return [
        f"{directory}: not allowed to hold tracked files (nothing checks them)"
        for directory in sorted(directories)
    ]


def repo_problems(repo: Path, listing: list[Path] | None = None) -> list[str]:
    """The settings problems that belong to the repo, not to one project."""
    return (
        attributes_problems(repo)
        + unowned_problems(repo)
        + walk_problems(repo, all_files(repo, listing))
        + node_modules_problems(repo)
    )


def outside_problems(repo: Path, projects: list[Project], listing: list[Path]) -> list[str]:
    """Source files no project covers: nothing would check them.

    Python files must sit below a Python project; TypeScript and JavaScript files, and the
    framework components the standard does not check yet, below a TypeScript project. Exempt: vendored and generated files (.gitattributes), the repo's
    `.grimoire/`, and TypeScript below `node_modules` (a Python file there is not exempt; tracked
    files there are a problem of their own, see `node_modules_problems`).
    """
    python = [p.root.relative_to(repo) for p in projects if p.kind == "python"]
    typescript = [p.root.relative_to(repo) for p in projects if p.kind == "typescript"]
    outside = [
        path
        for path in listing
        if (
            path.suffix in PYTHON_SUFFIXES
            and path.parts[0] != STANDARD_DIR
            and not under(path, python)
        )
        or (
            path.suffix in SCANNED_TS_SUFFIXES
            and not skipped_dir(path)
            and not under(path, typescript)
        )
    ]
    exempt = excluded_files(repo, [repo / path for path in outside])
    return [
        f"{path.as_posix()}: outside every project" for path in outside if repo / path not in exempt
    ]


# Directories no project is searched for in: dependencies, and the standard's own files.
NODE_MODULES = "node_modules"
SKIPPED_DIRS = (NODE_MODULES, STANDARD_DIR)
TS_CONFIG = "tsconfig.json"
PACKAGE_JSON = "package.json"
PNPM_WORKSPACE = "pnpm-workspace.yaml"
# Package manager by lockfile, in the order they are tried; `bun.lockb` is bun's older format.
LOCKFILES = (
    ("package-lock.json", "npm"),
    ("pnpm-lock.yaml", "pnpm"),
    ("yarn.lock", "yarn"),
    ("bun.lock", "bun"),
    ("bun.lockb", "bun"),
)


def skipped_dir(path: Path) -> bool:
    return any(part in SKIPPED_DIRS for part in path.parts[:-1])


@dataclass(frozen=True)
class Project:
    root: Path
    kind: Literal["python", "typescript"]
    manager: str | None  # the package manager of a TypeScript project; None without a lockfile


def _is_workspace(repo: Path, directory: Path, files: set[Path]) -> bool:
    """Whether the package.json declares `workspaces` (npm, yarn) or pnpm has a workspace file."""
    if directory / PNPM_WORKSPACE in files:
        return True
    try:
        data = json.loads((repo / directory / PACKAGE_JSON).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return isinstance(data, dict) and isinstance(data.get("workspaces"), list | dict)


def _typescript_dirs(repo: Path, files: set[Path]) -> list[Path]:
    """The TypeScript projects' directories: a workspace root takes in everything below it."""
    packages = {path.parent for path in files if path.name == PACKAGE_JSON}
    configured = {path.parent for path in files if path.name == TS_CONFIG} & packages
    workspaces = {
        directory
        for directory in packages
        if _is_workspace(repo, directory, files)
        and any(inner.is_relative_to(directory) for inner in configured)
    }
    candidates = configured | workspaces
    return sorted(
        directory
        for directory in candidates
        if not any(directory != outer and directory.is_relative_to(outer) for outer in workspaces)
    )


def _manager(repo: Path, directory: Path) -> str | None:
    return next((name for lock, name in LOCKFILES if (repo / directory / lock).is_file()), None)


def discover(repo: Path) -> list[Project]:
    """The repo's projects, sorted by path (a Python one before a TypeScript one in a directory).

    A Python project is a directory with `pyproject.toml`. A TypeScript project is a directory with
    `package.json` and `tsconfig.json`, except that an npm/yarn/pnpm workspace root is one project
    that takes in every package below it. `node_modules` and `.grimoire` are not searched.
    """
    files = {path for path in listing(repo) if not skipped_dir(path)}
    python = [
        Project(repo / path.parent, "python", None) for path in files if path.name == PYPROJECT
    ]
    typescript = [
        Project(repo / directory, "typescript", _manager(repo, directory))
        for directory in _typescript_dirs(repo, files)
    ]
    return sorted([*python, *typescript], key=lambda project: (project.root, project.kind))


def _resolves(root: Path, ref: str) -> bool:
    return git(root, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}").returncode == 0


DEFAULT_BRANCHES = ("origin/HEAD", "origin/main", "origin/master", "main", "master")


def _rev(root: Path, *args: str) -> str | None:
    done = git(root, *args)
    return (done.stdout.strip() or None) if done.returncode == 0 else None


def _merge_base(root: Path, ref: str) -> str | None:
    """The commit where HEAD's history meets `ref`'s, as a full sha."""
    if not _resolves(root, ref):
        return None
    return _rev(root, "merge-base", "HEAD", ref)


def _default_base(root: Path) -> str | None:
    """Where this branch left the default branch; HEAD~1 on the default branch or without one."""
    branch = next((ref for ref in DEFAULT_BRANCHES if _resolves(root, ref)), None)
    point = _merge_base(root, branch) if branch else None
    if point is not None and point != _rev(root, "rev-parse", "HEAD"):
        return point
    if branch is None:
        print("note: no default branch found; changed lines are measured from HEAD~1")
    return _rev(root, "rev-parse", "--verify", "--quiet", "HEAD~1^{commit}")


def short(root: Path, sha: str) -> str:
    return _rev(root, "rev-parse", "--short=7", sha) or sha[:7]


def resolve_base(root: Path, requested: str | None) -> str | None:
    """The commit to diff against: where HEAD meets the requested ref, else the default.

    A requested ref that does not resolve, or whose merge-base is HEAD itself (an empty diff,
    e.g. the default branch), gets the default path's fallback.
    """
    if requested is None:
        return _default_base(root)
    point = _merge_base(root, requested)
    if point is not None and point != _rev(root, "rev-parse", "HEAD"):
        return point
    fallback = _default_base(root)
    if fallback is not None:
        why = "not found" if point is None else "is HEAD itself"
        print(f"note: base {requested} {why}, using {short(root, fallback)}")
    return fallback


# An agent's name, or an address on one of its vendors' domains (whole domains, subdomains too).
_AGENT_NAME = r"\b(?:claude|codex|opencode|copilot)\b"
_AGENT_DOMAIN = r"(?:[\w-]+\.)*(?:anthropic\.com|openai\.com|opencode\.ai)(?=[>\s]|$)"
# A trailer names the agent before its `<address>`; a bullet that merely quotes one does not match.
ATTRIBUTION_LINE = re.compile(
    rf"^\s*co-authored-by:(?:[^<]*{_AGENT_NAME}|.*@{_AGENT_DOMAIN})"
    rf"|^\W*generated with\s+\[?{_AGENT_NAME}",
    re.IGNORECASE,
)
_LOG_FIELD = "\x1f"


def attribution_problems(root: Path, base: str | None) -> list[str]:
    """One problem per commit in `base..HEAD` whose message names an agent as author or tool.

    A `Co-authored-by:` trailer for an agent and a "Generated with <agent>" line are the lines
    agents add by default; a human co-author passes. Without a base there is nothing to compare.
    """
    if base is None:
        return []
    log = git(root, "log", "--reverse", "-z", f"--format=%h{_LOG_FIELD}%B", f"{base}..HEAD")
    if log.returncode != 0:
        reason = next(iter(log.stderr.strip().splitlines()), "git log failed")
        return [f"cannot read commit messages in {base}..HEAD: {reason}"]
    problems = []
    for entry in filter(None, log.stdout.split("\0")):
        sha, _, message = entry.partition(_LOG_FIELD)
        offending = next(
            (text for text in message.splitlines() if ATTRIBUTION_LINE.match(text)), None
        )
        if offending is not None:
            problems.append(f'commit {sha.strip()}: agent attribution line "{offending.strip()}"')
    return problems


def where(repo: Path, project: Project) -> str:
    """The project's directory below the repo root, `.` for the root itself."""
    return project.root.relative_to(repo).as_posix()


def prefixed(where: str, message: str) -> str:
    return message if where == "." else f"{where}: {message}"


TS_SUFFIXES = (".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs")
# Components of frameworks tsc and the base ESLint config do not read: scanned for suppressions,
# and a settings problem until the standard checks them.
FRAMEWORK_SUFFIXES = (".vue", ".svelte", ".astro")
SCANNED_TS_SUFFIXES = (*TS_SUFFIXES, *FRAMEWORK_SUFFIXES)
FRAMEWORK_PROBLEM = (
    "not checked by the standard yet (tsc and the base ESLint config do not cover it)"
)


@dataclass(frozen=True)
class TsFiles:
    """The files git lists in a TypeScript project, minus nested projects, `node_modules` and
    `.grimoire/`."""

    root: Path
    listed: list[Path]  # every such file (absolute)
    skipped: set[Path]  # the vendored and generated ones among them (.gitattributes)
    nested: list[Path]  # the TypeScript projects inside, checked on their own

    @classmethod
    def of(cls, project: Project, projects: list[Project]) -> TsFiles:
        root = project.root
        nested = [
            p.root
            for p in projects
            if p.kind == "typescript" and p.root != root and p.root.is_relative_to(root)
        ]
        listed = [
            root / path
            for path in listing(root)
            if not skipped_dir(path) and not any((root / path).is_relative_to(n) for n in nested)
        ]
        return cls(root, listed, excluded_files(root, listed), nested)

    def scanned(self) -> list[Path]:
        return [path for path in self.listed if path.suffix in SCANNED_TS_SUFFIXES]

    def skipped_count(self) -> int:
        """How many of the scanned files are vendored or generated."""
        return len([path for path in self.scanned() if path in self.skipped])

    def kept(self) -> list[Path]:
        """Below the root: the files the stages read."""
        return [path.relative_to(self.root) for path in self.listed if path not in self.skipped]

    def ignored(self, repo: Path) -> list[Path]:
        """Below the root: what ESLint leaves out (nested projects, skipped files, `.grimoire/`)."""
        skipped = [path for path in self.skipped if path.suffix in TS_SUFFIXES]
        paths = {path.relative_to(self.root) for path in (*self.nested, *skipped)}
        if self.root == repo:
            paths.add(Path(STANDARD_DIR))
        return sorted(paths)


def framework_problems(files: TsFiles) -> list[str]:
    """A settings problem for each framework component in the project (skipped ones aside)."""
    return [
        f"{path.relative_to(files.root).as_posix()}: {FRAMEWORK_PROBLEM}"
        for path in files.scanned()
        if path.suffix in FRAMEWORK_SUFFIXES and path not in files.skipped
    ]
