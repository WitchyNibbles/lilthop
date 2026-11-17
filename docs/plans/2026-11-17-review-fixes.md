# Review Fixes for 0.1.1 Implementation Plan

> **Status:** done. Every task below is in 0.1.1. The step boxes were not ticked as the work went, so they still show as open.

**Goal:** Fix the ten findings from the 2026-11-17 review that were marked "fix first" and "next", then ship them as version 0.1.1.

**Architecture:** Every fix lands in the module that owns the behaviour: storage and audio in `src-tauri/src`, screens and hooks in `src`, the gates in `.github/workflows`. No new dependency. The only new type is `ChannelMix` in the audio capture module.

**Tech Stack:** Rust 2024 (Tauri 2, rusqlite, zip, cpal, ringbuf), React 19 with TypeScript, vitest with jsdom, GitHub Actions.

**Spec:** There is no separate spec file. Each task opens with the finding it fixes, and that text is the requirement.

## Global Constraints

- Tests come first. Each fix starts with a test that fails for the reason the finding gives.
- An existing test may be edited only where this plan names it. The commit message says which test changed and why.
- No new dependency, no lint or type suppression, no `--no-verify`. Never edit `.grimoire/`.
- No user name, home folder path or email address in any tracked file.
- Copy goes into `src/i18n/en.ts` and `src/i18n/es.ts` together. It stays plain and warm and never blames the person. Strip text stays at 190 characters or less.
- `DESIGN.md` is the design system: tokens only, no raw hex, one gold action per view, nothing over the band or the thread, reserved slots keep their size.
- TypeScript checks: `python3 .grimoire/check.py fast <test files>`.
- Rust checks, from `src-tauri`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`. Cargo is in `~/.cargo/bin` and may not be on `PATH`.
- One commit per finding, in the repo's style: `area: what changed, so that why`. No `Co-Authored-By` trailer and no "Generated with" line.
- Actions in workflows are pinned to a full commit SHA with the version in a comment.

## Review Focus

1. The database file is from a newer version, or is not a database at all. The app must open, say what is wrong and leave the file as it was. Task 3 pins both.
2. A backup the app made holds more recording data than the total cap. It must restore. A file that unpacks to more than the cap and more than itself must still be refused with nothing written. Task 4 pins both.
3. A release tag lands on a commit whose tests fail. No draft may be created. This cannot run locally, so Task 1 is reviewed by reading the workflow, and a test keeps every version string in step.
4. A microphone on one channel of a device with several. Its level must survive the mix-down, equal channels must come out unchanged, and silence must stay silence. Task 5 pins all three.
5. Skip on "Set your range" after measuring. The suggested range must be saved. With nothing measured there is no range, and Practice must offer the way to Settings. Task 6 pins both.

---

### Task 1: Tooling and the release gate (R4, R1)

**Findings.** R4: `npm test` collects the test files of other checkouts under `.claude/worktrees/`, so it fails for reasons that are not in this checkout. R1: version 0.1.0 was built from a commit whose CI was red, because `release.yml` runs no checks and compares the tag only with `package.json`.

**Files:**

- Modify: `vitest.config.ts`
- Modify: `eslint.config.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Create: `tools/appVersion.test.ts`

**Interfaces:**

- Produces: `ci.yml` can be called with `uses: ./.github/workflows/ci.yml`. `tools/appVersion.test.ts` fails when any version string disagrees with `package.json`. Task 7 relies on that test when it bumps the version.

- [ ] **Step 1: Show the R4 failure**

Create `.claude/worktrees/probe/src/probe.test.ts` (the folder is ignored by git) with one test that fails:

```ts
import { expect, it } from "vitest";

it("must not be collected", () => {
  expect(true).toBe(false);
});
```

Run: `npx vitest run`
Expected: FAIL, and the output names `.claude/worktrees/probe/src/probe.test.ts`.

- [ ] **Step 2: Keep the tools out of `.claude/`**

In `vitest.config.ts`, add `exclude: [...configDefaults.exclude, ".claude/**"]` to `test`, with `configDefaults` imported from `vitest/config`. In `eslint.config.mjs`, add `".claude/"` to the `ignores` list.

- [ ] **Step 3: Show it is fixed, then remove the probe**

Run: `npx vitest run`
Expected: PASS, the same number of test files as before the probe was added, and no mention of the probe.

Run: `npx eslint .claude/worktrees/probe/src/probe.test.ts`
Expected: a warning that the file is ignored, and no lint errors.

Then delete `.claude/` from the worktree. This step adds no permanent test: it is tool configuration, and the probe run is its evidence. Put both outputs in the report.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts eslint.config.mjs
git commit -m "tests and lint: skip .claude, so other checkouts under it are not collected"
```

- [ ] **Step 5: Write the version test**

`tools/appVersion.test.ts` reads the files from the repo root with `node:fs` and has two tests:

```ts
describe("the app's version", () => {
  it("is the same in every file that carries it", () => {
    // package.json is the reference. Equal to it:
    //   package-lock.json: .version and .packages[""].version
    //   src-tauri/tauri.conf.json: .version
    //   src-tauri/Cargo.toml: version in the [package] table
    //   src-tauri/Cargo.lock: version of the [[package]] named "lilthop"
  });

  it("is the one the README's download links point at", () => {
    // In README.md, every version that follows "releases/tag/v" or
    // "releases/download/v", every file name of the form Lilthop_<version>_
    // or Lilthop-<version>-, and the "Version <version>," line.
    // There is at least one of each, so a reworded README cannot pass empty.
  });
});
```

Each assertion names the file in its message, so a failure says where the stale version is.

- [ ] **Step 6: Watch it catch a mismatch**

Change the version in `src-tauri/tauri.conf.json` to `9.9.9`.
Run: `npx vitest run tools/appVersion.test.ts`
Expected: FAIL, naming `src-tauri/tauri.conf.json`.
Put the version back.
Run: `npx vitest run tools/appVersion.test.ts`
Expected: PASS.

- [ ] **Step 7: Gate the release on the checks**

In `.github/workflows/ci.yml`, replace the trigger block with:

```yaml
# Tags are not listed: release.yml calls this workflow for them, so the same
# checks run once before a release is built.
on:
  push:
    branches: ["**"]
  pull_request:
  workflow_call:
