"""The Python rules and stages for Grimoire's quality check. Standard library only.

What counts as a suppression in Python, the settings problems in a project's Python config, and
the stages that run ruff, mypy, pytest and coverage. Copied next to `check.py`, which loads it.
"""

from __future__ import annotations

import configparser
import importlib
import io
import json
import os
import re
import shutil
import tokenize
from collections.abc import Callable, Collection, Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Any
from xml.parsers import expat

if TYPE_CHECKING:
    import check_repo
    import check_stages
else:
    check_repo = importlib.import_module("grimoire_check_repo")
    check_stages = importlib.import_module("grimoire_check_stages")

# The standard's version: the same in every module of it (check.py refuses a mismatch).
STANDARD_VERSION = 5


PY_SUPPRESSIONS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"noqa",
        r"type:\s*ignore",
        r"pyright:\s*ignore",
        r"^#\s*mypy:",
        r"pragma[:\s]?\s*no\s*(cover|branch)",  # coverage's own default accepts no colon
        r"fmt:\s*(off|skip)",
        r"yapf:\s*disable",
        r"isort:\s*(skip_file|skip|off)",
        r"#\s*ruff\s*:",  # every ruff directive: the file-level and the range forms
    )
)
# Names that switch a check off wherever they appear in code (a decorator or its import).
SUPPRESSING_NAMES = ("no_type_check",)
# Ruff's line breaks; `str.splitlines()` also breaks on \x0b, \x0c, \x85 and U+2028/9, which ruff
# reads as ordinary whitespace inside a line.
LINE_BREAK = re.compile(r"\r\n|\r|\n")
SUPPRESSING_NAME = re.compile(r"\b(?:" + "|".join(SUPPRESSING_NAMES) + r")\b")


class UnscannableError(ValueError):
    """A file the tokenizer rejects (or a notebook that is not JSON).

    `found` is what a line-by-line scan still sees in it.
    """

    def __init__(
        self, found: list[check_stages.Suppression], reason: str = "could not be tokenized"
    ) -> None:
        super().__init__(reason)
        self.found = found


def _scan_tokens(
    tokens: Iterable[tokenize.TokenInfo], path: Path, cell: int | None = None
) -> list[check_stages.Suppression]:
    found = []
    for token in tokens:
        if token.type == tokenize.COMMENT and any(
            pattern.search(token.string) for pattern in PY_SUPPRESSIONS
        ):
            found.append(check_stages.Suppression(path, token.start[0], token.string, cell))
        elif token.type == tokenize.NAME and token.string in SUPPRESSING_NAMES:
            found.append(check_stages.Suppression(path, token.start[0], token.line.strip(), cell))
    return found


def _scan_lines(text: str, path: Path, cell: int | None = None) -> list[check_stages.Suppression]:
    """Suppressions found without a tokenizer: any `#` tail that matches counts.

    It also counts the text of strings that look like suppressions, so it is only for source the
    tokenizer cannot read.
    """
    found = []
    for number, line in enumerate(LINE_BREAK.split(text), start=1):
        tails = [line[match.start() :] for match in re.finditer("#", line)]
        hit = next((t for t in tails if any(p.search(t) for p in PY_SUPPRESSIONS)), None)
        if hit is not None:
            found.append(check_stages.Suppression(path, number, hit.strip(), cell))
        elif SUPPRESSING_NAME.search(line):
            found.append(check_stages.Suppression(path, number, line.strip(), cell))
    return found


def scan_python(path: Path) -> list[check_stages.Suppression]:
    """Suppressions in a Python file; strings that look like them do not count.

    Raises UnscannableError, carrying a line-scan count, when the file cannot be tokenized.
    """
    data = path.read_bytes()
    try:
        return _scan_tokens(tokenize.tokenize(io.BytesIO(data).readline), path)
    except (tokenize.TokenError, SyntaxError, ValueError) as error:  # ValueError covers decoding
        text = data.decode("utf-8", errors="replace")
        raise UnscannableError(_scan_lines(text, path)) from error


def _code_cells(data: object) -> Iterator[tuple[int, str]]:
    """The 1-based number and source text of each code cell of a parsed notebook."""
    cells = data.get("cells") if isinstance(data, dict) else None
    for number, cell in enumerate(cells if isinstance(cells, list) else [], start=1):
        if not isinstance(cell, dict) or cell.get("cell_type") != "code":
            continue
        source = cell.get("source", "")
        yield number, "".join(map(str, source)) if isinstance(source, list) else str(source)


def scan_notebook(path: Path) -> list[check_stages.Suppression]:
    """Suppressions in a notebook's code cells, found by line, strings included.

    A notebook is never tokenized: IPython and ruff read some lines (`x = %who`, `!ls`, `?obj`,
    `,f x`) differently from Python's tokenizer, so a string it opens there could hide a
    suppression ruff still honours. Raises UnscannableError, carrying a line-scan count, when the
    file is not JSON.
    """
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except ValueError as error:  # bad JSON, or bad UTF-8
        text = path.read_bytes().decode("utf-8", errors="replace")
        raise UnscannableError(
            _scan_lines(text, path), "could not be read as a notebook"
        ) from error
    found: list[check_stages.Suppression] = []
    for number, text in _code_cells(data):
        found += _scan_lines(text, path, number)
    return found


RUFF_KEYS = ("extend", "src", "target-version", "namespace-packages")
MYPY_CODES = (
    "ignore-without-code",
    "possibly-undefined",
    "truthy-bool",
    "redundant-expr",
    "exhaustive-match",
)
MYPY_ALLOWED = ("strict", "files", "plugins", "enable_error_code", "python_version", "mypy_path")
# Allowed only when true: they make mypy stricter than --strict.
MYPY_STRENGTHENING = (
    "warn_unreachable",
    "disallow_any_explicit",
    "disallow_any_expr",
    "disallow_any_unimported",
    "disallow_any_decorated",
    "local_partial_types",
    "strict_bytes",
)
PYTEST_ALLOWED = (
    "strict",
    "filterwarnings",
    "testpaths",
    "markers",
    "minversion",
    "required_plugins",
    "timeout",
    "xfail_strict",
    "pythonpath",
)
# Only `[tool.coverage.run]` is read; the check writes the rest of the coverage config itself.
COVERAGE_RUN_KEYS = ("branch", "concurrency", "parallel", "patch", "sigterm")
COVERAGE_FLAGS = ("parallel", "sigterm")
COVERAGE_NAMES = ("concurrency", "patch")
COVERAGE_NAME = re.compile(r"[a-z_]+")
STRAY_FILES = {
    "mypy.ini": "mypy reads it before pyproject.toml",
    ".mypy.ini": "mypy reads it before pyproject.toml",
    "pytest.ini": "pytest reads it before pyproject.toml",
    ".pytest.ini": "pytest reads it before pyproject.toml",
    "pytest.toml": "pytest reads it before pyproject.toml",
    ".pytest.toml": "pytest reads it before pyproject.toml",
    ".coveragerc": "coverage reads it before pyproject.toml",
    ".coveragerc.toml": "coverage reads it before pyproject.toml",
}
# Ruff finds the nearest config above each Python file, so these only matter with Python below.
RUFF_FILES = ("ruff.toml", ".ruff.toml")
# (file name, section prefix, label, tool): ini files that matter only when they carry the section.
STRAY_SECTIONS = (
    ("setup.cfg", "mypy", "mypy", "mypy"),
    ("setup.cfg", "tool:pytest", "tool:pytest", "pytest"),
    ("tox.ini", "pytest", "pytest", "pytest"),
    ("setup.cfg", "coverage:", "coverage:*", "coverage"),
    ("tox.ini", "coverage:", "coverage:*", "coverage"),
)


