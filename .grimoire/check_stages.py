"""The stage types and the tool runner for Grimoire's quality check. Standard library only.

What a project's stages produce, how a tool is run from the project root and what is shown
when it fails. Copied next to `check.py`, which loads it.
"""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

# The standard's version: the same in every module of it (check.py refuses a mismatch).
STANDARD_VERSION = 5

COVERAGE_FLOOR: int = 80
TAIL_LINES: int = 20


@dataclass(frozen=True)
class Suppression:
    path: Path
    line: int
    text: str
    cell: int | None = None  # the 1-based notebook cell, for .ipynb files


# `GRIMOIRE_CHECK_RUNNER` replaces `uv run --frozen`; tools then run as `<runner> <module>`.
RUNNER_ENV = "GRIMOIRE_CHECK_RUNNER"
RUNNER_MODULES = {
    "ruff": "ruff",
    "mypy": "mypy",
    "pytest": "pytest",
    "coverage": "coverage",
    "diff-cover": "diff_cover.diff_cover_tool",
    # The contracts gate, from the copy of the runtime in `.grimoire/lib` (on PYTHONPATH).
    "contracts": "dataproof.contracts.runtime",
}
# Tools with no console script: what `uv run --frozen` runs for them.
UV_ENTRY: dict[str, tuple[str, ...]] = {
    "contracts": ("python", "-m", RUNNER_MODULES["contracts"]),
}
COVERAGE_PCT = re.compile(r"Coverage:\s*(\d+)%")
NO_COVERED_LINES = "No lines with coverage information"


# Inherited settings that can hide a failing test or move coverage data into the repo.
# Every COVERAGE_* variable goes (COVERAGE_FORCE_CONFIG replaces the config outright); the
# tests stage sets COVERAGE_FILE itself. MYPYPATH adds module search paths to mypy.
SCRUBBED_ENV = ("PYTEST_ADDOPTS", "PYTEST_PLUGINS", "MYPYPATH")
SCRUBBED_PREFIXES = ("COVERAGE_",)


def runner_override() -> str:
    """The runner prefix from the environment; blank counts as unset."""
    return os.environ.get(RUNNER_ENV, "").strip()


# A TypeScript project has no uv.lock: it runs diff-cover through uvx, pinned to the version
# grimoire's own uv.lock holds.
UVX_TOOLS = {"diff-cover": "diff-cover==10.6.0"}


def _command(tool: str, *args: str, locked: bool = True) -> list[str]:
    override = runner_override()
    if override:
        return [*override.split(), RUNNER_MODULES[tool], *args]
    if not locked:
        return ["uvx", "--from", UVX_TOOLS[tool], tool, *args]
    return ["uv", "run", "--frozen", *UV_ENTRY.get(tool, (tool,)), *args]


def pythonpath(first: Path) -> str:
    """A PYTHONPATH with `first` ahead of whatever the environment already had."""
    inherited = os.environ.get("PYTHONPATH", "")
    if not inherited:
        return str(first)
    return f"{first}{os.pathsep}{inherited}"


def run_tool(
    root: Path,
    tool: str,
    *args: str,
    extra_env: dict[str, str] | None = None,
    locked: bool = True,
) -> tuple[int, str]:
    """Run a tool from the project root; return its exit code and combined output.

    `locked` tools come from the project's uv.lock (`uv run --frozen`), others through uvx.
    """
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in SCRUBBED_ENV and not key.startswith(SCRUBBED_PREFIXES)
    }
    env.update(extra_env or {})
    try:
        done = subprocess.run(
            _command(tool, *args, locked=locked),
            cwd=root,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as error:
        return 127, f"{tool}: {error}"
    return done.returncode, done.stdout + done.stderr


def show_tail(stage: str, output: str) -> None:
    print(f"--- {stage} failed; last {TAIL_LINES} lines of output ---")
    print("\n".join(output.splitlines()[-TAIL_LINES:]))


def changed_line_coverage(
    root: Path, base: str, report: Path, locked: bool = True
) -> tuple[str, bool]:
    code, output = run_tool(
        root,
        "diff-cover",
        str(report),
        f"--compare-branch={base}",
        f"--fail-under={COVERAGE_FLOOR}",
        locked=locked,
    )
    if code != 0:
        show_tail("coverage", output)
    found = COVERAGE_PCT.search(output)
    if found:
        return found.group(1), code == 0
    if code == 0 and NO_COVERED_LINES in output:
        return "n/a", True
    if code == 0:
        show_tail("coverage", output)
    return "fail", False


Outcome = tuple[str, bool]  # a stage's receipt value, and whether it passed


@dataclass(frozen=True)
class Stages:
    """What one project's stages produced."""

    settings: Outcome
    suppressions: tuple[int, bool]
    format: Outcome
    lint: Outcome
    types: Outcome
    tests: Outcome
    coverage: Outcome
    skipped: int = 0

    def passed(self) -> bool:
        flags = (self.settings, self.format, self.lint, self.types, self.tests, self.coverage)
        return self.suppressions[1] and all(ok for _, ok in flags)

    def summary(self) -> str:
        """The project's own stage values, as the receipt names them."""
        return (
            f"settings={self.settings[0]} suppressions={self.suppressions[0]} "
            f"format={self.format[0]} lint={self.lint[0]} types={self.types[0]} "
            f"tests={self.tests[0]} coverage={self.coverage[0]}"
        )


@dataclass(frozen=True)
class Run:
    """What the stages of every project share."""

    repo: Path
    mode: str
    base: str | None  # the commit changed lines are measured from (full mode)