```

In `.github/workflows/release.yml`, add this as the first job, and give `create-release` the line `needs: checks`:

```yaml
# The same checks as CI, on the tagged commit. A red commit gets no draft.
checks:
  name: Checks
  uses: ./.github/workflows/ci.yml
```

Update the comment at the top of `release.yml` so it says the checks run first. The "Tag matches the app version" step stays as it is: the version test from step 5 now runs inside `checks`, so a tag that matches `package.json` matches every other file too.

- [ ] **Step 8: Check the workflow files parse**

Run: `python3 -c "import yaml,sys; [yaml.safe_load(open(f)) for f in sys.argv[1:]]; print('ok')" .github/workflows/ci.yml .github/workflows/release.yml`
Expected: `ok`. The workflows themselves cannot run locally. Say so in the report.

- [ ] **Step 9: Run the checks and commit**

Run: `python3 .grimoire/check.py fast tools/appVersion.test.ts`
Expected: exit 0.

```bash
git add tools/appVersion.test.ts .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "release: run the CI checks before the draft, and keep every version in step with a test"
```

---

### Task 2: Dependencies with open advisories (R3)

**Finding.** `zip 2.6.1`, `ringbuf 0.4.8` and `libsqlite3-sys 0.30.1` (through `rusqlite 0.32`) have open RustSec advisories. None is reachable from this code, but nothing watches for the next one: there is no Dependabot config and no `cargo audit` run.

**Files:**

- Create: `src-tauri/tests/fixtures/backup-0.1.0.zip`
- Modify: `src-tauri/src/storage/backup.rs` (one new test, and call sites if the zip API moved)
- Modify: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`
- Modify as the new APIs require: `src-tauri/src/error.rs`, `src-tauri/src/storage/*.rs`, `src-tauri/src/audio/capture.rs`, `src-tauri/src/audio/recorder.rs`, `src-tauri/src/audio/pitch_stream.rs`
- Modify: `THIRD-PARTY-NOTICES.md` (generated)
- Create: `.github/workflows/audit.yml`
- Create: `.github/dependabot.yml`

**Interfaces:**

- Produces: the fixture `src-tauri/tests/fixtures/backup-0.1.0.zip` and the test `a_backup_made_by_version_0_1_0_still_restores`. Task 4 must keep that test green without editing it.

- [ ] **Step 1: Keep a backup made by the released code**

Before touching `Cargo.toml`, add a temporary `#[ignore]` test in `backup.rs` that calls `create_to` on the `filled()` environment and copies the zip to `src-tauri/tests/fixtures/backup-0.1.0.zip`. Run it once with `cargo test -- --ignored <its name>`, then delete the temporary test. The fixture holds only the synthetic data of `filled()`: a profile, three results, two recordings and one note.

- [ ] **Step 2: Pin that it restores**

```rust
#[test]
fn a_backup_made_by_version_0_1_0_still_restores() {
    let e = env();
    let (_o, zip_path) = out_file("old.zip");
    fs::write(&zip_path, include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/fixtures/backup-0.1.0.zip"
    )))
    .unwrap();

    let summary = restore_from(&e.base, &e.conn, &zip_path, NOW).unwrap();

    assert_eq!((summary.results, summary.recordings, summary.profile), (3, 2, true));
    assert_eq!(fs::metadata(recordings_dir(&e.base).join("rec_1.wav")).unwrap().len(), 1644);
    assert_eq!(fs::metadata(recordings_dir(&e.base).join("rec_2.wav")).unwrap().len(), 3244);
    assert_eq!(db::get_meta(&e.conn, "rec_1.wav").unwrap().unwrap().note, "first take");
}
```

If `write_wav` does not write a 44-byte header plus two bytes per frame, use the sizes it does write. Run: `cargo test a_backup_made_by_version_0_1_0_still_restores`. Expected: PASS, on the old crates.

- [ ] **Step 3: Commit the fixture and its test**

```bash
git add src-tauri/tests/fixtures/backup-0.1.0.zip src-tauri/src/storage/backup.rs
git commit -m "backup tests: keep a backup made by 0.1.0, so a zip crate bump cannot orphan old backups"
```

- [ ] **Step 4: Raise the three crates**

Find the newest release of each with `cargo search <name> --limit 1`, then read its changelog or its docs.rs pages for what changed since the version in use. Do not guess an API from memory. In `src-tauri/Cargo.toml`:

- `zip`: the newest 9.x, still with `default-features = false` and only the feature that gives Deflate reading and writing. No AES, no bzip2, no zstd, no time.
- `rusqlite`: the newest release, still with `bundled`.
- `ringbuf`: the newest release.

Adapt the call sites. The behaviour does not change, so no existing assertion changes. If a test helper must move to a renamed API, say which one in the report.

