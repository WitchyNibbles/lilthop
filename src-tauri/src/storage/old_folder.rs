//! The first version's data folder: a one-time copy into the new folder, and
//! its removal when the person deletes all data. The old folder is only read
//! during the copy.

use std::ffi::OsString;
use std::fs::{self, File};
use std::path::Path;

use rusqlite::{Connection, OpenFlags};

use crate::error::{AppError, AppResult};
use crate::paths::{
    db_path, is_app_recording_name, old_db_path, recordings_dir, validate_recording_name,
    write_atomic,
};
use crate::storage::db::{is_apps_database, snapshot_database, verify_database};

/// Written when nothing is left to do. Once it exists the old folder is never
/// read again, so deleted data cannot come back.
pub const DONE_MARKER: &str = "legacy-migrated.marker";
/// Written once the database step is settled (copied, or not needed).
pub const DB_MARKER: &str = "legacy-db-copied.marker";
/// Written when the database copy failed, so the next start tries again.
pub const DB_FAILED_MARKER: &str = "legacy-db-failed.marker";

/// Where the database is built before it is renamed into place.
const IMPORT_PARTIAL: &str = ".legacy-db-import.partial";

/// Written by "Start fresh" when the earlier data could not be moved: neither
/// older folder is read again, so the app stops asking.
pub const SKIP_IMPORT_MARKER: &str = "skip-previous-import.marker";

/// Written by "Delete all data": she asked for the earlier data to go, so the
/// way back from "Start fresh" is never offered again, even for an older
/// folder that could not be checked and was left in place.
pub const EARLIER_DATA_DELETED_MARKER: &str = "earlier-data-deleted.marker";

/// What a migration attempt did. Failures are reported, not raised: the app
/// must start either way, and the next start tries again.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MigrationReport {
    pub db_copied: bool,
    pub recordings_copied: usize,
    pub recordings_failed: usize,
    pub db_error: Option<String>,
    /// True when nothing is left to retry.
    pub finished: bool,
}

/// Copy the first version's data into `base`, once.
///
/// - The old folder is only read.
/// - The database is copied only if `base` has none (or only an empty one left
///   by an earlier failed copy), never over data.
/// - A recording that cannot be read is skipped and counted; the done marker
///   is not written, so the next start tries it again.
/// - A database copy that fails does not stop the app; it is retried next start.
pub fn migrate(base: &Path, legacy: &Path) -> AppResult<MigrationReport> {
    if base.join(DONE_MARKER).exists() {
        return Ok(MigrationReport::default());
    }
    let legacy_db = old_db_path(legacy);
    if !legacy_db.is_file() {
        return Ok(MigrationReport::default());
    }
    // The file name alone proves nothing: another program may use it. A
    // database that is not ours is skipped without a trace, and so is its folder.
    let verdict = is_apps_database(&legacy_db, base);
    if matches!(verdict, Ok(false)) {
        return Ok(MigrationReport::default());
    }
    fs::create_dir_all(recordings_dir(base))?;
    let mut report = MigrationReport::default();
    if !base.join(DB_MARKER).exists() && db_present_with_data(base) {
        // The person already has data here: leave it, and leave the old
        // recordings where they are.
        write_marker(base, DONE_MARKER)?;
        return Ok(MigrationReport {
            finished: true,
            ..report
        });
    }
    // Not being able to tell yet (locked, unreadable) is a failure to retry,
    // not a verdict: nothing is copied from a folder we could not vouch for.
    let vouched_for = verdict.is_ok();
    copy_database(base, &legacy_db, verdict.err(), &mut report)?;
    if vouched_for {
        copy_recordings(&recordings_dir(legacy), &recordings_dir(base), &mut report);
    }
    let db_settled = base.join(DB_MARKER).exists();
    report.finished = vouched_for && db_settled && report.recordings_failed == 0;
    if report.finished {
        write_marker(base, DONE_MARKER)?;
    }
    Ok(report)
}

fn write_marker(base: &Path, name: &str) -> AppResult<()> {
    fs::write(
        base.join(name),
        "see the app's source: legacy folder copy\n",
    )?;
    Ok(())
}

