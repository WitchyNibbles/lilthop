"""Grimoire's quality check, copied into project repos. Standard library only."""

from __future__ import annotations

import argparse
import functools
import importlib.machinery
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from types import CodeType, ModuleType
from typing import TYPE_CHECKING

# tomllib is imported where it is used, so an older Python still gets a receipt.
MINIMUM_PYTHON = (3, 11)

# The standard's version, the same literal in every module of it. It goes up whenever a name one
# module uses from another is added, removed, or changes meaning or signature.
STANDARD_VERSION = 5
# The siblings loaded when the check starts, in dependency order. check_ts.py loads only when a
# TypeScript project needs it.
EAGER = ("check_repo", "check_stages", "check_python")
SIBLING_PREFIX = "grimoire_"
# What loading a broken or stale sibling raises, its module code included. Anything else is a bug
# in the standard and keeps its traceback.
LOAD_ERRORS = (
    OSError,
    SyntaxError,
    ValueError,
    ImportError,
    NameError,
    AttributeError,
    TypeError,
    LookupError,
    RuntimeError,
)


class StandardMismatchError(ImportError):
    """A sibling's `STANDARD_VERSION` differs from this script's, or is missing."""


class _SourceOnlyLoader(importlib.machinery.SourceFileLoader):
    """Compiles the source on every load: never reads or writes `__pycache__`.

    Bytecode there (an unchecked-hash .pyc) would otherwise stand in for the source, and a cache
    written into the repo's `.grimoire/` would make the tree dirty.
    """

    def get_code(self, fullname: str) -> CodeType:
        path = self.get_filename(fullname)
        return self.source_to_code(self.get_data(path), path)


# This script's eager siblings by name, once they have loaded.
_EAGER: dict[str, ModuleType] = {}


def _load(name: str, needs: tuple[str, ...] = ()) -> ModuleType:
    """The sibling `<name>.py` next to this script, registered in sys.modules as `grimoire_<name>`.

    Next to the script's own path, symlinks not followed: a symlinked `.grimoire/check.py` is a
    settings problem, and it still uses the `.grimoire/` siblings. This script's own siblings are
    registered again first, so the one loaded now binds to them even when another copy of the
    standard loaded since. One registered from the same file is reused; one from another file is
    replaced. Raises FileNotFoundError when the file is missing, AttributeError when it lacks one
    of the functions it `needs`, and StandardMismatchError when it is from another version of the
    standard.
    """
    for loaded, module in _EAGER.items():
        sys.modules[SIBLING_PREFIX + loaded] = module
    key = SIBLING_PREFIX + name
    source = str(Path(__file__).absolute().with_name(f"{name}.py"))
    known = sys.modules.get(key)
    if known is not None and getattr(known, "__file__", None) == source:
        return known
    loader = _SourceOnlyLoader(key, source)
    fresh = ModuleType(key)
    fresh.__file__ = source
    # Registered while it runs, as an import does (a dataclass looks its module up there), and
    # put back as it was when it fails, so a broken or stale sibling is never left registered.
    sys.modules[key] = fresh
    try:
        loader.exec_module(fresh)
        _check_usable(name, fresh, needs)
    except BaseException:
        if known is None:
            del sys.modules[key]
        else:
            sys.modules[key] = known
        raise
    return fresh


def _check_usable(name: str, module: ModuleType, needs: tuple[str, ...]) -> None:
    """Raises when the sibling cannot be used.

    AttributeError when it lacks a function it needs, then StandardMismatchError when it is from
    another version of the standard.
    """
    for function in needs:
        if not callable(getattr(module, function, None)):
            raise AttributeError(f"{name}.py has no {function}")
    if getattr(module, "STANDARD_VERSION", None) != STANDARD_VERSION:
        raise StandardMismatchError(f"{name}.py is from another version of the standard")


def _load_problem(name: str, error: BaseException) -> str:
    """The setup error for a sibling that cannot be used."""
    # Spelled out, not check_repo.STANDARD_DIR: check_repo.py may be the file that failed.
    path = f".grimoire/{name}.py"
    if isinstance(error, StandardMismatchError):
        return f"{path}: from another version of the standard; re-run grimoire project"
    return f"{path}: cannot be loaded ({type(error).__name__}); re-run grimoire project"