- [ ] **Step 5: Run the Rust checks**

Run, from `src-tauri`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`
Expected: all three exit 0, with the fixture test among the passing tests.

- [ ] **Step 6: Regenerate the notices**

Run, from the repo root: `cargo fetch --locked --manifest-path src-tauri/Cargo.toml`, then `npm run notices`, then `npx vitest run tools`
Expected: `THIRD-PARTY-NOTICES.md` changes only for crates whose versions moved, and the tools tests pass.

- [ ] **Step 7: Audit the new lock file**

Run: `cargo install cargo-audit --locked`, then, from `src-tauri`, `cargo audit`
Expected: no vulnerabilities. Warnings for unmaintained or unsound crates in Tauri's own tree are expected and stay. If a vulnerability remains, do not add an `--ignore`: stop and report it with its id.

- [ ] **Step 8: Commit the bumps**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src THIRD-PARTY-NOTICES.md
git commit -m "deps: newer zip, rusqlite and ringbuf, so their open advisories are closed"
```

- [ ] **Step 9: Add the audit workflow and Dependabot**

`.github/workflows/audit.yml`: named `Audit`. It runs weekly on a schedule, on `workflow_dispatch`, and on pushes to `main` and pull requests that touch `src-tauri/Cargo.toml` or `src-tauri/Cargo.lock`. It has `permissions: contents: read` and one job on `ubuntu-latest` with `timeout-minutes: 20`: checkout and the Rust toolchain, both pinned to the same SHAs `ci.yml` uses, then `cargo install cargo-audit --locked`, then `cargo audit` with `working-directory: src-tauri`. No new third-party action.

`.github/dependabot.yml`: `version: 2`, with two weekly entries, `cargo` in `/src-tauri` and `npm` in `/`. Each has `open-pull-requests-limit: 5` and one group for minor and patch updates, so they arrive as one pull request per ecosystem. The `github-actions` ecosystem is left out, with a comment saying why: `grimoire-check.yml` is synced from the grimoire standard, and Dependabot would rewrite its pins.

Run the YAML parse command from Task 1, step 8, on both new files. Expected: `ok`.

- [ ] **Step 10: Commit**

```bash
git add .github/workflows/audit.yml .github/dependabot.yml
git commit -m "ci: a weekly cargo audit and Dependabot for cargo and npm, so the next advisory is seen"
```

---

### Task 3: The app opens even when its database will not (S1)

**Finding.** `Storage::init` returns the error of its first database open (`src-tauri/src/storage/mod.rs`, the `drop(storage.conn()?)` line). Tauri turns a failed `setup` into a panic. A Windows release build has no console, so the app never appears and says nothing. A database from a newer version, a damaged file and a folder that cannot be created all end this way.

**Files:**

- Modify: `src-tauri/src/storage/mod.rs`
- Modify: `src-tauri/src/storage/db.rs`
- Modify: `src-tauri/src/error.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/shell/LoadFailedScreen.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/es.ts`
- Test: `src-tauri/src/storage/mod.rs`, `src-tauri/src/storage/db.rs`, `src-tauri/src/error.rs`, `src/app/ProfileLoad.test.tsx`

**Interfaces:**

- Produces: `Storage::init(base: PathBuf, previous: Option<&Path>, legacy: Option<&Path>) -> Self`. It cannot fail.
- Produces: `ErrorKind::NewerData`, serialized as `"newer_data"`.

**Decisions:**

- `init` still tries the folders, the move of earlier data and one open. A failure is written to stderr and left for the next `conn()` to report. The screen that already handles a failed profile read (`LoadFailedScreen`) then shows it.
- `conn()` creates the recordings folder itself before it settles, so "Try again" can recover from a folder that could not be made at start.
- The database file is never deleted, moved or rewritten because it failed to open.
- `db::migrate` returns `NewerData` instead of `Database` when `user_version` is above `SCHEMA_VERSION`. Check every other place that matches on `ErrorKind::Database` or handles a newer database (the old-folder code in `db.rs` and `old_folder.rs`): their behaviour and their tests stay as they are.
- A failure to resolve the data folder path in `open_storage` stays fatal. It needs a machine with no home folder, and there is nowhere to store anything then.

- [ ] **Step 1: Write the failing Rust tests**

In the tests of `storage/mod.rs`:

```rust
#[test]
fn the_app_starts_when_the_database_is_from_a_newer_version() {
    let dir = tempdir().unwrap();
    let base = dir.path().join("data");
    fs::create_dir_all(paths::recordings_dir(&base)).unwrap();
    let conn = Connection::open(paths::db_path(&base)).unwrap();
    conn.pragma_update(None, "user_version", db::SCHEMA_VERSION + 1).unwrap();
    drop(conn);
    let before = fs::read(paths::db_path(&base)).unwrap();

    let storage = Storage::init(base.clone(), None, None);

    assert_eq!(storage.conn().unwrap_err().kind(), ErrorKind::NewerData);
    assert_eq!(fs::read(paths::db_path(&base)).unwrap(), before);
}

#[test]
fn the_app_starts_when_the_database_file_is_not_a_database() {
    let dir = tempdir().unwrap();
    let base = dir.path().join("data");
    fs::create_dir_all(paths::recordings_dir(&base)).unwrap();
    let junk = b"this is not a database ".repeat(200);
    fs::write(paths::db_path(&base), &junk).unwrap();

    let storage = Storage::init(base.clone(), None, None);

    assert_eq!(storage.conn().unwrap_err().kind(), ErrorKind::Database);
    assert_eq!(fs::read(paths::db_path(&base)).unwrap(), junk);
}

#[test]
fn the_app_starts_when_its_folder_cannot_be_made_and_recovers_once_it_can() {
    let dir = tempdir().unwrap();
    let blocker = dir.path().join("blocker");
    fs::write(&blocker, b"a file where a folder should go").unwrap();
    let base = blocker.join("data");

    let storage = Storage::init(base, None, None);

    assert!(storage.conn().is_err());
    fs::remove_file(&blocker).unwrap();
    assert!(storage.conn().is_ok());
    assert!(storage.recordings_dir().is_dir());
}
```