/// True when `base` already has a database that is not a leftover of a failed
/// copy (a leftover is a fresh empty one).
fn db_present_with_data(base: &Path) -> bool {
    let path = db_path(base);
    path.exists() && !(base.join(DB_FAILED_MARKER).exists() && db_is_empty(&path))
}

/// Copy the database unless that step is already settled. A failure is
/// recorded in the report and in a marker; it is not an error.
fn copy_database(
    base: &Path,
    legacy_db: &Path,
    unverified: Option<AppError>,
    report: &mut MigrationReport,
) -> AppResult<()> {
    if base.join(DB_MARKER).exists() {
        return Ok(());
    }
    if let Some(e) = unverified {
        report.db_error = Some(e.message().to_owned());
        write_marker(base, DB_FAILED_MARKER)?;
        return Ok(());
    }
    let target = db_path(base);
    if target.exists() {
        // Only an empty leftover gets here (checked by the caller).
        fs::remove_file(&target)?;
    }
    match import_database(legacy_db, &target, base) {
        Ok(()) => {
            report.db_copied = true;
            write_marker(base, DB_MARKER)?;
            let _ = fs::remove_file(base.join(DB_FAILED_MARKER));
        }
        Err(e) => {
            report.db_error = Some(e.message().to_owned());
            write_marker(base, DB_FAILED_MARKER)?;
        }
    }
    Ok(())
}

/// Bring the old database over the way the previous folder's is: a snapshot
/// SQLite reads itself (so a crashed writer's journal is replayed on a scratch
/// copy, never in the old folder), checked against the original, then renamed
/// into place. Nothing is left at `target` unless the check passed.
fn import_database(legacy_db: &Path, target: &Path, base: &Path) -> AppResult<()> {
    let partial = target.with_file_name(IMPORT_PARTIAL);
    let _ = fs::remove_file(&partial);
    let result = snapshot_database(legacy_db, &partial, base)
        .and_then(|()| verify_database(legacy_db, &partial, base))
        .and_then(|()| Ok(fs::rename(&partial, target)?));
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result
}

fn copy_recordings(from: &Path, to: &Path, report: &mut MigrationReport) {
    let Ok(entries) = fs::read_dir(from) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let wanted = name
            .to_str()
            .is_some_and(|n| validate_recording_name(n).is_ok());
        let target = to.join(&name);
        if !wanted || !entry.path().is_file() || target.exists() {
            continue;
        }
        match copy_via_partial(&entry.path(), &target) {
            Ok(()) => report.recordings_copied += 1,
            Err(_) => report.recordings_failed += 1,
        }
    }
}

fn copy_via_partial(from: &Path, to: &Path) -> AppResult<()> {
    write_atomic(to, |out| {
        let mut input = File::open(from)?;
        std::io::copy(&mut input, out)?;
        Ok(())
    })
}

/// No rows in any table. Anything unreadable counts as having data, so it is
/// never deleted by mistake.
pub(super) fn db_is_empty(path: &Path) -> bool {
    let Ok(conn) = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return false;
    };
    ["exercise_result", "profile", "recording_meta"]
        .iter()
        .all(|table| {
            conn.query_row(&format!("SELECT EXISTS(SELECT 1 FROM {table})"), [], |r| {
                r.get::<_, i64>(0)
            })
            .is_ok_and(|any| any == 0)
        })
}

/// Files in an older folder's top level that only this app writes, next to the
/// database: SQLite's side files and the import markers.
const OWN_FILES: [&str; 6] = [
    "voice_trainer.db-journal",
    "voice_trainer.db-wal",
    "voice_trainer.db-shm",
    DONE_MARKER,
    DB_MARKER,
    DB_FAILED_MARKER,
];

/// What `remove` did with an older folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Removal {
    /// The app's files were removed.
    Removed,
    /// There is no such folder, or it is certainly not the app's.
    NothingToRemove,
    /// Its database could not be read (locked, damaged, a hot journal that
    /// could not be recovered), so it cannot be said to be ours. Left alone.
    CouldNotCheck,
}