def _load_eager() -> tuple[dict[str, ModuleType], str | None]:
    """The eager siblings by name, and the setup error of the first that cannot be used.

    Loading stops at that one; the error is None when every sibling loaded.
    """
    loaded: dict[str, ModuleType] = {}
    for name in EAGER:
        try:
            module = _load(name)
        except LOAD_ERRORS as error:
            return loaded, _load_problem(name, error)
        loaded[name] = module
    return loaded, None


_EAGER, LOAD_PROBLEM = _load_eager()

if TYPE_CHECKING:
    import check_python
    import check_repo
    import check_stages
else:
    check_python = _EAGER.get("check_python")
    check_repo = _EAGER.get("check_repo")
    check_stages = _EAGER.get("check_stages")


def _yes_no(value: bool) -> str:
    return "yes" if value else "no"


@dataclass
class Receipt:
    mode: str
    exit: int
    sha: str | None
    dirty: bool
    projects: int = 0
    settings: str = "fail"
    suppressions: int = 0
    # Vendored/generated files left out of scope (.gitattributes).
    skipped: int = 0
    format: str = "fail"
    lint: str = "fail"
    types: str = "fail"
    tests: int | str = "fail"
    coverage: str = "fail"
    # The contracts gate: "none" without a `contracts/` directory, else "ok" or "fail".
    contracts: str = "none"
    # The bench gate: "off", "ci", "pass" or "fail" in full mode, "-" in fast and shard modes.
    bench: str = "-"
    # The commit changed lines are measured from: a 7-char sha, "none", or "-" in fast mode.
    base: str = "-"
    runner: str = "uv"
    error: str | None = None
    # `I/N`, in shard mode only.
    shard: str = ""

    @classmethod
    def setup_error(cls, mode: str, sha: str | None, dirty: bool, error: str) -> Receipt:
        return cls(mode, 2, sha, dirty, error=error)

    def line(self) -> str:
        sha = self.sha or "none"
        head = f"CHECK {self.mode} exit={self.exit} sha={sha} dirty={_yes_no(self.dirty)}"
        if self.error is not None:
            return f'{head} error="{self.error}"'
        if self.mode == "shard":
            return (
                f"{head} shard={self.shard} projects={self.projects} tests={self.tests} "
                f"runner={self.runner}"
            )
        return (
            f"{head} projects={self.projects} settings={self.settings} "
            f"suppressions={self.suppressions} skipped={self.skipped} format={self.format} "
            f"lint={self.lint} types={self.types} tests={self.tests} coverage={self.coverage} "
            f"contracts={self.contracts} bench={self.bench} base={self.base} runner={self.runner}"
        )


MAX_SHARDS = 64


def _shard_spec(value: str) -> tuple[int, int]:
    """`I/N` as (I, N), with 1 <= I <= N <= 64."""
    found = re.fullmatch(r"([0-9]+)/([0-9]+)", value)
    if found is None or not 1 <= int(found.group(1)) <= int(found.group(2)) <= MAX_SHARDS:
        raise argparse.ArgumentTypeError(
            f"{value!r}: want I/N with whole numbers and 1 <= I <= N <= {MAX_SHARDS}"
        )
    return int(found.group(1)), int(found.group(2))


def _parse(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="check.py", description="Grimoire quality check.")
    modes = parser.add_subparsers(dest="mode", required=True)
    fast = modes.add_parser("fast", help="format, lint, types and the named tests")
    fast.add_argument("paths", nargs="*", metavar="TEST_PATH")
    full = modes.add_parser("full", help="everything, plus changed-line coverage")
    full.add_argument(
        "--base",
        default=None,
        help="ref to diff against (default: where HEAD left the default branch)",
    )
    full.add_argument(
        "--shards",
        type=Path,
        default=None,
        metavar="DIR",
        help="take the Python tests and their coverage from the results of `shard` in DIR/*/",
    )
    modes.add_parser("install", help="install every project's locked dependencies")
    shard = modes.add_parser(
        "shard", help="run slice I of N of every Python project's tests, with coverage data"
    )
    shard.add_argument("shard", metavar="I/N", type=_shard_spec)
    shard.add_argument(
        "--out", required=True, type=Path, help="directory for result.json and the coverage data"
    )
    args, extra = parser.parse_known_args(argv)
    if args.mode in ("full", "install", "shard") and extra:
        parser.error(f"unrecognized arguments: {' '.join(extra)}")
    if args.mode == "fast":
        args.paths = [*args.paths, *extra]  # options among them are refused with a receipt
    return args