def load_toml(path: Path) -> dict[str, object]:
    """The parsed TOML file; raises OSError, UnicodeDecodeError or tomllib.TOMLDecodeError."""
    import tomllib

    return tomllib.loads(path.read_text(encoding="utf-8"))


def toml_error() -> type[Exception]:
    import tomllib

    return tomllib.TOMLDecodeError


def table(parent: object, key: str) -> dict[str, object]:
    child = parent.get(key) if isinstance(parent, dict) else None
    return child if isinstance(child, dict) else {}


def _ruff_problems(ruff: dict[str, object], extend: str) -> list[str]:
    weakens = "it weakens .grimoire/ruff.toml"
    problems = []
    if ruff.get("extend") != extend:
        problems.append(f'{check_repo.PYPROJECT} [tool.ruff] extend: must be "{extend}"')
    for key in ruff:
        if key not in (*RUFF_KEYS, "lint"):
            problems.append(f"{check_repo.PYPROJECT} [tool.ruff] {key}: not allowed ({weakens})")
    problems.extend(
        f"{check_repo.PYPROJECT} [tool.ruff.lint] {key}: not allowed ({weakens})"
        for key in table(ruff, "lint")
        if key != "extend-select"
    )
    return problems


def _is_test_file(rel: Path) -> bool:
    """Tests need not be type-checked: a `tests` directory, test_*.py, *_test.py, conftest.py."""
    name = rel.name
    return (
        "tests" in rel.parts[:-1]
        or name.startswith("test_")
        or name.endswith("_test.py")
        or name == "conftest.py"
    )


def _is_collected(rel: Path) -> bool:
    """Whether pytest's default `python_files` patterns collect this file."""
    return rel.suffix == ".py" and (rel.name.startswith("test_") or rel.name.endswith("_test.py"))


def _in_scope_python(root: Path, listing: list[Path] | None = None) -> list[Path]:
    """The project's Python files minus vendored and generated ones, as paths below root."""
    files = check_repo.project_files(root, (".py", ".pyi"), listing)
    skipped = check_repo.excluded_files(root, files)
    return [path.relative_to(root) for path in files if path not in skipped]


# mypy does not descend into these (or any `.*`) while crawling a directory it was given.
MYPY_SKIPPED_DIRS = ("__pycache__", "site-packages", "node_modules")


def _crawled(rel: Path, directory: Path) -> bool:
    """Whether mypy, crawling `directory`, reaches `rel` (which must be below it)."""
    below = rel if directory == Path() else rel.relative_to(directory)
    *parents, name = below.parts
    return not name.startswith(".") and not any(
        part.startswith(".") or part in MYPY_SKIPPED_DIRS for part in parents
    )


def _held(rel: Path, directories: list[Path]) -> bool:
    """Whether mypy checks `rel` when run on these directories."""
    return any(
        _crawled(rel, directory) for directory in directories if check_repo.under(rel, [directory])
    )


def _nested_reach_problems(nested: list[Path], directories: list[Path], head: str) -> list[str]:
    """mypy would also check a nested project that one of the `files` directories reaches."""
    return [
        f"{head} files: {directory.as_posix()} reaches the nested project {project.as_posix()} "
        "(it is checked on its own; list the directories of this project only)"
        for project in nested
        for directory in directories
        if check_repo.under(project, [directory]) or directory.is_relative_to(project)
    ]


def _mypy_files_problems(
    root: Path, files: list[object], head: str, listing: list[Path] | None
) -> list[str]:
    """Every entry must be a directory, and together they must hold all non-test code.

    A module with a `.pyi` stub beside it counts as outside: mypy reads only the stub.
    """
    problems = []
    directories = []
    for entry in files:
        if isinstance(entry, str) and (root / entry).is_dir():
            directories.append(Path(os.path.normpath(entry)))
        else:
            problems.append(f'{head} files: "{entry}" must be a directory')
    code = [rel for rel in _in_scope_python(root, listing) if not _is_test_file(rel)]
    problems.extend(
        _nested_reach_problems(
            check_repo.nested_roots(check_repo.all_files(root, listing)), directories, head
        )
    )
    outside = sorted(rel.as_posix() for rel in code if not _held(rel, directories))
    if outside:
        problems.append(
            f"{head} files: must hold every non-test Python file "
            f"({check_repo.shown(outside)} outside them)"
        )
    shadowed = sorted(
        rel.as_posix()
        for rel in code
        if rel.suffix == ".py" and (root / rel.with_suffix(".pyi")).is_file()
    )
    if shadowed:
        problems.append(
            f"{head} files: {check_repo.shown(shadowed)} is shadowed by a .pyi stub "
            "(mypy checks only the stub)"
        )
    return problems


def _in_standard_dir(entry: str) -> bool:
    """Whether a path is the root `.grimoire/` or below it."""
    return Path(os.path.normpath(entry)).parts[:1] == (check_repo.STANDARD_DIR,)


def mypy_path_entries(mypy_path: object) -> list[str]:
    """The entries of a `mypy_path` setting (a string split on `:` and `,`, or a list), stripped;
    a non-string entry reads as `$` (refused like a variable). Unset, or any other type, gives no
    entries."""
    entries = re.split(r"[:,]", mypy_path) if isinstance(mypy_path, str) else mypy_path
    if not isinstance(entries, list):
        return []
    return [entry.strip() if isinstance(entry, str) else "$" for entry in entries]


def is_contracts_lib(entry: str) -> bool:
    """Whether a `mypy_path` entry is the vendored contracts runtime, `.grimoire/lib`."""
    return Path(os.path.normpath(entry)) == Path(check_repo.STANDARD_DIR, check_repo.LIB_DIR)