In `db.rs`, the test `newer_database_is_refused_and_left_alone` now expects `ErrorKind::NewerData`. In `error.rs`, add `(ErrorKind::NewerData, "newer_data")` to `kinds_use_the_names_the_ui_branches_on`.

- [ ] **Step 2: Run them to see them fail**

Run, from `src-tauri`: `cargo test the_app_starts`
Expected: a compile error, because `init` still returns a `Result` and `NewerData` does not exist.

- [ ] **Step 3: Implement**

Add `ErrorKind::NewerData` with `as_str` `"newer_data"`. Return it from `db::migrate`. Change `Storage::init` to return `Self` as decided above and update the doc comment. Move the folder creation into `conn()`'s path. Update `open_storage` in `lib.rs`. The 40 existing `Storage::init(...).unwrap()` calls in the tests lose their `.unwrap()`. That is the only edit to them.

- [ ] **Step 4: Run the Rust checks**

Run, from `src-tauri`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`
Expected: all exit 0.

- [ ] **Step 5: Write the failing screen test**

In `src/app/ProfileLoad.test.tsx`, a new `describe("when the data is from a newer version")`:

```ts
const NEWER = {
  kind: "newer_data",
  message: "this data was saved by a newer version of the app",
};

it("says so, and offers neither setup nor a fresh start", async () => {
  backend.fail("get_profile", NEWER);
  await boot();
  expect(
    stage().getByRole("heading", { name: t("load.newerTitle") }),
  ).toBeInTheDocument();
  expect(stage().getByRole("alert")).toHaveTextContent(t("error.newer_data"));
  expect(
    stage().queryByRole("button", { name: t("load.startFresh") }),
  ).toBeNull();
  expect(setup()).toBeNull();
  expect(tryAgainButton()).toBeInTheDocument();
});
```

Run: `npx vitest run src/app/ProfileLoad.test.tsx`
Expected: FAIL, because `load.newerTitle` is not a message key.

- [ ] **Step 6: Add the copy and the screen branch**

| Key                | English                                                                                                                                        | Spanish                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `load.newerTitle`  | This data is from a newer Lilthop                                                                                                              | Estos datos son de un Lilthop más nuevo                                                                                                                        |
| `error.newer_data` | Your data was saved by a newer version of Lilthop, and this version can't read it. Nothing was changed. Install the newest version to open it. | Tus datos se guardaron con una versión más nueva de Lilthop y esta versión no puede leerlos. No se cambió nada. Instala la versión más reciente para abrirlos. |

In `LoadFailedScreen`, a read error of kind `newer_data` shows `load.newerTitle` and `error.newer_data`. It keeps "Try again" and the existing `load.stillFailed` line, and it does not offer "Start fresh".

- [ ] **Step 7: Run the checks and commit**

Run: `python3 .grimoire/check.py fast src/app/ProfileLoad.test.tsx src/i18n/i18n.test.ts`
Expected: exit 0.

```bash
git add src-tauri/src src/shell/LoadFailedScreen.tsx src/i18n/en.ts src/i18n/es.ts src/app/ProfileLoad.test.tsx
git commit -m "storage: start even when the database will not open, so the app can say what is wrong instead of never appearing"
```

---

### Task 4: A backup the app made always restores (S2)

**Finding.** `Limits::default()` in `src-tauri/src/storage/backup.rs` refuses a recording over 1 GiB and a backup whose entries add up to more than 4 GiB. The recorder writes takes of up to 3.5 GiB, and nothing caps the recordings folder. At 48 kHz, 4 GiB is about 12 hours of recordings. Past that, the app writes a backup it will then refuse to restore.

**Files:**

- Modify: `src-tauri/src/storage/backup.rs`

**Interfaces:**

- Consumes: `crate::audio::recorder::MAX_DATA_BYTES`, and the fixture test from Task 2, which stays green and unedited.

**Decisions:**

- `max_wav_bytes` becomes `u32::MAX as u64 + 8`: the largest file a WAV header can describe, so no real recording is refused for its size.
- The total cap counts recordings only. `data.json` has its own cap, and it is compressed, so counting it would push an honest large backup over its own file size.
- The total cap is the larger of `max_total_bytes` and the size of the backup file. The app stores recordings uncompressed, so its own backups always fit. A file that unpacks to more than itself is still stopped at 4 GiB. Add a private `Limits` method that returns the limits with that room, and apply it once, in the zip branch of `restore_with`, so `check_entries` and the budget in `stage_wavs` both use it.
- The doc comment on `Limits` says what is still refused: more than 19,999 recordings, or more than 64 MiB of results.

- [ ] **Step 1: Write the failing tests**

```rust
#[test]
fn a_backup_the_app_made_restores_even_when_it_is_bigger_than_the_total_cap() {
    let e = filled();
    // Enough results that data.json unpacks to far more than the zip adds around it.
    for i in 0..300 {
        db::insert_result(&e.conn, &new_result("glides", 60.0), T0 + 1_000 + i).unwrap();
    }
    let (_o, zip_path) = out_file("big.zip");
    create_to(&e.base, &e.conn, &zip_path).unwrap();
    let fresh = env();
    let tight = Limits { max_total_bytes: 100, ..Limits::default() };

    let summary = restore_with(&fresh.base, &fresh.conn, &zip_path, NOW, &tight).unwrap();

    assert_eq!((summary.results, summary.recordings), (303, 2));
}