def _python_version_error() -> str | None:
    found = sys.version_info[:2]
    if found >= MINIMUM_PYTHON:
        return None
    need = ".".join(map(str, MINIMUM_PYTHON))
    rerun = ["uv", "run", "--no-project", "--python", f">={need}", "python", ".grimoire/check.py"]
    return (
        f"Python {need} or newer is needed (found {'.'.join(map(str, found))});"
        f" with uv: {shlex.join([*rerun, *sys.argv[1:]])}"
    )


# pytest reads `@file` arguments as more options, so they are refused like `-` ones.
OPTION_PREFIXES = ("-", "@")


def _has_uv_lock(repo: Path, project: check_repo.Project) -> bool:
    """A `uv.lock` in the project's directory, or in the directory of a uv workspace above it."""
    if (project.root / "uv.lock").is_file():
        return True
    return any(
        (directory / "uv.lock").is_file() and _is_uv_workspace(directory)
        for directory in project.root.parents
        if directory.is_relative_to(repo)
    )


def _is_uv_workspace(directory: Path) -> bool:
    try:
        data = check_python.load_toml(directory / check_repo.PYPROJECT)
    except (OSError, check_python.toml_error(), UnicodeDecodeError):
        return False
    tool = check_python.table(data, "tool")
    return "workspace" in check_python.table(tool, "uv")


def _lock_problem(repo: Path, project: check_repo.Project) -> str | None:
    if project.kind == "python" and not _has_uv_lock(repo, project):
        return "no uv.lock (the standard supports uv projects)"
    if project.kind == "typescript" and project.manager is None:
        return "no lockfile"
    return None


def _owner(
    cwd: Path, projects: list[check_repo.Project], path: str
) -> tuple[check_repo.Project, str] | None:
    """The project a test path belongs to, and the path as seen from that project's root.

    The deepest project holding the path wins; where a Python and a TypeScript project share that
    directory, a script suffix decides. A `::node` part of a pytest id is kept.
    """
    name, separator, node = path.partition("::")
    target = Path(os.path.normpath(cwd / name))
    holding = [project for project in projects if target.is_relative_to(project.root)]
    if not holding:
        return None
    depth = max(len(project.root.parts) for project in holding)
    here = [project for project in holding if len(project.root.parts) == depth]
    prefer = "typescript" if target.suffix in check_repo.TS_SUFFIXES else "python"
    project = next((p for p in here if p.kind == prefer), here[0])
    return project, target.relative_to(project.root).as_posix() + separator + node


def _routes(
    cwd: Path, projects: list[check_repo.Project], paths: list[str]
) -> dict[check_repo.Project, list[str]]:
    routes: dict[check_repo.Project, list[str]] = {}
    for path in paths:
        owner = _owner(cwd, projects, path)
        if owner is not None:
            routes.setdefault(owner[0], []).append(owner[1])
    return routes


def _setup_problem(
    repo: Path, cwd: Path, projects: list[check_repo.Project], args: argparse.Namespace
) -> str | None:
    """Why the checks cannot run here, or None when they can."""
    version = _python_version_error()
    if version is not None:
        return version
    paths = getattr(args, "paths", [])
    if any(path.startswith(OPTION_PREFIXES) for path in paths):
        return "test paths only, no pytest options"
    if not projects:
        return (
            "no Python project found"
            if args.mode == "shard"
            else "no Python or TypeScript project found"
        )
    for project in projects:
        problem = _lock_problem(repo, project)
        if problem is not None:
            return check_repo.prefixed(check_repo.where(repo, project), problem)
    problem = _check_ts_problem(projects) or _typescript_problem(repo, projects, args.mode)
    if problem is not None:
        return problem
    if (
        any(project.kind == "python" for project in projects)
        and not check_stages.runner_override()
        and shutil.which("uv") is None
    ):
        return "uv not found on PATH"
    for path in paths:
        if _owner(cwd, projects, path) is None:
            return f"test path {path}: not inside a project"
    return None