def _mypy_path_problems(root: Path, mypy_path: object, head: str) -> list[str]:
    """`mypy_path` must stay inside the project and out of `.grimoire/`, whose code is unchecked;
    with a `contracts/` directory it may hold `.grimoire/lib`, so mypy finds the vendored runtime
    the tests import."""
    paths = mypy_path_entries(mypy_path)
    if any("$" in path or "~" in path or not _inside(path) for path in paths):
        return [f"{head} mypy_path: must be relative paths inside the project (no $ or ~)"]
    vendored = (root / check_repo.CONTRACTS_DIR).is_dir()
    if any(_in_standard_dir(path) and not (vendored and is_contracts_lib(path)) for path in paths):
        return [
            f"{head} mypy_path: {check_repo.STANDARD_DIR}/ is not allowed "
            "(code there is not checked)"
        ]
    return []


def _mypy_problems(
    mypy: dict[str, object], project: dict[str, object], root: Path, listing: list[Path] | None
) -> list[str]:
    head = f"{check_repo.PYPROJECT} [tool.mypy]"
    problems = []
    if mypy.get("strict") is not True:
        problems.append(f"{head} strict: must be true")
    codes = mypy.get("enable_error_code")
    enabled = codes if isinstance(codes, list) else []
    missing = [code for code in MYPY_CODES if code not in enabled]
    if missing:
        problems.append(f"{head} enable_error_code: must include {', '.join(missing)}")
    files = mypy.get("files")
    if not isinstance(files, list) or not files:
        problems.append(f"{head} files: must be a non-empty list")
    else:
        problems.extend(_mypy_files_problems(root, files, head, listing))
    dependencies = project.get("dependencies")
    needs_pydantic = isinstance(dependencies, list) and any(
        isinstance(dep, str) and dep.strip().lower().startswith("pydantic") for dep in dependencies
    )
    plugins = mypy.get("plugins")
    plugin_list = [plugins] if isinstance(plugins, str) else plugins
    if needs_pydantic and not (isinstance(plugin_list, list) and "pydantic.mypy" in plugin_list):
        problems.append(f'{head} plugins: must include "pydantic.mypy" (pydantic is a dependency)')
    problems.extend(_mypy_path_problems(root, mypy.get("mypy_path"), head))
    for key, value in mypy.items():
        if key in MYPY_STRENGTHENING:
            if value is not True:
                problems.append(
                    f"{head} {key}: must be true when set (it may only make mypy stricter)"
                )
        elif key not in MYPY_ALLOWED:
            problems.append(f"{head} {key}: not allowed (only {', '.join(MYPY_ALLOWED)})")
    return problems


def _quoted(entries: list[str]) -> str:
    return ", ".join(f'"{entry}"' for entry in entries)


def _inside(entry: str) -> bool:
    """Whether a path is relative and stays below the project root (judged by its text)."""
    return not Path(entry).is_absolute() and Path(os.path.normpath(entry)).parts[:1] != ("..",)


def _matches(root: Path, entry: str) -> list[Path] | None:
    """The paths a testpaths entry names; None when it is a malformed glob."""
    if not any(c in entry for c in "*?["):
        return [root / entry]
    if any("**" in part and part != "**" for part in entry.split("/")):
        return None  # pathlib rejects `**` inside a name only on some Python versions
    try:
        return list(root.glob(entry))
    except (ValueError, NotImplementedError):
        return None


def _testpaths_problems(
    root: Path, testpaths: object, head: str, listing: list[Path] | None
) -> list[str]:
    """`testpaths` must reach every test file pytest would otherwise collect."""
    entries = testpaths.split() if isinstance(testpaths, str) else testpaths
    if not isinstance(entries, list) or not all(isinstance(item, str) for item in entries):
        return [f"{head} testpaths: must be a list of paths"]
    escaping = [entry for entry in entries if not _inside(entry)]
    if escaping:
        return [
            f"{head} testpaths: must be relative paths inside the project (got {_quoted(escaping)})"
        ]
    reached = []
    for entry in entries:
        matches = _matches(root, entry)
        if matches is None:
            return [f'{head} testpaths: invalid pattern "{entry}"']
        reached += [Path(os.path.normpath(match.relative_to(root))) for match in matches]
    outside = sorted(
        rel.as_posix()
        for rel in _in_scope_python(root, listing)
        if _is_collected(rel) and not check_repo.under(rel, reached)
    )
    if not outside:
        return []
    return [
        f"{head} testpaths: {check_repo.shown(outside)} outside them (pytest would not run them)"
    ]


def _pythonpath_problems(root: Path, pythonpath: object, head: str) -> list[str]:
    """`pythonpath` may only add directories of this project to the import path."""
    entries = pythonpath.split() if isinstance(pythonpath, str) else pythonpath
    if isinstance(entries, list) and any(
        isinstance(entry, str) and _in_standard_dir(entry) for entry in entries
    ):
        return [
            f"{head} pythonpath: {check_repo.STANDARD_DIR}/ is not allowed "
            "(code there is not checked)"
        ]
    inside = root.resolve()
    allowed = isinstance(entries, list) and all(
        isinstance(entry, str)
        and _inside(entry)
        and (root / entry).is_dir()
        and (root / entry).resolve().is_relative_to(inside)
        for entry in entries
    )
    return (
        [] if allowed else [f"{head} pythonpath: must be relative directories inside the project"]
    )


def _pytest_problems(
    pytest_table: dict[str, object], root: Path, listing: list[Path] | None
) -> list[str]:
    # pytest 9 reads a native [tool.pytest] table; it wins once it has keys besides ini_options.
    native = any(key != "ini_options" for key in pytest_table)
    if native:
        options, head = pytest_table, f"{check_repo.PYPROJECT} [tool.pytest]"
    else:
        options, head = (
            table(pytest_table, "ini_options"),
            f"{check_repo.PYPROJECT} [tool.pytest.ini_options]",
        )
    problems = []
    if options.get("strict") is not True:
        problems.append(f"{head} strict: must be true")
    warnings = options.get("filterwarnings")
    if not isinstance(warnings, list) or not warnings:
        problems.append(f"{head} filterwarnings: must be a non-empty list")
    else:
        problems.extend(
            f'{head} filterwarnings: "{entry}" must start with "error"'
            for entry in warnings
            if not (isinstance(entry, str) and entry.startswith("error"))
        )
    for key, value in options.items():
        if key == "xfail_strict" and value is not True:
            problems.append(f"{head} xfail_strict: must be true when set")
        elif key not in PYTEST_ALLOWED and not (native and key == "ini_options"):
            problems.append(f"{head} {key}: not allowed (only {', '.join(PYTEST_ALLOWED)})")
    if "testpaths" in options:
        problems.extend(_testpaths_problems(root, options["testpaths"], head, listing))
    if "pythonpath" in options:
        problems.extend(_pythonpath_problems(root, options["pythonpath"], head))
    return problems


def _plain_names(value: object) -> bool:
    """A name or a list of names made of `a-z` and `_`: nothing that could start a new line."""
    names = [value] if isinstance(value, str) else value
    return isinstance(names, list) and all(
        isinstance(name, str) and COVERAGE_NAME.fullmatch(name) for name in names
    )