#[test]
fn the_longest_take_the_recorder_can_write_fits_the_per_recording_cap() {
    assert!(Limits::default().max_wav_bytes >= crate::audio::recorder::MAX_DATA_BYTES + 44);
}

#[test]
fn recordings_that_unpack_to_more_than_the_cap_and_the_file_are_rejected() {
    let e = env();
    let (_o, zip_path) = out_file("packed.zip");
    let data = data_json(serde_json::json!([good_row()]));
    // 60 kB of zeros deflates to a few hundred bytes.
    zip_with(&zip_path, &[("data.json", &data), ("recordings/a.wav", &zero_wav(60_000))]);
    let limits = Limits { max_total_bytes: 100, ..Limits::default() };

    let before = snapshot(&e);
    let err = restore_with(&e.base, &e.conn, &zip_path, NOW, &limits).unwrap_err();

    assert_eq!(err.kind(), ErrorKind::InvalidBackup);
    assert_eq!(snapshot(&e), before);
}
```

Remove the `max_total_bytes: 100` case from `oversized_entries_and_too_many_entries_are_rejected`. Its archive unpacks to less than its own size, so under the new rule it is no longer a refusal. The third test above takes its place.

- [ ] **Step 2: Run them to see them fail**

Run, from `src-tauri`: `cargo test backup`
Expected: the first test fails with "the backup is too large" and the second fails its assertion. The third passes already.

- [ ] **Step 3: Implement the decisions above**

- [ ] **Step 4: Run the Rust checks**

Run, from `src-tauri`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`
Expected: all exit 0. `declared_sizes_that_lie_cannot_get_past_the_total_cap`, `declared_sizes_that_lie_cannot_get_past_the_per_file_cap`, `the_total_cap_is_shared_by_all_recordings` and `a_backup_made_by_version_0_1_0_still_restores` pass unedited.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/storage/backup.rs
git commit -m "backup: let the total cap grow to the size of the file, so a backup the app made always restores"
```

The commit body names the moved test case and why.

---

### Task 5: Audio: channel mix, recorder fallback, recorder errors (A1, A3, F1)

**Findings.** A1: `push_mono` and `push_pcm` in `src-tauri/src/audio/capture.rs` divide the sum of all channels by the channel count. A microphone on one input of a two-channel interface reads at half its level, and on an eight-channel one it falls under the volume gate. Recordings are quieter too. A3: the recorder opens the default microphone when the chosen one is missing and never says so (`open` in `recorder.rs`), while the pitch stream reports the same thing as `fellBack`. F1: `useMic` turns the pitch trace off for a `device_lost` or `stream_failed` error whichever stream sent it, so a recorder problem kills a pitch stream that is still fine (`src/mic/useMic.ts`, `handleAudioError`).

**Files:**

- Modify: `src-tauri/src/audio/capture.rs`, `src-tauri/src/audio/pitch_stream.rs`, `src-tauri/src/audio/recorder.rs`
- Modify: `src-tauri/src/audio/mod.rs`, `src-tauri/src/commands.rs`
- Modify: `src/domain/contract.ts`, `src/lib/tauri.ts`, `src/recordings/useRecordings.ts`, `src/test/fakeBackend.ts`
- Modify: `src/mic/useMic.ts`
- Modify: `docs/plans/2026-11-06-fix-and-redesign.md` (the `start_recording` row of the IPC table)
- Test: the test modules of the Rust files above, `src/mic/useMic.test.tsx`, `src/App.test.tsx`, and the recordings test that drives the Record button through `src/recordings/recordingsTestKit.ts`

**Interfaces:**

- Produces, in `capture.rs`:

```rust
/// How much of each channel goes into the mono signal. Made before the
/// stream starts; nothing in it allocates afterwards.
pub struct ChannelMix { /* one weight per channel */ }

impl ChannelMix {
    pub fn new(channels: usize) -> Self;
}