def _typescript_problem(repo: Path, projects: list[check_repo.Project], mode: str) -> str | None:
    """Why the TypeScript projects cannot be checked here: a test runner or a program is missing.

    A missing check_ts.py is left to the stages, which fail and say to re-install.
    """
    typescript = [project for project in projects if project.kind == "typescript"]
    if not typescript:
        return None
    try:
        module = load_ts()
    except FileNotFoundError:
        return None
    for project in typescript:
        if module.test_runner(project.root) is None:
            return check_repo.prefixed(check_repo.where(repo, project), module.NO_TEST_RUNNER)
    if shutil.which("node") is None:
        return "node not found on PATH"
    for project in typescript:
        if project.manager == "bun" and shutil.which("bunx") is None:
            return check_repo.prefixed(check_repo.where(repo, project), "bunx not found on PATH")
    if mode == "full" and not check_stages.runner_override() and shutil.which("uvx") is None:
        return "uvx not found on PATH (full mode measures changed lines with diff-cover)"
    return None


def _repo_root(cwd: Path, mode: str) -> Path | Receipt:
    """The git work tree's top directory, or a setup-error receipt when there is none."""
    if shutil.which("git") is None:
        return Receipt.setup_error(mode, None, False, "git not found on PATH")
    inside = check_repo.git(cwd, "rev-parse", "--is-inside-work-tree")
    top = check_repo.git(cwd, "rev-parse", "--show-toplevel").stdout.strip()
    if inside.returncode != 0 or inside.stdout.strip() != "true" or not top:
        return Receipt.setup_error(mode, None, False, "not inside a git work tree")
    return Path(top)


def _base_field(root: Path, mode: str, base: str | None) -> str:
    if mode == "fast":
        return "-"
    return check_repo.short(root, base) if base is not None else "none"


def fold_ok(values: list[str]) -> str:
    """`fail` when any project failed the stage, else `ok`."""
    return "fail" if "fail" in values else "ok"


def fold_tests(values: list[str]) -> str:
    """The sum of the projects' test counts; `fail` when any project failed."""
    return "fail" if "fail" in values else str(sum(int(value) for value in values))


def fold_coverage(values: list[str]) -> str:
    """`fail` if any project failed, else the lowest percentage.

    Without percentages it is `n/a` only if every project said so, else `skip`.
    """
    if "fail" in values:
        return "fail"
    percentages = [int(value) for value in values if value.isdigit()]
    if percentages:
        return str(min(percentages))
    return "n/a" if all(value == "n/a" for value in values) else "skip"


CHECK_TS = "check_ts.py"


def _ts_missing() -> str:
    # A function, not a constant: check_repo may not have loaded when this script starts.
    return f"{check_repo.STANDARD_DIR}/{CHECK_TS} is missing (re-run grimoire project)"


@functools.cache
def load_ts() -> ModuleType:
    """The TypeScript module that sits next to this script (loaded once, see `_load`).

    Raises FileNotFoundError when `.grimoire/` has check.py without it; any other exception means
    it cannot be used.
    """
    return _load("check_ts", needs=("suppression_lines", "settings_problems"))


def _check_ts_problem(projects: list[check_repo.Project]) -> str | None:
    """Why check_ts.py cannot be used, when a TypeScript project needs it.

    A missing file is left to the stages, which fail and say to re-install.
    """
    if not any(project.kind == "typescript" for project in projects):
        return None
    try:
        load_ts()
    except FileNotFoundError:
        return None
    except LOAD_ERRORS as error:
        return _load_problem("check_ts", error)
    return None


def _missing_ts_stages(
    project: check_repo.Project, projects: list[check_repo.Project]
) -> check_stages.Stages:
    """A TypeScript project's stages when check_ts.py is missing: each fails and says so."""
    files = check_repo.TsFiles.of(project, projects)
    missing = _ts_missing()
    for problem in [missing, *check_repo.framework_problems(files)]:
        print(f"settings: {problem}")
    print(missing)
    failed: check_stages.Outcome = ("fail", False)
    return check_stages.Stages(
        failed, (0, False), failed, failed, failed, failed, failed, files.skipped_count()
    )