/// Remove the app's data from an older folder (the first version's, or the
/// one for the previous identifier) after "delete all data".
///
/// The folder is only touched if its database is verifiably ours; the names
/// `voice_trainer.db` and `recordings/` can belong to another program. Even
/// then only known files go: the database and its side files, the import
/// markers, and `rec_<digits>.wav` recordings. `recordings/` and the folder
/// itself are removed only when nothing else is left in them. The done marker
/// is written first, so nothing can be copied back, and the database goes
/// last, so a failure half-way leaves a folder the next attempt still
/// recognises.
pub fn remove(base: &Path, legacy: &Path) -> AppResult<Removal> {
    let Ok(meta) = fs::symlink_metadata(legacy) else {
        return Ok(Removal::NothingToRemove);
    };
    if !meta.is_dir() {
        return Ok(Removal::NothingToRemove);
    }
    match is_apps_database(&old_db_path(legacy), base) {
        Ok(true) => {}
        Ok(false) => return Ok(Removal::NothingToRemove),
        // A folder with no database at all is not the app's either.
        Err(_) if !old_db_path(legacy).exists() => return Ok(Removal::NothingToRemove),
        Err(_) => return Ok(Removal::CouldNotCheck),
    }
    if fs::canonicalize(base)?.starts_with(fs::canonicalize(legacy)?) {
        return Err(AppError::invalid(
            "the old folder contains the current data folder; not removing it",
        ));
    }
    write_marker(base, DONE_MARKER)?;
    remove_recordings(&recordings_dir(legacy))?;
    for name in OWN_FILES {
        remove_if_file(&legacy.join(name))?;
    }
    remove_if_file(&old_db_path(legacy))?;
    // Both fail when something else is inside, which is what we want.
    let _ = fs::remove_dir(legacy);
    Ok(Removal::Removed)
}

fn remove_recordings(dir: &Path) -> AppResult<()> {
    // A link could point anywhere; what it leads to is not this app's folder.
    if !fs::symlink_metadata(dir).is_ok_and(|m| m.is_dir()) {
        return Ok(());
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let name: OsString = entry.file_name();
        if name.to_str().is_some_and(is_app_recording_name) {
            remove_if_file(&entry.path())?;
        }
    }
    let _ = fs::remove_dir(dir);
    Ok(())
}