def _coverage_run_problems(run: dict[str, object]) -> list[str]:
    """Wrong types in `[tool.coverage.run]`; the values go into a generated config file."""
    head = f"{check_repo.PYPROJECT} [tool.coverage.run]"
    problems = [
        f"{head} {key}: must be true or false"
        for key in COVERAGE_FLAGS
        if key in run and not isinstance(run[key], bool)
    ]
    problems.extend(
        f"{head} {key}: must be a name or a list of names (a-z and _ only)"
        for key in COVERAGE_NAMES
        if key in run and not _plain_names(run[key])
    )
    return problems


def _coverage_problems(coverage: dict[str, object]) -> list[str]:
    head = f"{check_repo.PYPROJECT} [tool.coverage"
    run = table(coverage, "run")
    problems = []
    if run.get("branch") is not True:
        problems.append(f"{head}.run] branch: must be true")
    problems.extend(_coverage_run_problems(run))
    problems.extend(
        f"{head}.run] {key}: not allowed (only {', '.join(COVERAGE_RUN_KEYS)})"
        for key in run
        if key not in COVERAGE_RUN_KEYS
    )
    problems.extend(
        f"{head}.report] {key}: not allowed (the check sets coverage reporting)"
        for key in table(coverage, "report")
    )
    problems.extend(
        f"{head}.{section}]: not allowed (only run)"
        for section in coverage
        if section not in ("run", "report")
    )
    return problems


def _has_section(path: Path, prefix: str) -> bool | None:
    """Whether an ini file has a section `prefix`, `prefix-*` or `prefix.*`; None if unreadable."""
    parser = configparser.ConfigParser(interpolation=None, strict=False)
    try:
        parser.read_string(path.read_text(encoding="utf-8"))
    except (configparser.Error, UnicodeDecodeError):
        return None
    if prefix.endswith(":"):
        return any(name.startswith(prefix) for name in parser.sections())
    return any(
        name == prefix or name.startswith((f"{prefix}-", f"{prefix}."))
        for name in parser.sections()
    )


def _ruff_applies(config: Path, python_dirs: list[Path]) -> bool:
    """Whether some Python file sits in the config's directory or below it."""
    return any(
        config.parent == directory or config.parent in directory.parents
        for directory in python_dirs
    )


CONFIG_NAMES = frozenset((*STRAY_FILES, *RUFF_FILES, *(name for name, *_ in STRAY_SECTIONS)))


def config_files(root: Path, skip: Iterable[Path] = ()) -> list[Path]:
    """Tool config files anywhere below root, ignored or not: git ignore rules do not apply.

    The directories in `skip` (other projects, which are walked on their own) are not entered.
    """
    found = []
    skipped = set(skip)
    for directory, subdirs, names in os.walk(root):
        unwalked = (
            {*check_repo.UNWALKED_DIRS, check_repo.STANDARD_DIR}
            if Path(directory) == root
            else check_repo.UNWALKED_DIRS
        )
        subdirs[:] = [
            name
            for name in subdirs
            if name not in unwalked and Path(directory, name) not in skipped
        ]
        found += [Path(directory) / name for name in names if name in CONFIG_NAMES]
    return sorted(found, key=lambda path: path.relative_to(root).as_posix())


def _stray_problems(root: Path, listing: list[Path] | None) -> list[str]:
    files = check_repo.all_files(root, listing)
    python_dirs = [path.parent for path in check_repo.project_files(root, (".py", ".pyi"), files)]
    problems = []
    for path in config_files(root, [root / nested for nested in check_repo.nested_roots(files)]):
        rel = path.relative_to(root).as_posix()
        if path.name in STRAY_FILES:
            problems.append(f"{rel}: not allowed ({STRAY_FILES[path.name]})")
        if path.name in RUFF_FILES and _ruff_applies(path, python_dirs):
            problems.append(f"{rel}: not allowed (it replaces .grimoire/ruff.toml)")
        for name, prefix, label, tool in STRAY_SECTIONS:
            if path.name != name:
                continue
            found = _has_section(path, prefix)
            if found is None:
                problems.append(f"{rel}: unreadable, cannot tell whether it configures {tool}")
            elif found:
                problems.append(
                    f"{rel} [{label}]: not allowed ({tool} reads it before pyproject.toml)"
                )
    return problems


def python_settings_problems(
    root: Path, repo: Path | None = None, listing: list[Path] | None = None
) -> list[str]:
    """Everything in the project's Python config that is weaker than the standard.

    `repo` is the repo's top directory when the project is below it: its `[tool.ruff] extend`
    must then point at the repo's one `.grimoire/ruff.toml`, and the repo-wide problems
    (`check_repo.repo_problems`) are left to the caller. Without it `root` is the repo's top.
    """
    top = root if repo is None else repo
    extend = Path(os.path.relpath(top / check_repo.STANDARD_DIR / "ruff.toml", root)).as_posix()
    files = check_repo.all_files(root, listing)
    problems = []
    pyproject = root / check_repo.PYPROJECT
    if not pyproject.is_file():
        problems.append(f"{check_repo.PYPROJECT}: missing")
    else:
        try:
            data = load_toml(pyproject)
        except (toml_error(), UnicodeDecodeError) as error:
            problems.append(f"{check_repo.PYPROJECT}: invalid TOML ({error})")
        else:
            tool = table(data, "tool")
            problems.extend(_ruff_problems(table(tool, "ruff"), extend))
            problems.extend(
                _mypy_problems(table(tool, "mypy"), table(data, "project"), root, files)
            )
            problems.extend(_pytest_problems(table(tool, "pytest"), root, files))
            problems.extend(_coverage_problems(table(tool, "coverage")))
    if repo is not None:
        return problems + _stray_problems(root, files)
    attributes = check_repo.attributes_problems(root)
    return (
        problems
        + attributes
        + _stray_problems(root, files)
        + check_repo.unowned_problems(root)
        + check_repo.walk_problems(root, files)
        + check_repo.node_modules_problems(root)
    )


PASSED = re.compile(r"(\d+) passed")
# A test pytest's short summary lists as failed or errored, without the message after " - ".
SUMMARY_TEST = re.compile(r"^(?:FAILED|ERROR) .+?(?= - |$)", re.MULTILINE)
NO_TESTS_RAN = "no tests ran"
XDIST = "pytest-xdist"
XDIST_MISSING = re.compile(r"(?:unrecognized arguments|no such option): -n\b")
PYTEST_NOTHING_COLLECTED = 5