def _typescript_stages(
    project: check_repo.Project,
    run: check_stages.Run,
    projects: list[check_repo.Project],
    paths: list[str],
    out: Path,
) -> check_stages.Stages:
    """A TypeScript project's stages, run by check_ts.py; they fail when it is missing."""
    try:
        module = load_ts()
    except FileNotFoundError:
        return _missing_ts_stages(project, projects)
    stages: check_stages.Stages = module.typescript_stages(project, run, projects, paths, out)
    return stages


def _repo_settings(repo: Path, projects: list[check_repo.Project], base: str | None) -> bool:
    """Print the settings problems of the repo as a whole; whether there were none.

    `base` is known only in full mode; it is what the branch's commit messages are read from.
    """
    listing = check_repo.listing(repo)
    problems = [
        *check_repo.repo_problems(repo, listing),
        *check_repo.outside_problems(repo, projects, listing),
        *check_repo.attribution_problems(repo, base),
    ]
    for problem in problems[: check_stages.TAIL_LINES]:
        print(f"settings: {problem}")
    if len(problems) > check_stages.TAIL_LINES:
        print(f"settings: and {len(problems) - check_stages.TAIL_LINES} more")
    return not problems


# The contracts runtime `grimoire project` vendors for a `contracts/` directory, and what proves
# the copy is there.
CONTRACTS_MAIN = "dataproof/contracts/runtime/__main__.py"
CONTRACT_RECEIPT = "CONTRACT "


def _contracts_stage(repo: Path) -> str:
    """The contracts gate over `repo/contracts/`, run with the vendored runtime.

    `none` without that directory. Prints the gate's receipt line when it passes, the tail of its
    output when it fails (the problems, or a missing dependency named in one line).
    """
    if not (repo / check_repo.CONTRACTS_DIR).is_dir():
        return "none"
    lib = repo / check_repo.STANDARD_DIR / check_repo.LIB_DIR
    if not (lib / CONTRACTS_MAIN).is_file():
        shown = f"{check_repo.STANDARD_DIR}/{check_repo.LIB_DIR}"
        print(f"contracts: {shown} is missing; run grimoire project")
        return "fail"
    code, output = check_stages.run_tool(
        repo,
        "contracts",
        "check",
        check_repo.CONTRACTS_DIR,
        extra_env={"PYTHONPATH": check_stages.pythonpath(lib)},
    )
    if code != 0:
        check_stages.show_tail("contracts", output)
        return "fail"
    for line in [line for line in output.splitlines() if line.startswith(CONTRACT_RECEIPT)]:
        print(line)
    return "ok"


# The bench gate: a project with `bench/bench.yaml` runs `perf-bench` in full mode. The prefix is
# the start of the CLI's message for a lock that stayed held through the whole wait.
BENCH_YAML = "bench/bench.yaml"
BENCH_COMMAND = ("perf-bench", "gate", "--counts-only", "--lock-wait", "1800")
BENCH_LOCK_EXIT = 2
_BENCH_LOCK_PREFIX = "another perf-bench measurement is running"


def _run_bench(repo: Path, executable: str, environ: Mapping[str, str]) -> tuple[int, str]:
    """Run the gate, showing its output as it arrives; its exit code and last non-empty line.

    stderr is merged into stdout because the lock-held message is written to stderr.
    """
    last = ""
    try:
        with subprocess.Popen(
            [executable, *BENCH_COMMAND[1:]],
            cwd=repo,
            env=dict(environ),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        ) as child:
            for line in child.stdout or ():  # always a pipe; `or ()` only satisfies the type
                print(line, end="", flush=True)
                last = line.strip() or last
    except OSError as error:
        print(f"perf-bench: {error}")
        return 127, ""
    return child.returncode, last