pub fn push_mono<T: InputSample, P: Producer<Item = f32>>(ring: &mut P, data: &[T], mix: &mut ChannelMix) -> usize;
pub fn push_pcm<T: InputSample, P: Producer<Item = i16>>(ring: &mut P, data: &[T], mix: &mut ChannelMix) -> usize;
```

`MonoSink` and `PcmSink` hold `mix: ChannelMix` in place of `channels: usize`.

- Produces, in `audio/mod.rs`, replacing the struct of the same name in `commands.rs`:

```rust
/// Answer to `start_recording`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStarted {
    pub name: String,
    pub fell_back: bool,
}
```

`AudioState::start_recording` returns `AppResult<RecordingStarted>`.

- Produces, in `contract.ts`: `interface RecordingStarted { readonly name: string; readonly fellBack: boolean }`, returned by `startRecording`.

**Decisions for A1:**

- For each callback buffer, a channel's weight is its share of the buffer's energy: the sum of its squared samples over the sum for all channels. The output frame is the weighted sum of its samples. One loud channel passes through at its own level. Equal channels come out as their average, which is what happens today. Weights add up to one, so the output cannot be louder than the loudest input.
- When a buffer has no energy at all, every channel gets an equal weight, so nothing divides by zero.
- The weights hold no memory between buffers. A voice that moves to another channel is picked up in the same buffer.
- One channel skips the weighing and takes the existing straight path, including the integer path of `push_pcm`.
- The callback must not allocate, lock or block. `ChannelMix::new` makes its storage once, before the stream is built.

- [ ] **Step 1: Write the failing mix tests**

In the tests of `capture.rs`, with `fn mix(channels: usize) -> ChannelMix { ChannelMix::new(channels) }` and a small helper that compares two slices within `1e-3`:

| Test                                                       | Input (one call, interleaved)                                                     | Expected output                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------- |
| `a_voice_on_one_channel_of_two_keeps_its_level`            | 2 ch `[0.5, 0.0, -0.25, 0.0, 0.1, 0.0]`                                           | `[0.5, -0.25, 0.1]`                 |
| `a_voice_on_one_channel_of_eight_keeps_its_level`          | 8 ch, channel 3 holds `0.4` then `-0.2`, the rest `0.0`                           | `[0.4, -0.2]`                       |
| `equal_channels_come_out_unchanged_whatever_the_format`    | 2 ch `f32 [0.3, 0.3]`, `i16 [16384, 16384, -32768, -32768]`, `u16 [32768, 32768]` | `[0.3, 0.5, -1.0, 0.0]`             |
| `a_faint_hiss_on_the_other_channel_barely_moves_the_level` | 2 ch `[0.5, 0.005, -0.5, -0.005]`                                                 | each within 1% of `0.5` and `-0.5`  |
| `silence_on_every_channel_stays_silence`                   | 2 ch, eight zeros                                                                 | four zeros, all finite              |
| `a_voice_that_moves_to_the_other_channel_is_heard_at_once` | same mix, call 1 `[0.5, 0.0, -0.5, 0.0]`, call 2 `[0.0, 0.4, 0.0, -0.4]`          | call 2 gives `[0.4, -0.4]`          |
| `pcm_keeps_the_level_of_a_voice_on_one_channel`            | 2 ch `i16 [1000, 0, -2000, 0, 400, 0]`                                            | `[1000, -2000, 400]`, each within 1 |

Three existing tests state the old rule and are rewritten to the new one: `stereo_is_averaged_to_mono_whatever_the_format` becomes `equal_channels_come_out_unchanged_whatever_the_format` above; `pcm_stereo_is_mixed_down_to_one_channel` takes the input `[1000, 1000, -2000, -2000, 400, 400]` and expects `[1000, -2000, 400]`; `pcm_mixdown_works_for_many_channels_and_other_formats` keeps its input `[0.5, 0.5, 0.0, 0.0]` on four channels and expects `16384` within 1, where it expected `8192`. That last number is the finding itself. The other `push_mono` and `push_pcm` tests change only in how they pass the channel count.

- [ ] **Step 2: Run them to see them fail**

Run, from `src-tauri`: `cargo test capture`
Expected: a compile error, because `ChannelMix` does not exist.

- [ ] **Step 3: Implement `ChannelMix` and use it in both sinks**

- [ ] **Step 4: Run the Rust checks and commit A1**

Run, from `src-tauri`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`
Expected: all exit 0.

```bash
git add src-tauri/src/audio
git commit -m "capture: weigh each channel by its energy, so a mic on one input of several keeps its level"
```

The commit body names the three rewritten tests and why.

- [ ] **Step 5: Write the failing fallback tests**

In `recorder.rs`, `Started` gains `fell_back: bool`. Add `a_session_says_when_it_fell_back_to_another_microphone`: build the session through `start_with` as `a_session_records_and_stop_describes_the_closed_file` does, with `Started { name, fell_back: true }`, and assert `session.fell_back()`. The three existing `Started { .. }` literals in the tests gain `fell_back: false`.

In `audio/mod.rs`, extend `an_audio_issue_serializes_as_the_webview_expects`, or add a test beside it:

```rust
let started = RecordingStarted { name: "rec_1.wav".into(), fell_back: true };
assert_eq!(
    serde_json::to_value(started).unwrap(),
    serde_json::json!({ "name": "rec_1.wav", "fellBack": true })
);
```

In the recordings test file that uses `recordingsTestKit.ts`:

```ts
it("says so when the chosen microphone was missing and the default one is recording", async () => {
  backend.respond("start_recording", { name: "rec_new.wav", fellBack: true });
  // open Recordings and press Record with the kit's helpers
  expect(stage().getByRole("status")).toHaveTextContent(
    t("settings.deviceFellBack"),
  );
});
```

Add its twin with `fellBack: false`, which expects the status to be empty.

Run: `cargo test recorder` from `src-tauri`, and `npx vitest run src/recordings`.
Expected: a compile error in Rust, and the new vitest test fails because nothing is shown.

- [ ] **Step 6: Implement the fallback report**

Rust: `open_stream` fills `fell_back` from `input.choice.fell_back`. `RecorderSession` keeps it and has `pub fn fell_back(&self) -> bool`. `AudioState::start_recording` returns `RecordingStarted`, and `commands::start_recording` passes it through.

TypeScript: `startRecording` returns `RecordingStarted`. In `useRecordings`, a new reducer action `{ type: "started"; fellBack: boolean }` sets `recorder: "recording"` and the notice `{ kind: "message", key: "settings.deviceFellBack" }` when `fellBack` is true, and no notice otherwise. `record()` dispatches it where it dispatched `{ type: "recorder", recorder: "recording" }`. The default answer for `start_recording` in `fakeBackend.ts` gains `fellBack: false`.