def _show_failed_tests(output: str) -> None:
    """Name the tests pytest's summary lists as failed or errored, which the tail can hide.

    With CI set, pytest prints each failure's whole message in the summary, so the last
    message alone can fill the tail.
    """
    names = SUMMARY_TEST.findall(output)
    if not names:
        return
    print(f"--- tests: {len(names)} failed or errored ---")
    print("\n".join(names[: check_stages.TAIL_LINES]))
    if len(names) > check_stages.TAIL_LINES:
        print(f"tests: and {len(names) - check_stages.TAIL_LINES} more")


def _show_test_failure(output: str) -> None:
    """Say why a pytest run failed: the failed tests, a missing pytest-xdist, the output's tail."""
    _show_failed_tests(output)
    if XDIST_MISSING.search(output):
        print(f"tests: pytest-xdist is missing (run: uv add --dev {XDIST})")
    check_stages.show_tail("tests", output)


# Ruff reads `--extend-exclude` values as globs.
GLOB_CHARS = frozenset("*?[]{}\\")


def literal(path: str) -> str:
    """The path as a glob that matches only itself: each special character becomes `[c]`."""
    return "".join(f"[{char}]" if char in GLOB_CHARS else char for char in path)


def _excluded_paths(root: Path, skipped: set[Path], listing: list[Path]) -> list[Path]:
    """The paths below root that ruff leaves out: vendored/generated files, nested projects,
    and at the repo root the standard's own `.grimoire/` (the contracts runtime vendored in
    `.grimoire/lib` is not the project's code, so the project's rules do not apply to it)."""
    top = Path(check_repo.STANDARD_DIR)
    standard = {top} if (root / top).is_dir() else set()
    return sorted(
        {path.relative_to(root) for path in skipped}
        | set(check_repo.nested_roots(listing))
        | standard
    )


def exclude_args(root: Path, skipped: set[Path], listing: list[Path]) -> list[str]:
    """Ruff options leaving out vendored/generated files and the projects nested below.

    The patterns are absolute, so a bare name such as `tools` cannot also leave out every
    directory of that name deeper in the tree, and written out literally, so a `*` in a name or in
    the path to the repo cannot widen or lose them.
    """
    patterns = (
        literal((root / path).as_posix()) for path in _excluded_paths(root, skipped, listing)
    )
    return [arg for pattern in patterns for arg in ("--extend-exclude", pattern)]


def _glob_path_problems(root: Path, skipped: set[Path], listing: list[Path]) -> list[str]:
    """Excluded paths with glob characters in them: nothing should depend on how they are read."""
    return [
        f"{path.as_posix()}: glob characters in a path are not allowed"
        for path in _excluded_paths(root, skipped, listing)
        if GLOB_CHARS.intersection(path.as_posix())
    ]


def _tool_stage(project: check_repo.Project, stage: str, tool: str, *args: str) -> tuple[str, bool]:
    code, output = check_stages.run_tool(project.root, tool, *args)
    if code == 0:
        return "ok", True
    check_stages.show_tail(stage, output)
    return "fail", False


def _settings_stage(
    project: check_repo.Project, repo: Path, listing: list[Path], skipped: set[Path]
) -> tuple[str, bool]:
    problems = [
        *python_settings_problems(project.root, repo, listing),
        *_glob_path_problems(project.root, skipped, listing),
    ]
    for problem in problems:
        print(f"settings: {problem}")
    return ("fail", False) if problems else ("ok", True)


def _suppressions_stage(
    project: check_repo.Project, skipped: set[Path], listing: list[Path]
) -> tuple[int, bool]:
    root = project.root
    found: list[check_stages.Suppression] = []
    readable = True
    for path in check_repo.project_files(root, check_repo.PYTHON_SUFFIXES, listing):
        if path in skipped:
            continue
        scan = scan_notebook if path.suffix == ".ipynb" else scan_python
        try:
            found.extend(scan(path))
        except UnscannableError as error:
            readable = False
            found.extend(error.found)
            print(f"{path.relative_to(root).as_posix()}: {error} (suppressions cannot be counted)")
    for hit in found:
        cell = f"cell {hit.cell}:" if hit.cell is not None else ""
        print(f"{hit.path.relative_to(root).as_posix()}:{cell}{hit.line}: {hit.text}")
    return len(found), readable and not found


def _mypy_dirs(root: Path) -> list[str]:
    try:
        data = load_toml(root / check_repo.PYPROJECT)
    except (OSError, toml_error(), UnicodeDecodeError):
        return []
    listed = table(table(data, "tool"), "mypy").get("files")
    return [item for item in listed if isinstance(item, str)] if isinstance(listed, list) else []


# A regex that matches nothing, so no source text can exclude a line or a branch from coverage.
NEVER = "(?!)"


def _ini_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return ", ".join(map(str, value))
    return str(value)


def write_coverage_rc(root: Path, target: Path) -> Path:
    """The coverage config the tests stage uses, in place of the repo's own.

    It keeps the repo's allowed `[tool.coverage.run]` keys and replaces coverage's default
    exclusions (`pragma: no cover`, `...` bodies, `if TYPE_CHECKING:`) and partial-branch
    patterns with ones that match nothing: coverage matches those over the whole source text,
    comments and strings included, so they cannot be policed from the outside.

    It always measures branches (`--cov-branch` is always passed, and data combined from shards
    must be of one kind) and names the mypy directories as `source`, so a report made apart from
    pytest-cov, from combined shard data, has the same files and paths as one made with it.

    Raises ValueError when a kept value is not a plain boolean or word (it could carry a line
    break and with it a section of its own) or when the written file has other sections.
    """
    try:
        data = load_toml(root / check_repo.PYPROJECT)
    except (OSError, toml_error(), UnicodeDecodeError):
        data = {}
    run = table(table(table(data, "tool"), "coverage"), "run")
    problems = _coverage_run_problems(run)
    if "branch" in run and not isinstance(run["branch"], bool):
        problems.append(f"{check_repo.PYPROJECT} [tool.coverage.run] branch: must be true or false")
    if problems:
        raise ValueError("; ".join(problems))
    kept = {**run, "branch": True}
    lines = ["[run]"]
    lines += [f"{key} = {_ini_value(kept[key])}" for key in COVERAGE_RUN_KEYS if key in kept]
    directories = _mypy_dirs(root)
    if directories:
        lines.append(f"source = {_ini_value(directories)}")
    lines += ["", "[report]"]
    for option in ("exclude_lines", "partial_branches", "partial_branches_always"):
        lines += [f"{option} =", f"    {NEVER}"]
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")
    parser = configparser.RawConfigParser()
    try:
        parser.read(target, encoding="utf-8")
    except configparser.Error as error:
        raise ValueError(f"the coverage config cannot be read back ({error})") from error
    if parser.sections() != ["run", "report"]:
        raise ValueError(f"the coverage config has sections {parser.sections()}")
    return target