def _bench_stage(repo: Path, mode: str, environ: Mapping[str, str]) -> str:
    """The bench gate over `repo/bench/bench.yaml`, in full mode only.

    `-` outside full mode, `off` without that file, `ci` on a GitHub Actions runner (nothing is
    run there: a shared runner's lock and time are not the gate's to hold), else `pass` or `fail`
    by the exit code of `perf-bench gate --counts-only --lock-wait 1800`.
    """
    if mode != "full":
        return "-"
    if not (repo / BENCH_YAML).is_file():
        return "off"
    if environ.get("GITHUB_ACTIONS") == "true":
        return "ci"
    executable = shutil.which(BENCH_COMMAND[0], path=environ.get("PATH"))
    if executable is None:
        print("perf-bench not found: uv tool install -e <grimoire repo>")
        return "fail"
    code, last = _run_bench(repo, executable, environ)
    if code == BENCH_LOCK_EXIT and last.startswith(_BENCH_LOCK_PREFIX):
        print("bench lock busy")
        print(last)
    return "pass" if code == 0 else "fail"


def _read_shards(
    repo: Path, projects: list[check_repo.Project], args: argparse.Namespace
) -> check_python.ShardSet | str | None:
    """The shards that stand in for the Python tests: verified, or the problem with them.

    None when the tests run here (no `--shards`, or no Python project to take them for).
    """
    given: Path | None = getattr(args, "shards", None)
    if given is None:
        return None
    keys = [check_repo.where(repo, project) for project in projects if project.kind == "python"]
    if not keys:
        print("note: no Python project, so no shards were read")
        return None
    head = check_repo.git(repo, "rev-parse", "HEAD").stdout.strip()
    # Absolute: the tools that read the coverage data run from the project's directory.
    loaded = check_python.load_shards(given.absolute(), head, str(repo), keys)
    if not isinstance(loaded, str):
        print(f"note: Python tests from {loaded.total} shards in {given}")
    return loaded


def _run_stages(
    repo: Path,
    cwd: Path,
    projects: list[check_repo.Project],
    args: argparse.Namespace,
    state: check_repo.GitState,
) -> Receipt:
    requested = getattr(args, "base", None) or None
    base = check_repo.resolve_base(repo, requested) if args.mode == "full" else None
    routes = _routes(cwd, projects, getattr(args, "paths", []))
    repo_ok = _repo_settings(repo, projects, base)
    results = []
    run = check_stages.Run(repo, args.mode, base)
    shards = _read_shards(repo, projects, args)
    verified = None if isinstance(shards, str) else shards
    with tempfile.TemporaryDirectory(prefix="grimoire-check-") as tmp:
        for index, project in enumerate(projects):
            where = check_repo.where(repo, project)
            if len(projects) > 1:
                print(f"=== {where} ({project.kind}) ===")
            paths = routes.get(project, [])
            out = Path(tmp) / str(index)
            if project.kind == "python":
                results.append(
                    check_python.python_stages(project, run, paths, out / "coverage.xml", shards)
                )
            else:
                results.append(_typescript_stages(project, run, projects, paths, out))
            if len(projects) > 1:  # each project's own results, before they are folded together
                print(f"{where} ({project.kind}): {results[-1].summary()}")
    contracts = _contracts_stage(repo)
    bench = _bench_stage(repo, args.mode, os.environ)
    passed = (
        repo_ok
        and contracts != "fail"
        and bench != "fail"
        and all(stages.passed() for stages in results)
    )
    return Receipt(
        mode=args.mode,
        exit=0 if passed else 1,
        sha=state.sha,
        dirty=state.dirty or (verified is not None and verified.dirty),
        projects=len(projects),
        settings=fold_ok([r.settings[0] for r in results] + ([] if repo_ok else ["fail"])),
        suppressions=sum(r.suppressions[0] for r in results),
        skipped=sum(r.skipped for r in results),
        format=fold_ok([r.format[0] for r in results]),
        lint=fold_ok([r.lint[0] for r in results]),
        types=fold_ok([r.types[0] for r in results]),
        tests=fold_tests([r.tests[0] for r in results]),
        coverage=fold_coverage([r.coverage[0] for r in results]),
        contracts=contracts,
        bench=bench,
        base=_base_field(repo, args.mode, base),
        runner=(
            "override"
            if check_stages.runner_override() or (verified is not None and verified.override)
            else "uv"
        ),
    )


SHARD_PLUGIN_FILE = "grimoire_shard_plugin.py"