Docs: in the IPC table of `docs/plans/2026-11-06-fix-and-redesign.md`, the `start_recording` row returns `{ name: string; fellBack: boolean }`.

- [ ] **Step 7: Run the checks and commit A3**

Run, from `src-tauri`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`
Run: `python3 .grimoire/check.py fast src/recordings`
Expected: all exit 0.

```bash
git add src-tauri/src src/domain/contract.ts src/lib/tauri.ts src/recordings src/test/fakeBackend.ts docs/plans/2026-11-06-fix-and-redesign.md
git commit -m "recorder: say when it fell back to another microphone, as the pitch stream already does"
```

- [ ] **Step 8: Write the failing F1 test**

In `src/mic/useMic.test.tsx`:

```ts
it("keeps the trace when it is the recorder that lost the device", async () => {
  const { result } = await mount();
  await turnOn(result);
  act(() => {
    backend.emit("audio-error", {
      source: "recorder",
      kind: "device_lost",
      message: "gone",
    });
  });
  expect(result.current.status).toBe("on");
  expect(backend.callsTo("stop_pitch")).toHaveLength(0);
  const { issue } = result.current;
  expect(issue && micIssueMessage(issue, t)).toBe(t("error.device_lost"));
});
```

Run: `npx vitest run src/mic/useMic.test.tsx`
Expected: FAIL, the status is `"off"`.

- [ ] **Step 9: Implement F1**

In `useMic.ts`, an audio error ends the pitch stream only when `error.source === "pitch"` and its kind is one of the two that end a stream. The reducer and `handleAudioError` use the same rule. Three existing payloads that expect the mic to go off omit the source, which the backend always sends: `src/mic/useMic.test.tsx` (the `device_lost` and the `stream_failed` tests) and `src/App.test.tsx` (the `device_lost` emit). They gain `source: "pitch"`.

- [ ] **Step 10: Run the checks and commit F1**

Run: `python3 .grimoire/check.py fast src/mic src/App.test.tsx src/recordings src/practice`
Expected: exit 0.

```bash
git add src/mic src/App.test.tsx
git commit -m "mic: only a pitch stream error turns the trace off, so a recorder problem leaves it running"
```

The commit body names the three test payloads that gained a source and why.

---

### Task 6: Practice and first-run fixes (U1, U3, U11)

**Findings.** U1: on "Set your range", Skip throws away the range the app just suggested from the measurement (`src/onboarding/OnboardingFlow.tsx`, `skip`). Practice then shows "Set your range first" with "Start session" disabled and no way to get there (`src/practice/NoticeSlot.tsx`). U3: the "Stop" button beside "Finish and save" discards the running session and says nothing (`src/practice/SessionControls.tsx`). U11: at the default window size, 800 by 600, the status beside the trace is clipped: "El micrófono está apagado" needs four lines in a three-line slot, and "Escuchando…", "Grabando…", "Activando el micrófono…" and "Recording…" are wider than the slot (`.live-status` in `src/styles/practice.css`).

**Files:**

- Modify: `src/onboarding/OnboardingFlow.tsx`
- Modify: `src/practice/NoticeSlot.tsx`, `src/practice/SessionControls.tsx`, `src/practice/useSession.ts`
- Modify: `src/styles/practice.css`
- Modify: `src/i18n/en.ts`, `src/i18n/es.ts`
- Modify: `DESIGN.md` (one sentence under "Readout and zone mark")
- Test: `src/onboarding/Onboarding.test.tsx`, `src/practice/PracticeSession.test.tsx`

**Interfaces:**

- Produces: `SessionState`'s idle member becomes `{ readonly phase: "idle"; readonly discarded: boolean }`. `discarded` is true only after `reset()` ended a running session, and false again once a session starts or `reset()` is called with nothing running.

**Copy:**

| Key                     | English                               | Spanish                               |
| ----------------------- | ------------------------------------- | ------------------------------------- |
| `exercise.openSettings` | Open Settings                         | Abrir Ajustes                         |
| `exercise.discard`      | Discard                               | Descartar                             |
| `exercise.discarded`    | Session discarded. Nothing was saved. | Sesión descartada. No se guardó nada. |

`common.stop` is removed from both languages if nothing else uses it.

- [ ] **Step 1: Write the failing Skip test**

In `src/onboarding/Onboarding.test.tsx`, using the kit's `toCalibration`, `measure`, `click` and `savedProfile`:

```ts
it("keeps the suggested range when the range step is skipped", async () => {
  await toCalibration();
  await measure(130);
  await click(t("common.next"));
  const [min, max] = stage().getAllByRole("spinbutton");
  const suggested = {
    targetMinHz: Number(min.value),
    targetMaxHz: Number(max.value),
  };
  expect(suggested.targetMinHz).toBeGreaterThan(0);
  await click(t("common.skip"));
  await click(t("onboarding.saveContinue"));
  expect(savedProfile()).toMatchObject(suggested);
});
```

Use the role the range inputs really have. Run: `npx vitest run src/onboarding/Onboarding.test.tsx`
Expected: FAIL, the saved range is 0 and 0.

- [ ] **Step 2: Stop Skip from wiping the range**

`skip` only moves to the next step. The existing test "lets someone through when the mic fails" stays as it is: with nothing measured there is nothing to suggest, and the saved range is still 0 and 0.

- [ ] **Step 3: Write the failing tests for the way to Settings and for Discard**

In `src/practice/PracticeSession.test.tsx`:

```ts
it("offers the way to Settings when there is no range", async () => {
  backend.respond("get_profile", { ...PROFILE, targetMinHz: 0 });
  await openPractice("pitch_awareness");
  fireEvent.click(
    stage().getByRole("button", { name: t("exercise.openSettings") }),
  );
  expect(
    stage().getByRole("heading", { name: t("settings.title") }),
  ).toBeInTheDocument();
});
```

The existing test "stop throws the session away and saves nothing" becomes "discard throws the session away, says so and saves nothing". It presses `t("exercise.discard")`, keeps its two assertions and adds:

```ts
expect(stage().getByText(t("exercise.discarded"))).toBeInTheDocument();
startSession();
expect(stage().queryByText(t("exercise.discarded"))).toBeNull();
```

Run: `npx vitest run src/practice/PracticeSession.test.tsx`
Expected: FAIL, the new keys do not exist.

- [ ] **Step 4: Implement the action in the strip and the discard line**

`NoticeSlot`: beside the "Set your range first" line there is a secondary button, `exercise.openSettings`, that calls `openScreen("settings")`. The text takes the free width and the button keeps its own. After a discard, and with nothing of higher rank to say, the strip shows `exercise.discarded`. The order of the One Voice Rule in `DESIGN.md` does not change: both lines rank with the neutral notices, below an alert.

`useSession`: `reset()` reports whether a session was running, and the idle state carries it as `discarded`.

`SessionControls`: the second button is labelled `exercise.discard`.

- [ ] **Step 5: Fix the clipped status**

In `src/styles/practice.css`, `.live-status` keeps its height of three 1.75rem lines and its `overflow: hidden`, and changes two declarations:

```css
/* The longest one-word status ("Escuchando…") has to fit the narrowest gutter, so the size follows the gutter. */
font-size: min(
  var(--text-title),
  calc((var(--live-column-width) - 2 * var(--space-3)) * 0.115)
);
line-height: calc(1.75 / 1.375);
```

In the `@media (max-width: 40rem)` block, where the status has the full row, add `.live-status { font-size: var(--text-title); }`.

In `DESIGN.md`, under "Readout and zone mark", add: "In a narrow gutter the status text scales down, so its longest word still fits the three lines kept for it."

- [ ] **Step 6: Check it in a real browser**

jsdom has no layout, so this step is the evidence for U11 and for the fit of the new strip content. The dispatch gives the path of a scratch harness that serves this worktree with a fake backend, and of a script that sets every status message into the slot and reports any that is clipped. Run that script before and after the CSS change and put both outputs in the report. Expected after: `clipped=none` at 800x600, 840x600, 900x650, 975x700, 1040x700, 1100x760, 1280x800, 640x600 and 400x300.

Then look at, and save a screenshot of, each of these at 800x600 in English and in Spanish, and at 400x300 in Spanish: Practice with no range (the strip with its button), Practice just after a discard, and Practice with the mic off. Nothing may be clipped, the strip keeps its height, and the button has a visible focus ring.

- [ ] **Step 7: Run the checks and commit**

Run: `python3 .grimoire/check.py fast src/onboarding src/practice src/i18n`
Expected: exit 0.

Three commits, one per finding:

```bash
git commit -m "onboarding: Skip keeps the suggested range, and Practice offers the way to Settings when there is none"
git commit -m "practice: call the button Discard and say that nothing was saved, so a session is not lost without a word"
git commit -m "practice: size the status to the gutter, so it is not clipped at the default window size"
```

The second commit's body names the renamed test and why.

---

### Task 7: Version 0.1.1

**Files:**

- Modify: `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`
- Modify: `README.md` (the version line and the six download links)
- Modify: `.github/release-notes.md`
- Modify: `THIRD-PARTY-NOTICES.md` if generating it again changes it

**Interfaces:**

- Consumes: `tools/appVersion.test.ts` from Task 1.

- [ ] **Step 1: Bump one file and watch the version test fail**

Run: `npm version 0.1.1 --no-git-tag-version`, then `npx vitest run tools/appVersion.test.ts`
Expected: FAIL, naming `src-tauri/tauri.conf.json`.

- [ ] **Step 2: Bump the rest**

Set 0.1.1 in `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`. Run `cargo check` from `src-tauri` so `Cargo.lock` follows. In `README.md`, set the version line and every download link and file name to 0.1.1.

Run: `npx vitest run tools/appVersion.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the release notes**

`.github/release-notes.md` is the body of the draft release. Replace the "first release" paragraph with a short "What's new in 0.1.1" list in plain words: the app now opens and explains itself when its data cannot be read; large backups restore; a microphone on one input of an audio interface is heard at its real level; the status text no longer gets cut off at the default window size, most of all in Spanish; Skip keeps the suggested range; "Discard" says what it does; a recording that falls back to another microphone says so. Keep the safety, download, unsigned-build and problems sections. Add one matching line to the Spanish section.

- [ ] **Step 4: Run the notices and commit**

Run: `npm run notices`, then `git diff --stat`
Expected: no change to `THIRD-PARTY-NOTICES.md`, or only the app's own version.

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json README.md .github/release-notes.md THIRD-PARTY-NOTICES.md
git commit -m "release: version 0.1.1, with its notes and download links"
```

---

## Not in this plan

- The three larger calls from the review: retiring the Voice Trainer import code, a pitch test against a public corpus, and a browser preview mode. They wait for the owner's decision.
- `cpal` and `rodio` major versions. They change the audio path and need a real device to test.
- A recovery flow for a damaged database. This plan makes the failure visible and leaves the file alone.