def _coverage_args(root: Path, work: Path, xml: Path | None) -> list[str] | None:
    """The pytest-cov options of full mode; None (after saying why) when the config is unusable.

    The coverage config goes into `work`. Without an `xml` path no report is written: the data
    file is all a shard needs.
    """
    try:
        rc = write_coverage_rc(root, work / "coveragerc")
    except ValueError as error:
        print(f"tests: the coverage settings cannot be used ({error})")
        return None
    return [
        *(f"--cov={directory}" for directory in _mypy_dirs(root)),
        f"--cov-config={rc}",
        "--cov-branch",
        "--cov-report=" if xml is None else f"--cov-report=xml:{xml}",
    ]


def _tests_stage(
    project: check_repo.Project, mode: str, paths: list[str], xml: Path
) -> tuple[str, bool]:
    root = project.root
    if mode == "fast" and not paths:
        return "0", True
    args = ["-q", *paths]
    if mode == "full":
        coverage_args = _coverage_args(root, xml.parent, xml)
        if coverage_args is None:
            return "fail", False
        # First, so that a missing pytest-xdist reports "-n" as the first unrecognized argument.
        args = ["-q", "-n", "auto", *paths, *coverage_args]
    code, output = check_stages.run_tool(
        root, "pytest", *args, extra_env={"COVERAGE_FILE": str(xml.parent / ".coverage")}
    )
    if code == PYTEST_NOTHING_COLLECTED and mode == "fast":
        return "0", True
    counts = PASSED.findall(output)
    passed = counts[-1] if counts else "0"
    if code == 0 and not counts and NO_TESTS_RAN not in output:
        print("tests: pytest exited 0 without a pass summary")
    elif code == 0 and mode == "full" and passed == "0":
        print("tests: no tests ran (full mode needs at least one passing test)")
    elif code == 0:
        return passed, True
    _show_test_failure(output)
    return "fail", False


SHARD_PLUGIN = "grimoire_shard_plugin"
# A project's key names its directory in the shard output, so it stays plain.
PROJECT_KEY = re.compile(r"[A-Za-z0-9._/-]+")
COVERAGE_DATA = "coverage.data"


@dataclass(frozen=True)
class ShardSlice:
    """What one Python project's slice of a shard produced."""

    passed: int
    collected: int
    selected: int
    digest: str


def key_problem(key: str) -> str | None:
    """Why a project key cannot name a directory in the shard output, or None when it can."""
    if PROJECT_KEY.fullmatch(key) and ".." not in key.split("/"):
        return None
    return "the project path cannot name a shard result (only [A-Za-z0-9._/-], no ..)"


def _shard_report(path: Path) -> tuple[int, int, str] | None:
    """The plugin's `collected`, `selected` and `digest`; None when the report is absent or bad."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict):
        return None
    collected, selected, digest = data.get("collected"), data.get("selected"), data.get("digest")
    if isinstance(collected, int) and isinstance(selected, int) and isinstance(digest, str):
        return collected, selected, digest
    return None


def shard_stage(
    project: check_repo.Project, shard: tuple[int, int], work: Path, plugin_dir: Path, dest: Path
) -> ShardSlice | None:
    """Run the project's slice `I/N` of the tests with coverage; None (after saying why) on failure.

    The coverage data goes to `dest/coverage.data` when the slice ran any test. A slice with
    nothing selected makes pytest exit 5; that is a pass only because the plugin says it selected
    nothing, so a missing report is a failure.
    """
    work.mkdir(parents=True, exist_ok=True)
    coverage_args = _coverage_args(project.root, work, None)
    if coverage_args is None:
        return None
    report, data = work / "shard-report.json", work / ".coverage"
    env = {
        "GRIMOIRE_SHARD": f"{shard[0]}/{shard[1]}",
        "GRIMOIRE_SHARD_REPORT": str(report),
        "COVERAGE_FILE": str(data),
        "PYTHONPATH": check_stages.pythonpath(plugin_dir),  # the plugin's directory first
    }
    # `-n` first, so that a missing pytest-xdist reports it as the first unrecognized argument.
    args = ["-q", "-n", "auto", "-p", SHARD_PLUGIN, *coverage_args]
    code, output = check_stages.run_tool(project.root, "pytest", *args, extra_env=env)
    seen = _shard_report(report)
    if seen is None:
        print("tests: the shard plugin wrote no report")
        _show_test_failure(output)
        return None
    collected, selected, digest = seen
    if code != 0 and not (code == PYTEST_NOTHING_COLLECTED and selected == 0):
        _show_test_failure(output)
        return None
    if selected == 0:
        return ShardSlice(0, collected, selected, digest)
    if not data.is_file():
        print("tests: pytest wrote no coverage data")
        return None
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(data, dest / COVERAGE_DATA)
    counts = PASSED.findall(output)
    return ShardSlice(int(counts[-1]) if counts else 0, collected, selected, digest)


SHARD_RESULT = "result.json"
RUNNERS = ("uv", "override")


class _Malformed(ValueError):
    """A result.json that does not have the shape `check.py shard` writes."""


@dataclass(frozen=True)
class ShardResult:
    """One shard's result.json, read."""

    where: str  # the file as the messages name it: below the shards directory
    directory: Path
    index: int
    total: int
    sha: str
    dirty: bool
    runner: str
    root: str
    projects: dict[str, ShardSlice]


@dataclass(frozen=True)
class ShardSet:
    """Every shard of one run of `check.py shard`, verified against this checkout."""

    shards: tuple[ShardResult, ...]

    @property
    def total(self) -> int:
        return self.shards[0].total

    @property
    def dirty(self) -> bool:
        return any(shard.dirty for shard in self.shards)

    @property
    def override(self) -> bool:
        return any(shard.runner == "override" for shard in self.shards)

    def passed(self, key: str) -> int:
        return sum(shard.projects[key].passed for shard in self.shards)

    def data_files(self, key: str) -> list[Path]:
        """The coverage data of the project: one file per shard that ran any of its tests."""
        return [
            shard.directory / key / COVERAGE_DATA
            for shard in self.shards
            if shard.projects[key].selected > 0
        ]


def _bad(name: str, noun: str, prefix: str) -> _Malformed:
    return _Malformed(f'{prefix}"{name}" is missing or not {noun}')


def _whole(data: dict[str, Any], name: str, prefix: str = "", noun: str = "a whole number") -> int:
    value = data.get(name)
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    raise _bad(name, noun, prefix)


def _text(data: dict[str, Any], name: str, prefix: str = "") -> str:
    value = data.get(name)
    if not isinstance(value, str):
        raise _bad(name, "text", prefix)
    if not value.isprintable():  # a newline here could forge a line of the check's own output
        raise _Malformed(f'{prefix}"{name}" has a non-printable character')
    return value


def _flag(data: dict[str, Any], name: str) -> bool:
    value = data.get(name)
    if isinstance(value, bool):
        return value
    raise _bad(name, "true or false", "")