def _shard_problem(
    repo: Path, projects: list[check_repo.Project], state: check_repo.GitState
) -> str | None:
    """Why a shard cannot run here beyond what every mode needs, or None."""
    if state.sha is None:
        return "no commit yet (a shard's results belong to a commit)"
    if not _shard_plugin().is_file():
        return f"{check_repo.STANDARD_DIR}/{SHARD_PLUGIN_FILE} is missing (re-run grimoire project)"
    for project in projects:
        where = check_repo.where(repo, project)
        problem = check_python.key_problem(where)
        if problem is not None:
            return check_repo.prefixed(where, problem)
    return None


def _shard_plugin() -> Path:
    """The pytest plugin that sits next to this script."""
    return Path(__file__).absolute().with_name(SHARD_PLUGIN_FILE)


def _earlier_data_files(out: Path) -> list[Path]:
    """The coverage data files the earlier run's `result.json` names; none when it is unusable.

    Each file is `out/<key>/coverage.data` for a project key of that result. A key that breaks
    the shard-mode key rule, or whose file would resolve outside `out`, is ignored.
    """
    try:
        projects = json.loads((out / check_python.SHARD_RESULT).read_text(encoding="utf-8"))[
            "projects"
        ]
    except (OSError, ValueError, RecursionError, KeyError, TypeError):
        return []
    if not isinstance(projects, dict):
        return []
    keys = [key for key in projects if check_python.key_problem(key) is None]
    inside = out.resolve()
    files = [out / key / check_python.COVERAGE_DATA for key in keys]
    return [file for file in files if file.resolve().is_relative_to(inside)]


def _clear_shard_out(out: Path) -> str | None:
    """Create the output directory and delete what an earlier shard run left in it.

    That is `result.json` and the `coverage.data` files it names (not a walk of the directory,
    which may be the repo itself), so a failed or refused rerun cannot leave a result that looks
    current. Anything else in the directory stays. Returns why it cannot, or None.
    """
    try:
        out.mkdir(parents=True, exist_ok=True)
        for file in _earlier_data_files(out):
            file.unlink(missing_ok=True)
        (out / check_python.SHARD_RESULT).unlink(missing_ok=True)
    except OSError as error:
        return f"{out}: cannot prepare the output directory ({error.strerror or error})"
    return None


def _write_shard_result(out: Path, result: dict[str, object]) -> bool:
    """Write result.json whole or not at all (a temporary file, then a rename)."""
    temporary = out / f".{check_python.SHARD_RESULT}.tmp"
    try:
        temporary.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, out / check_python.SHARD_RESULT)
    except OSError as error:
        print(f"shard: cannot write {check_python.SHARD_RESULT} ({error.strerror or error})")
        return False
    return True


def _run_shard(
    repo: Path,
    projects: list[check_repo.Project],
    args: argparse.Namespace,
    state: check_repo.GitState,
) -> Receipt:
    """Run slice I of N of every project's tests; write result.json only if all of them passed."""
    index, total = args.shard
    slices: dict[str, check_python.ShardSlice] = {}
    with tempfile.TemporaryDirectory(prefix="grimoire-check-") as tmp:
        plugin_dir = Path(tmp) / "plugin"
        plugin_dir.mkdir()
        shutil.copyfile(_shard_plugin(), plugin_dir / SHARD_PLUGIN_FILE)
        for number, project in enumerate(projects):
            key = check_repo.where(repo, project)
            if len(projects) > 1:
                print(f"=== {key} (python) ===")
            work = Path(tmp) / str(number)
            sliced = check_python.shard_stage(
                project, (index, total), work, plugin_dir, args.out / key
            )
            if sliced is not None:
                slices[key] = sliced
                print(
                    f"{key}: shard {index}/{total} ran {sliced.selected} of {sliced.collected} "
                    f"tests, {sliced.passed} passed"
                )
    runner = "override" if check_stages.runner_override() else "uv"
    passed = len(slices) == len(projects)
    if passed:
        result = {
            "shard": index,
            "total": total,
            "sha": check_repo.git(repo, "rev-parse", "HEAD").stdout.strip(),
            "dirty": state.dirty,
            "runner": runner,
            "root": str(repo),
            "projects": {key: asdict(sliced) for key, sliced in slices.items()},
        }
        passed = _write_shard_result(args.out, result)
    return Receipt(
        mode="shard",
        exit=0 if passed else 1,
        sha=state.sha,
        dirty=state.dirty,
        projects=len(projects),
        tests=sum(sliced.passed for sliced in slices.values()) if passed else "fail",
        runner=runner,
        shard=f"{index}/{total}",
    )