/// Delete `path` if it is a regular file (never a link or a folder).
fn remove_if_file(path: &Path) -> AppResult<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() => Ok(fs::remove_file(path)?),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paths::{db_path, old_db_path, recordings_dir};
    use crate::storage::testutil::{first_version_db, foreign_db, leave_hot_journal, tree_bytes};
    use rusqlite::Connection;
    use std::fs;
    #[cfg(unix)]
    use std::os::unix::fs::symlink as link_dir;
    #[cfg(windows)]
    use std::os::windows::fs::symlink_dir as link_dir;
    use tempfile::tempdir;

    fn make_legacy(dir: &Path) {
        fs::create_dir_all(dir.join("recordings")).unwrap();
        first_version_db(&old_db_path(dir));
        fs::write(dir.join("recordings/rec_100.wav"), b"RIFFold").unwrap();
        fs::write(dir.join("recordings/rec_200.wav"), b"RIFFtwo").unwrap();
        fs::write(dir.join("recordings/notes.txt"), b"not a recording").unwrap();
    }

    fn marker(base: &Path, name: &str) -> bool {
        base.join(name).exists()
    }

    #[test]
    fn copies_database_and_wavs_and_leaves_old_folder_alone() {
        let legacy = tempdir().unwrap();
        let base = tempdir().unwrap();
        make_legacy(legacy.path());
        let old_db = fs::read(old_db_path(legacy.path())).unwrap();

        let report = migrate(base.path(), legacy.path()).unwrap();

        assert!(report.db_copied && report.finished);
        assert_eq!((report.recordings_copied, report.recordings_failed), (2, 0));
        assert_eq!(
            first_scores(base.path()),
            [61.5],
            "the copy has the old rows"
        );
        let copied = recordings_dir(base.path());
        assert_eq!(fs::read(copied.join("rec_100.wav")).unwrap(), b"RIFFold");
        assert!(!copied.join("notes.txt").exists());
        assert!(marker(base.path(), DONE_MARKER));
        assert_eq!(fs::read(old_db_path(legacy.path())).unwrap(), old_db);
        assert!(legacy.path().join("recordings/rec_100.wav").exists());
        assert!(legacy.path().join("recordings/notes.txt").exists());
    }

    /// The scores in the copied database, in id order.
    fn first_scores(base: &Path) -> Vec<f64> {
        let conn = Connection::open(db_path(base)).unwrap();
        let mut stmt = conn
            .prepare("SELECT score FROM exercise_result ORDER BY id")
            .unwrap();
        stmt.query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    fn result_count(base: &Path) -> i64 {
        Connection::open(db_path(base))
            .unwrap()
            .query_row("SELECT COUNT(*) FROM exercise_result", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn a_database_a_crashed_writer_left_a_hot_journal_on_is_copied_as_it_was_before_the_crash() {
        let legacy = tempdir().unwrap();
        let base = tempdir().unwrap();
        make_legacy(legacy.path());
        leave_hot_journal(&old_db_path(legacy.path()));
        let before = tree_bytes(legacy.path());

        let report = migrate(base.path(), legacy.path()).unwrap();

        assert!(report.db_copied && report.finished, "{report:?}");
        assert_eq!(
            result_count(base.path()),
            1,
            "the committed row, not the rest"
        );
        assert_eq!(
            tree_bytes(legacy.path()),
            before,
            "the old folder is not written"
        );
        assert!(marker(base.path(), DONE_MARKER) && !marker(base.path(), DB_FAILED_MARKER));
    }

    #[test]
    fn the_copied_database_has_the_same_rows_and_passes_the_integrity_check() {
        let legacy = tempdir().unwrap();
        let base = tempdir().unwrap();
        make_legacy(legacy.path());

        migrate(base.path(), legacy.path()).unwrap();

        let copy = Connection::open(db_path(base.path())).unwrap();
        let verdict: String = copy
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))
            .unwrap();
        assert_eq!(verdict, "ok");
        assert_eq!(result_count(base.path()), 1);
        let leftovers: Vec<_> = fs::read_dir(base.path())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".partial"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn runs_once_even_after_the_new_database_is_deleted() {
        let legacy = tempdir().unwrap();
        let base = tempdir().unwrap();
        make_legacy(legacy.path());
        migrate(base.path(), legacy.path()).unwrap();
        fs::remove_file(db_path(base.path())).unwrap();

        let again = migrate(base.path(), legacy.path()).unwrap();

        assert_eq!(again, MigrationReport::default());
        assert!(!db_path(base.path()).exists());
    }

    #[test]
    fn never_replaces_an_existing_database() {
        let legacy = tempdir().unwrap();
        let base = tempdir().unwrap();
        make_legacy(legacy.path());
        fs::write(db_path(base.path()), b"new data").unwrap();

        let report = migrate(base.path(), legacy.path()).unwrap();

        assert!(!report.db_copied && report.finished);
        assert_eq!(fs::read(db_path(base.path())).unwrap(), b"new data");
        assert!(!recordings_dir(base.path()).join("rec_100.wav").exists());
        assert!(marker(base.path(), DONE_MARKER));
    }

    #[test]
    fn without_an_old_folder_nothing_happens() {
        let base = tempdir().unwrap();
        let missing = base.path().join("nope");
        let report = migrate(base.path(), &missing).unwrap();
        assert_eq!(report, MigrationReport::default());
        assert!(!marker(base.path(), DONE_MARKER));
    }

    /// Make a file unreadable. False when this process ignores permissions.
    #[cfg(unix)]
    fn lock(path: &Path) -> bool {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o000)).unwrap();
        fs::File::open(path).is_err()
    }

    #[cfg(unix)]
    fn unlock(path: &Path) {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o644)).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn one_unreadable_recording_is_skipped_and_tried_again_next_start() {
        let legacy = tempdir().unwrap();
        let base = tempdir().unwrap();
        make_legacy(legacy.path());
        let locked = legacy.path().join("recordings/rec_100.wav");
        if !lock(&locked) {
            return;
        }

        let first = migrate(base.path(), legacy.path()).unwrap();

        assert!(first.db_copied && !first.finished);
        assert_eq!((first.recordings_copied, first.recordings_failed), (1, 1));
        assert!(recordings_dir(base.path()).join("rec_200.wav").exists());
        assert!(
            !marker(base.path(), DONE_MARKER),
            "the file must not be lost for good"
        );

        // The person has meanwhile changed their data; the retry must not touch it.
        fs::write(db_path(base.path()), b"newer data").unwrap();
        unlock(&locked);
        let second = migrate(base.path(), legacy.path()).unwrap();

        assert!(second.finished && !second.db_copied);
        assert_eq!((second.recordings_copied, second.recordings_failed), (1, 0));
        assert_eq!(
            fs::read(recordings_dir(base.path()).join("rec_100.wav")).unwrap(),
            b"RIFFold"
        );
        assert_eq!(fs::read(db_path(base.path())).unwrap(), b"newer data");
        assert!(marker(base.path(), DONE_MARKER));
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_database_copy_does_not_raise_and_is_retried_while_the_new_one_is_empty() {
        let legacy = tempdir().unwrap();
        let base = tempdir().unwrap();
        make_legacy(legacy.path());
        let locked = old_db_path(legacy.path());
        if !lock(&locked) {
            return;
        }

        let first = migrate(base.path(), legacy.path()).unwrap();

        assert!(!first.db_copied && !first.finished);
        assert!(first.db_error.is_some());
        assert!(!db_path(base.path()).exists());
        assert!(marker(base.path(), DB_FAILED_MARKER));
        assert!(!marker(base.path(), DONE_MARKER));

        // The app started with a fresh, empty database in the meantime.
        let fresh = Connection::open(db_path(base.path())).unwrap();
        for table in ["exercise_result", "profile", "recording_meta"] {
            fresh
                .execute_batch(&format!("CREATE TABLE {table} (id INTEGER PRIMARY KEY);"))
                .unwrap();
        }
        drop(fresh);
        unlock(&locked);
        let second = migrate(base.path(), legacy.path()).unwrap();

        assert!(second.db_copied && second.finished);
        assert_eq!(
            first_scores(base.path()),
            [61.5],
            "the copy has the old rows"
        );
        assert!(marker(base.path(), DONE_MARKER));
    }

    #[cfg(unix)]
    #[test]
    fn a_retry_never_replaces_a_database_that_has_data() {
        let legacy = tempdir().unwrap();
        let base = tempdir().unwrap();
        make_legacy(legacy.path());
        let locked = old_db_path(legacy.path());
        if !lock(&locked) {
            return;
        }
        migrate(base.path(), legacy.path()).unwrap();
        let fresh = Connection::open(db_path(base.path())).unwrap();
        fresh
            .execute_batch(
                "CREATE TABLE exercise_result (id INTEGER PRIMARY KEY);
                 CREATE TABLE profile (id INTEGER PRIMARY KEY);
                 CREATE TABLE recording_meta (id INTEGER PRIMARY KEY);
                 INSERT INTO exercise_result VALUES (1);",
            )
            .unwrap();
        drop(fresh);
        unlock(&locked);

        let second = migrate(base.path(), legacy.path()).unwrap();

        assert!(!second.db_copied && second.finished);
        let conn = Connection::open(db_path(base.path())).unwrap();
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM exercise_result", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1);
    }

    #[test]
    fn remove_deletes_the_old_folder_and_only_it() {
        let parent = tempdir().unwrap();
        let legacy = parent.path().join("voice-trainer");
        let base = parent.path().join("com.voice.trainer");
        let neighbour = parent.path().join("other-app");
        make_legacy(&legacy);
        fs::remove_file(legacy.join("recordings/notes.txt")).unwrap();
        fs::create_dir_all(&base).unwrap();
        fs::create_dir_all(&neighbour).unwrap();
        fs::write(neighbour.join("keep.txt"), b"x").unwrap();

        assert_eq!(remove(&base, &legacy).unwrap(), Removal::Removed);

        assert!(!legacy.exists());
        assert!(base.exists() && neighbour.join("keep.txt").exists());
        assert!(marker(&base, DONE_MARKER), "it can never be copied back");
        assert_eq!(
            remove(&base, &legacy).unwrap(),
            Removal::NothingToRemove,
            "second time nothing is there"
        );
    }

    /// Every file under a folder with its bytes, so "untouched" means untouched.
    fn contents(dir: &Path) -> Vec<(std::path::PathBuf, Vec<u8>)> {
        let mut files = Vec::new();
        let mut pending = vec![dir.to_path_buf()];
        while let Some(folder) = pending.pop() {
            for entry in fs::read_dir(folder).unwrap().flatten() {
                if entry.path().is_dir() {
                    pending.push(entry.path());
                } else {
                    files.push((entry.path(), fs::read(entry.path()).unwrap()));
                }
            }
        }
        files.sort();
        files
    }

    /// Two folders that merely share our file names: another program's database,
    /// and a text file called `voice_trainer.db`.
    fn lookalikes(parent: &Path) -> Vec<std::path::PathBuf> {
        let foreign = parent.join("foreign");
        let text = parent.join("text");
        for dir in [&foreign, &text] {
            fs::create_dir_all(dir.join("recordings")).unwrap();
            fs::write(dir.join("recordings/rec_100.wav"), b"RIFFtheirs").unwrap();
            fs::write(dir.join(DONE_MARKER), b"theirs").unwrap();
        }
        foreign_db(&old_db_path(&foreign));
        fs::write(old_db_path(&text), b"old database bytes").unwrap();
        vec![foreign, text]
    }

    #[test]
    fn a_database_that_is_not_ours_is_not_imported_and_the_folder_is_left_alone() {
        let parent = tempdir().unwrap();
        for legacy in lookalikes(parent.path()) {
            let base = tempdir().unwrap();
            let before = contents(&legacy);

            let report = migrate(base.path(), &legacy).unwrap();

            assert_eq!(report, MigrationReport::default(), "{legacy:?}");
            assert!(!db_path(base.path()).exists());
            assert!(!recordings_dir(base.path()).join("rec_100.wav").exists());
            assert!(!marker(base.path(), DONE_MARKER) && !marker(base.path(), DB_FAILED_MARKER));
            assert_eq!(contents(&legacy), before);
        }
    }

    #[test]
    fn delete_all_leaves_a_folder_that_only_shares_our_file_names() {
        let parent = tempdir().unwrap();
        let base = parent.path().join("new");
        fs::create_dir_all(&base).unwrap();
        for legacy in lookalikes(parent.path()) {
            let before = contents(&legacy);

            assert_eq!(
                remove(&base, &legacy).unwrap(),
                Removal::NothingToRemove,
                "{legacy:?}"
            );

            assert_eq!(contents(&legacy), before);
            assert!(!marker(&base, DONE_MARKER));
        }
    }

    #[test]
    fn delete_all_removes_only_the_apps_files_and_keeps_what_else_is_there() {
        let parent = tempdir().unwrap();
        let legacy = parent.path().join("voice-trainer");
        let base = parent.path().join("new");
        make_legacy(&legacy);
        fs::create_dir_all(&base).unwrap();
        // Empty side files: a journal with content would be a crashed write
        // that SQLite must recover before anything can be read.
        for name in OWN_FILES {
            fs::write(legacy.join(name), b"").unwrap();
        }
        fs::write(legacy.join("thesis.docx"), b"mine").unwrap();
        fs::write(legacy.join("recordings/rec_1.wav.bak"), b"theirs").unwrap();
        fs::create_dir_all(legacy.join("recordings/rec_9.wav")).unwrap();

        assert_eq!(remove(&base, &legacy).unwrap(), Removal::Removed);

        // Compared as paths, not strings, so the separator is the OS's own.
        let mut left: Vec<std::path::PathBuf> = contents(&legacy)
            .into_iter()
            .map(|(p, _)| p.strip_prefix(&legacy).unwrap().to_path_buf())
            .collect();
        left.sort();
        let kept: Vec<std::path::PathBuf> = [
            &["recordings", "notes.txt"][..],
            &["recordings", "rec_1.wav.bak"],
            &["thesis.docx"],
        ]
        .iter()
        .map(|parts| parts.iter().collect())
        .collect();
        assert_eq!(left, kept);
        assert!(legacy.join("recordings/rec_9.wav").is_dir());
        assert!(marker(&base, DONE_MARKER), "it can never be copied back");
    }

    #[test]
    fn delete_all_removes_the_recordings_folder_once_it_is_empty() {
        let parent = tempdir().unwrap();
        let legacy = parent.path().join("voice-trainer");
        let base = parent.path().join("new");
        make_legacy(&legacy);
        fs::remove_file(legacy.join("recordings/notes.txt")).unwrap();
        fs::write(legacy.join("thesis.docx"), b"mine").unwrap();
        fs::create_dir_all(&base).unwrap();

        assert_eq!(remove(&base, &legacy).unwrap(), Removal::Removed);

        assert!(!legacy.join("recordings").exists());
        assert!(legacy.join("thesis.docx").exists(), "so is the folder");
    }

    #[test]
    fn remove_leaves_a_folder_that_does_not_look_like_the_apps() {
        let parent = tempdir().unwrap();
        let legacy = parent.path().join("voice-trainer");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("thesis.docx"), b"mine").unwrap();
        let base = parent.path().join("new");
        fs::create_dir_all(&base).unwrap();

        assert_eq!(remove(&base, &legacy).unwrap(), Removal::NothingToRemove);
        assert!(legacy.join("thesis.docx").exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_database_that_cannot_be_checked_is_left_alone_and_said_so() {
        use std::os::unix::fs::PermissionsExt;
        let parent = tempdir().unwrap();
        let legacy = parent.path().join("voice-trainer");
        let base = parent.path().join("new");
        make_legacy(&legacy);
        fs::create_dir_all(&base).unwrap();
        let db = old_db_path(&legacy);
        fs::set_permissions(&db, fs::Permissions::from_mode(0o000)).unwrap();
        if fs::File::open(&db).is_ok() {
            return; // this process ignores permissions
        }

        let outcome = remove(&base, &legacy).unwrap();

        fs::set_permissions(&db, fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(outcome, Removal::CouldNotCheck);
        assert!(db.exists() && legacy.join("recordings/rec_100.wav").exists());
        assert!(
            !marker(&base, DONE_MARKER),
            "it can still be imported later"
        );
    }

    #[test]
    fn a_recordings_folder_that_is_a_link_is_not_followed() {
        let parent = tempdir().unwrap();
        let legacy = parent.path().join("voice-trainer");
        let base = parent.path().join("new");
        let elsewhere = parent.path().join("elsewhere");
        make_legacy(&legacy);
        fs::create_dir_all(&base).unwrap();
        fs::create_dir_all(&elsewhere).unwrap();
        fs::write(
            elsewhere.join("rec_1.wav"),
            b"not part of this app's folder",
        )
        .unwrap();
        fs::remove_dir_all(legacy.join("recordings")).unwrap();
        if link_dir(&elsewhere, legacy.join("recordings")).is_err() {
            return; // links need a privilege on this machine
        }

        let outcome = remove(&base, &legacy).unwrap();

        assert_eq!(outcome, Removal::Removed, "the database is ours");
        assert!(
            elsewhere.join("rec_1.wav").exists(),
            "what the link points to is not ours to delete"
        );
        assert!(!old_db_path(&legacy).exists());
    }

    #[test]
    fn remove_refuses_a_folder_that_contains_the_new_data() {
        let parent = tempdir().unwrap();
        let legacy = parent.path().join("voice-trainer");
        make_legacy(&legacy);
        let base = legacy.join("inside");
        fs::create_dir_all(&base).unwrap();

        assert!(remove(&base, &legacy).is_err());
        assert!(base.exists() && old_db_path(&legacy).exists());
    }
}