def _object(data: dict[str, Any], name: str) -> dict[str, Any]:
    value = data.get(name)
    if isinstance(value, dict):
        return value
    raise _bad(name, "an object", "")


def _count(data: dict[str, Any], name: str, prefix: str) -> int:
    noun = "a non-negative whole number"
    value = _whole(data, name, prefix, noun)
    if value < 0:
        raise _bad(name, noun, prefix)
    return value


def _read_slice(key: str, raw: object) -> ShardSlice:
    if not key.isprintable():  # the message below prints the key
        raise _Malformed('a "projects" key has a non-printable character')
    prefix = f'"projects"."{key}" '
    if not isinstance(raw, dict):
        raise _Malformed(f"{prefix.strip()} is missing or not an object")
    return ShardSlice(
        _count(raw, "passed", prefix),
        _count(raw, "collected", prefix),
        _count(raw, "selected", prefix),
        _text(raw, "digest", prefix),
    )


def _read_result(path: Path, where: str) -> ShardResult:
    """The result.json at `path`; raises _Malformed, saying what is wrong, when it is not one."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise _Malformed("cannot be read") from error
    except (ValueError, RecursionError) as error:  # bad UTF-8 and bad JSON alike
        raise _Malformed("not valid JSON") from error
    if not isinstance(data, dict):
        raise _Malformed("must be a JSON object")
    index, total = _whole(data, "shard"), _whole(data, "total")
    if not 1 <= index <= total:
        raise _Malformed(f"shard {index}/{total} is out of range (want 1 <= I <= N)")
    runner = _text(data, "runner")
    if runner not in RUNNERS:
        raise _Malformed(f'"runner" must be {" or ".join(RUNNERS)}, not {runner}')
    return ShardResult(
        where=where,
        directory=path.parent,
        index=index,
        total=total,
        sha=_text(data, "sha"),
        dirty=_flag(data, "dirty"),
        runner=runner,
        root=_text(data, "root"),
        projects={key: _read_slice(key, raw) for key, raw in _object(data, "projects").items()},
    )


def read_shards(directory: Path) -> list[ShardResult] | str:
    """Every `DIR/*/result.json`, sorted by shard; or the first problem reading them."""
    paths = sorted(directory.glob(f"*/{SHARD_RESULT}"))
    if not paths:
        return f"no shard results in {directory} (want {directory}/*/{SHARD_RESULT})"
    results = []
    for path in paths:
        where = path.relative_to(directory).as_posix()
        try:
            results.append(_read_result(path, where))
        except _Malformed as error:
            return f"{where}: {error}"
    return sorted(results, key=lambda result: (result.index, result.where))


def _numbering_problem(results: list[ShardResult]) -> str | None:
    """Whether the results are the shards 1..N of one run, each exactly once."""
    counts = {result.total for result in results}
    if len(counts) > 1:
        first = {result.total: result.where for result in reversed(results)}
        places = ", ".join(f"{total} in {first[total]}" for total in sorted(counts))
        return f"the shards disagree on the shard count: {places}"
    total = results[0].total
    seen: dict[int, list[str]] = {}
    for result in results:
        seen.setdefault(result.index, []).append(result.where)
    for index in range(1, total + 1):
        if index not in seen:
            return f"shard {index}/{total} is missing"
        if len(seen[index]) > 1:
            return f"shard {index}/{total} appears twice ({', '.join(seen[index])})"
    return None


def _origin_problem(results: list[ShardResult], head: str, root: str) -> str | None:
    for result in results:
        if result.sha != head:
            return (
                f"{result.where}: sha {result.sha[:7]} is not HEAD {head[:7]} "
                "(it ran another commit)"
            )
        if result.root != root:
            return (
                f"{result.where}: root {result.root} is not this repo's root {root} "
                "(its coverage data holds that checkout's paths)"
            )
    return None


def _projects_problem(results: list[ShardResult], keys: Collection[str]) -> str | None:
    known = ", ".join(sorted(keys))
    for result in results:
        for key in sorted(keys):
            if key not in result.projects:
                return (
                    f"{result.where}: project {key} is missing "
                    f"(this repo's Python projects: {known})"
                )
        for key in sorted(result.projects):
            if key not in keys:
                return (
                    f"{result.where}: {key} is not a Python project of this repo "
                    f"(this repo's Python projects: {known})"
                )
    return None


def _suite_problem(results: list[ShardResult], key: str) -> str | None:
    """Whether the shards saw one suite of the project and ran each test of it once."""
    first = results[0]
    for result in results[1:]:
        if result.projects[key].collected != first.projects[key].collected:
            return (
                f"{key}: the shards collected different numbers of tests "
                f"({first.projects[key].collected} in {first.where}, "
                f"{result.projects[key].collected} in {result.where})"
            )
    for result in results[1:]:
        if result.projects[key].digest != first.projects[key].digest:
            return (
                f"{key}: the shards collected different tests "
                f"(the digest of {result.where} differs from {first.where})"
            )
    selected = sum(result.projects[key].selected for result in results)
    if selected != first.projects[key].collected:
        return (
            f"{key}: the shards ran {selected} of {first.projects[key].collected} collected "
            "tests (each test must run in exactly one shard)"
        )
    return None


def _passed_problem(results: list[ShardResult], key: str) -> str | None:
    if sum(result.projects[key].passed for result in results) < 1:
        return f"{key}: no test passed in any shard (full mode needs at least one passing test)"
    return None


def _data_problem(results: list[ShardResult], key: str) -> str | None:
    for result in results:
        sliced = result.projects[key]
        if sliced.selected > 0 and not (result.directory / key / COVERAGE_DATA).is_file():
            data = PurePosixPath(result.where).parent / key / COVERAGE_DATA
            return (
                f"{data} is missing (shard {result.index}/{result.total} ran "
                f"{sliced.selected} tests of {key})"
            )
    return None


def _first_per_project(
    check: Callable[[list[ShardResult], str], str | None],
    results: list[ShardResult],
    keys: Collection[str],
) -> str | None:
    for key in sorted(keys):
        problem = check(results, key)
        if problem is not None:
            return problem
    return None


def shard_problem(
    results: list[ShardResult], head: str, root: str, keys: Collection[str]
) -> str | None:
    """The first reason the results cannot stand for a run of the whole suite here, or None.

    `head` is this checkout's full sha, `root` its top directory and `keys` the project keys of
    its Python projects. The order is the order a reader would check in: the set of shards, where
    they ran, which projects, which tests, then the files the combine needs.
    """
    return (
        _numbering_problem(results)
        or _origin_problem(results, head, root)
        or _projects_problem(results, keys)
        or _first_per_project(_suite_problem, results, keys)
        or _first_per_project(_passed_problem, results, keys)
        or _first_per_project(_data_problem, results, keys)
    )


def load_shards(directory: Path, head: str, root: str, keys: Collection[str]) -> ShardSet | str:
    """The verified shards below `directory`, or the first problem (a message to show)."""
    results = read_shards(directory)
    if isinstance(results, str):
        return results
    problem = shard_problem(results, head, root, keys)
    return problem if problem is not None else ShardSet(tuple(results))


def _has_code(path: Path) -> bool:
    """Whether the file has a line besides blanks and comments (coverage may skip the rest)."""
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return True
    return any(line.strip() and not line.strip().startswith("#") for line in lines)


def _changed_code(root: Path, base: str, listing: list[Path]) -> list[Path]:
    """Python files changed since `base` that coverage must measure: in scope, not tests."""
    done = check_repo.git(
        root, "diff", "--name-only", "--relative", "-z", "--diff-filter=ACMR", base
    )
    changed = {Path(name) for name in done.stdout.split("\0") if name}
    directories = [Path(os.path.normpath(entry)) for entry in _mypy_dirs(root)]
    return sorted(
        rel
        for rel in _in_scope_python(root, listing)
        if rel in changed
        and rel.suffix == ".py"
        and not _is_test_file(rel)
        and check_repo.under(rel, directories)
        and _has_code(root / rel)
    )


def _report_classes(root: Path, xml: Path) -> list[list[Path]] | None:
    """Per class of a coverage.xml, the files on disk it may stand for; None when unreadable.

    A class names its file relative to the report's source directories, so with several sources
    the same name can match a file under each.
    """
    sources: list[str] = []
    names: list[str] = []
    in_source = False

    def start(tag: str, attributes: dict[str, str]) -> None:
        nonlocal in_source
        in_source = tag == "source"
        if in_source:
            sources.append("")
        elif tag == "class":
            names.append(attributes.get("filename", ""))

    def text(data: str) -> None:
        if in_source:
            sources[-1] += data

    def end(_tag: str) -> None:
        nonlocal in_source
        in_source = False

    parser = expat.ParserCreate()
    parser.StartElementHandler = start
    parser.CharacterDataHandler = text
    parser.EndElementHandler = end
    try:
        parser.Parse(xml.read_bytes(), True)
    except (expat.ExpatError, OSError):
        return None
    bases = [root / source.strip() for source in sources]
    return [
        [(base / name).resolve() for base in bases if (base / name).is_file()] for name in names
    ]


def _coverage_gap(root: Path, base: str, xml: Path, listing: list[Path]) -> str | None:
    """Why the coverage report cannot vouch for the changed code, or None when it can.

    A directory without `__init__.py` is invisible to coverage until something imports it, and
    diff-cover reads a file that is absent as having no changed lines to cover.
    """
    classes = _report_classes(root, xml)
    if classes is None:
        return "the coverage report cannot be read"
    ambiguous: list[str] = []
    missing: list[str] = []
    for rel in _changed_code(root, base, listing):
        matching = [files for files in classes if (root / rel).resolve() in files]
        if any(len(files) > 1 for files in matching):
            ambiguous.append(rel.as_posix())
        elif not matching:
            missing.append(rel.as_posix())
    if ambiguous:
        return (
            f"ambiguous coverage paths: {check_repo.shown(ambiguous)} "
            "(the same relative path exists under more than one source directory)"
        )
    if missing:
        return (
            f"not measured: {check_repo.shown(missing)} "
            "(changed, but absent from the coverage report; "
            "a directory without __init__.py is invisible to it)"
        )
    return None


def _coverage_stage(
    project: check_repo.Project, mode: str, base: str | None, xml: Path, listing: list[Path]
) -> tuple[str, bool]:
    root = project.root
    if mode == "fast":
        return "skip", True
    if base is None:
        print("note: no base commit to compare; changed-line coverage skipped")
        return "skip", True
    if not xml.is_file():
        print("coverage: no coverage report was written (see the tests stage)")
        return "fail", False
    gap = _coverage_gap(root, base, xml, listing)
    if gap is not None:
        print(f"coverage: {gap}")
        return "fail", False
    return check_stages.changed_line_coverage(root, base, xml)


def _shard_tests_stage(shards: ShardSet | str, key: str) -> check_stages.Outcome:
    """The tests stage of a project whose tests ran in shards: their count, or why not.

    `shards` is the verified set, or the message saying why the shards cannot be used.
    """
    if isinstance(shards, str):
        print(f"tests: {shards}")
        return "fail", False
    return str(shards.passed(key)), True


def _combine_shards(project: check_repo.Project, data_files: list[Path], xml: Path) -> bool:
    """Combine the shards' coverage data and write the XML report; False after saying why not.

    The shards' files stay where they are. The data file is set on each command: `run_tool` drops
    every COVERAGE_* variable.
    """
    work = xml.parent
    try:
        rc = write_coverage_rc(project.root, work / "coveragerc")
    except ValueError as error:
        print(f"coverage: the coverage settings cannot be used ({error})")
        return False
    options = [f"--data-file={work / '.coverage'}", f"--rcfile={rc}"]
    code, output = check_stages.run_tool(
        project.root, "coverage", "combine", "--keep", *options, *map(str, data_files)
    )
    if code == 0:
        code, output = check_stages.run_tool(
            project.root, "coverage", "xml", *options, "-o", str(xml)
        )
    if code != 0:
        check_stages.show_tail("coverage", output)
    return code == 0


def python_stages(
    project: check_repo.Project,
    run: check_stages.Run,
    paths: list[str],
    xml: Path,
    shards: ShardSet | str | None = None,
) -> check_stages.Stages:
    """The project's stages.

    With `shards` (full mode) the tests were run by `check.py shard`: either the verified set,
    whose counts and coverage data stand in for a pytest run, or the message saying why not.
    """
    xml.parent.mkdir(parents=True, exist_ok=True)
    listing = check_repo.listing(project.root)  # asked of git once for all the stages
    skipped = check_repo.excluded_files(
        project.root, check_repo.project_files(project.root, check_repo.PYTHON_SUFFIXES, listing)
    )
    exclude = exclude_args(project.root, skipped, listing)
    if shards is None:
        tests, reported = _tests_stage(project, run.mode, paths, xml), True
    else:
        key = check_repo.where(run.repo, project)
        tests = _shard_tests_stage(shards, key)
        reported = isinstance(shards, str) or _combine_shards(project, shards.data_files(key), xml)
    return check_stages.Stages(
        settings=_settings_stage(project, run.repo, listing, skipped),
        suppressions=_suppressions_stage(project, skipped, listing),
        format=_tool_stage(project, "format", "ruff", "format", "--check", *exclude, "."),
        lint=_tool_stage(project, "lint", "ruff", "check", *exclude, "."),
        types=_tool_stage(project, "types", "mypy"),
        tests=tests,
        coverage=(
            _coverage_stage(project, run.mode, run.base, xml, listing)
            if reported
            else ("fail", False)
        ),
        skipped=len(skipped),
    )