def _install_commands(
    repo: Path, projects: list[check_repo.Project]
) -> tuple[list[tuple[check_repo.Project, list[str]]], str | None]:
    """Per project, the command that installs its lockfile; or why nothing can be installed."""
    problem = _python_version_error()
    if problem is None and not projects:
        problem = "no Python or TypeScript project found"
    for project in projects:
        lock = _lock_problem(repo, project)
        if problem is None and lock is not None:
            problem = check_repo.prefixed(check_repo.where(repo, project), lock)
    problem = problem or _check_ts_problem(projects)
    if problem is not None:
        return [], problem
    commands = []
    for project in projects:
        if project.kind == "python":
            command = ["uv", "sync", "--locked"]
        else:
            try:
                command = load_ts().install_command(project.root, project.manager).split()
            except FileNotFoundError:
                return [], _ts_missing()
        if shutil.which(command[0]) is None:
            return [], check_repo.prefixed(
                check_repo.where(repo, project), f"{command[0]} not found on PATH"
            )
        commands.append((project, command))
    return commands, None


def install(cwd: Path) -> int:
    """Install every project's locked dependencies: one line per project.

    Exit 0 when every install worked, 1 when one failed, 2 when nothing could start (a missing
    tool or lockfile is found before anything is installed).
    """
    found = _repo_root(cwd, "install")
    if isinstance(found, Receipt):
        print(f'install: error="{found.error}"')
        return 2
    commands, problem = _install_commands(found, check_repo.discover(found))
    if problem is not None:
        print(f'install: error="{problem}"')
        return 2
    failed = False
    for project, command in commands:
        line = f"install {check_repo.where(found, project)} ({project.kind}): {' '.join(command)}"
        try:
            done = subprocess.run(
                command,
                cwd=project.root,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                check=False,
            )
            code, output = done.returncode, done.stdout + done.stderr
        except OSError as error:
            code, output = 127, f"{command[0]}: {error}"
        print(f"{line} -> {'ok' if code == 0 else f'failed (exit {code})'}")
        if code != 0:
            check_stages.show_tail("install", output)
            failed = True
    return 1 if failed else 0


def _receipt_for(cwd: Path, args: argparse.Namespace) -> Receipt:
    """Run the requested checks: their receipt, or the setup error that kept them from running."""
    found = _repo_root(cwd, args.mode)
    if isinstance(found, Receipt):
        return found
    # Read before any stage: the tools write caches that flip `dirty`.
    state = check_repo.git_state(found)
    projects = check_repo.discover(found)
    if args.mode == "shard":
        projects = [project for project in projects if project.kind == "python"]
    problem = _setup_problem(found, cwd, projects, args)
    if problem is None and args.mode == "shard":
        problem = _shard_problem(found, projects, state)
    if problem:
        return Receipt.setup_error(args.mode, state.sha, state.dirty, problem)
    if args.mode == "shard":
        return _run_shard(found, projects, args, state)
    return _run_stages(found, cwd, projects, args, state)


def main(argv: list[str] | None = None) -> int:
    args = _parse(argv)
    if args.mode == "shard":
        # First, so that no refusal below leaves the results of an earlier run looking current.
        problem = _clear_shard_out(args.out)
        if problem:
            print(Receipt.setup_error(args.mode, None, False, problem).line())
            return 2
    if LOAD_PROBLEM:
        if args.mode == "install":
            print(f'install: error="{LOAD_PROBLEM}"')
        else:
            print(Receipt.setup_error(args.mode, None, False, LOAD_PROBLEM).line())
        return 2
    cwd = Path.cwd()
    if args.mode == "install":
        return install(cwd)
    receipt = _receipt_for(cwd, args)
    if receipt.skipped:
        print(f"note: {receipt.skipped} vendored/generated files skipped (.gitattributes)")
    if check_stages.runner_override():
        print(
            f"note: {check_stages.RUNNER_ENV}={check_stages.runner_override()} "
            "replaces uv run --frozen"
        )
    print(receipt.line())
    return receipt.exit


if __name__ == "__main__":
    raise SystemExit(main())
