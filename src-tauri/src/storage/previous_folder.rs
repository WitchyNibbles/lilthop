//! The data folder of the previous bundle identifier (`com.voice.trainer`),
//! copied into the current one the first time the renamed app starts.
//!
//! Copy, never move: the old folder is only read. The copy is built in a
//! staging folder inside the new one, checked there, and only then published,
//! with the database renamed into place last. The database is what makes the
//! new folder "in use", so a crash at any earlier point leaves the new folder
//! looking untouched and the next start tries again from scratch.

use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::path::Path;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::paths::{db_path, old_db_path, recordings_dir, validate_recording_name};
use crate::storage::db::{is_apps_database, snapshot_database, verify_database};
use crate::storage::old_folder::{DB_FAILED_MARKER, DB_MARKER, DONE_MARKER};

/// Where the copy is built, inside the new folder.
pub const STAGING: &str = ".moving-from-previous";

/// Called with each file right after it was copied into staging. Production
/// does nothing; tests use it to fail or damage the copy half-way.
pub type AfterCopy<'a> = &'a mut dyn FnMut(&Path) -> AppResult<()>;

/// Copy the previous folder's data into `base` if `base` has no database yet
/// and the previous folder has one. `Ok(true)` when it copied, `Ok(false)`
/// when there was nothing to do. Any failure is a `MigrationFailed` error and
/// leaves `base` as it was.
pub fn move_into(base: &Path, previous: &Path) -> AppResult<bool> {
    move_into_with(base, previous, &mut |_| Ok(()))
}

pub fn move_into_with(base: &Path, previous: &Path, after_copy: AfterCopy) -> AppResult<bool> {
    let staging = base.join(STAGING);
    if db_path(base).exists() {
        // In use already. Whatever staging holds is left over from a move
        // that did finish.
        let _ = fs::remove_dir_all(&staging);
        return Ok(false);
    }
    let source = old_db_path(previous);
    if !source.is_file() {
        return Ok(false);
    }
    // The file name alone proves nothing: another program may use it. A
    // database that is not ours is skipped, and its folder is left alone.
    match is_apps_database(&source, base) {
        Ok(true) => {}
        Ok(false) => return Ok(false),
        Err(e) => return Err(copy_failed(previous, e.message())),
    }
    let outcome = stage_and_publish(base, previous, &staging, after_copy);
    let _ = fs::remove_dir_all(&staging);
    outcome
        .map(|()| true)
        .map_err(|e| copy_failed(previous, e.message()))
}

/// The error for a folder whose data could not be copied. Also used for the
/// first version's folder.
pub(super) fn copy_failed(folder: &Path, cause: &str) -> AppError {
    AppError::new(
        ErrorKind::MigrationFailed,
        format!("could not copy the data in {}: {cause}", folder.display()),
    )
}

fn stage_and_publish(
    base: &Path,
    previous: &Path,
    staging: &Path,
    after_copy: AfterCopy,
) -> AppResult<()> {
    if staging.exists() {
        fs::remove_dir_all(staging)?;
    }
    fs::create_dir_all(recordings_dir(staging))?;

    let source_db = old_db_path(previous);
    let staged_db = db_path(staging);
    snapshot_database(&source_db, &staged_db, base)?;
    after_copy(&staged_db)?;
    let markers = copy_markers(previous, staging, after_copy)?;
    let recordings = copy_recordings(previous, staging, after_copy)?;

    verify_database(&source_db, &staged_db, base)?;
    verify_recordings(&recordings_dir(previous), &recordings_dir(staging))?;

    publish(base, staging, &recordings, &markers)
}

fn copy_file(from: &Path, to: &Path, after_copy: AfterCopy) -> AppResult<()> {
    fs::copy(from, to)?;
    OpenOptions::new().write(true).open(to)?.sync_all()?;
    after_copy(to)
}

/// Which first-version import steps were settled travels with the data, so
/// the import neither runs again nor loses its place.
fn copy_markers(
    previous: &Path,
    staging: &Path,
    after_copy: AfterCopy,
) -> AppResult<Vec<&'static str>> {
    let mut copied = Vec::new();
    for marker in [DONE_MARKER, DB_MARKER, DB_FAILED_MARKER] {
        if previous.join(marker).is_file() {
            copy_file(&previous.join(marker), &staging.join(marker), after_copy)?;
            copied.push(marker);
        }
    }
    Ok(copied)
}

fn copy_recordings(
    previous: &Path,
    staging: &Path,
    after_copy: AfterCopy,
) -> AppResult<Vec<String>> {
    let from = recordings_dir(previous);
    let to = recordings_dir(staging);
    let names: Vec<String> = recording_sizes(&from)?.into_keys().collect();
    for name in &names {
        copy_file(&from.join(name), &to.join(name), after_copy)?;
    }
    Ok(names)
}

/// Name and size of every recording in a folder (a missing folder has none).
/// Only valid recording names count, like everywhere else in the app.
fn recording_sizes(dir: &Path) -> AppResult<BTreeMap<String, u64>> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(BTreeMap::new()),
        Err(e) => return Err(e.into()),
    };
    let mut sizes = BTreeMap::new();
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let meta = entry.metadata()?;
        if meta.is_file() && validate_recording_name(&name).is_ok() {
            sizes.insert(name, meta.len());
        }
    }
    Ok(sizes)
}

fn mismatch(what: impl Into<String>) -> AppError {
    AppError::new(ErrorKind::MigrationFailed, what)
}

/// Same recordings by name, count and byte size. The original is read again
/// here, so one that appeared or changed during the copy is caught too.
fn verify_recordings(original: &Path, copy: &Path) -> AppResult<()> {
    let (want, got) = (recording_sizes(original)?, recording_sizes(copy)?);
    if want != got {
        return Err(mismatch(format!(
            "{} recordings in the original, {} in the copy, or their sizes differ",
            want.len(),
            got.len()
        )));
    }
    Ok(())
}

/// Move the verified copy into place. Same disk, so each rename is atomic. The
/// database goes last: until it is there, the new folder counts as unused.
fn publish(base: &Path, staging: &Path, recordings: &[String], markers: &[&str]) -> AppResult<()> {
    let target = recordings_dir(base);
    fs::create_dir_all(&target)?;
    for name in recordings {
        fs::rename(recordings_dir(staging).join(name), target.join(name))?;
    }
    for marker in markers {
        fs::rename(staging.join(marker), base.join(marker))?;
    }
    fs::rename(db_path(staging), db_path(base))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::db;
    use crate::storage::model::fixtures::{new_result, profile};
    use crate::storage::testutil::{foreign_db, leave_hot_journal, tree_bytes, write_wav};
    use rusqlite::Connection;
    use tempfile::tempdir;

    /// The folder the previous build left: its database under the old name,
    /// two results, a profile, a note, and recordings.
    fn make_previous(dir: &Path) {
        fs::create_dir_all(recordings_dir(dir)).unwrap();
        write_wav(&recordings_dir(dir).join("rec_100.wav"), 300);
        write_wav(&recordings_dir(dir).join("rec_200.wav"), 700);
        write_wav(&recordings_dir(dir).join("rec_300.wav"), 50);
        fs::write(recordings_dir(dir).join("notes.txt"), b"not a recording").unwrap();
        let conn = db::open(&old_db_path(dir)).unwrap();
        db::set_profile(&conn, &profile()).unwrap();
        db::insert_result(&conn, &new_result("glides", 61.5), 1_730_000_000).unwrap();
        db::insert_result(&conn, &new_result("glides", 70.0), 1_730_000_100).unwrap();
        conn.execute(
            "INSERT INTO recording_meta (name, note, tags) VALUES ('rec_100.wav', 'mine', 'x')",
            [],
        )
        .unwrap();
    }

    fn sizes(dir: &Path) -> BTreeMap<String, u64> {
        fs::read_dir(dir)
            .map(|entries| {
                entries
                    .flatten()
                    .filter(|e| e.path().is_file())
                    .map(|e| {
                        (
                            e.file_name().to_string_lossy().into_owned(),
                            e.metadata().unwrap().len(),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    fn wavs(dir: &Path) -> BTreeMap<String, u64> {
        sizes(&recordings_dir(dir))
            .into_iter()
            .filter(|(name, _)| name.ends_with(".wav"))
            .collect()
    }

    fn result_count(base: &Path) -> i64 {
        Connection::open(db_path(base))
            .unwrap()
            .query_row("SELECT COUNT(*) FROM exercise_result", [], |r| r.get(0))
            .unwrap()
    }

    fn assert_nothing_published(base: &Path) {
        assert!(!db_path(base).exists(), "no database may appear");
        assert!(wavs(base).is_empty(), "no recording may appear");
        assert!(!base.join(STAGING).exists(), "staging is cleaned up");
    }

    #[test]
    fn copies_the_database_and_every_recording_and_leaves_the_old_folder_whole() {
        let parent = tempdir().unwrap();
        let (previous, base) = (parent.path().join("old"), parent.path().join("new"));
        make_previous(&previous);
        let old_db = fs::read(old_db_path(&previous)).unwrap();
        let old_wavs = wavs(&previous);

        assert!(move_into(&base, &previous).unwrap());

        assert_eq!(result_count(&base), 2);
        assert_eq!(
            wavs(&base),
            old_wavs,
            "same recordings, same size: a lost file fails here"
        );
        for name in old_wavs.keys() {
            assert_eq!(
                fs::read(recordings_dir(&base).join(name)).unwrap(),
                fs::read(recordings_dir(&previous).join(name)).unwrap(),
                "{name}"
            );
        }
        assert!(!base.join(STAGING).exists());
        assert_eq!(
            fs::read(old_db_path(&previous)).unwrap(),
            old_db,
            "old database untouched"
        );
        assert_eq!(wavs(&previous), old_wavs, "old recordings untouched");
        assert!(recordings_dir(&previous).join("notes.txt").exists());
    }

    #[test]
    fn only_recordings_are_copied_not_other_files() {
        let parent = tempdir().unwrap();
        let (previous, base) = (parent.path().join("old"), parent.path().join("new"));
        make_previous(&previous);

        move_into(&base, &previous).unwrap();

        assert!(!recordings_dir(&base).join("notes.txt").exists());
    }

    #[test]
    fn the_first_version_import_state_travels_with_the_database() {
        let parent = tempdir().unwrap();
        let (previous, base) = (parent.path().join("old"), parent.path().join("new"));
        make_previous(&previous);
        for marker in [DONE_MARKER, DB_MARKER] {
            fs::write(previous.join(marker), b"m").unwrap();
        }

        move_into(&base, &previous).unwrap();

        assert!(base.join(DONE_MARKER).exists() && base.join(DB_MARKER).exists());
        assert!(!base.join(DB_FAILED_MARKER).exists());
    }

    #[test]
    fn nothing_to_do_without_a_previous_database() {
        let parent = tempdir().unwrap();
        let base = parent.path().join("new");
        fs::create_dir_all(&base).unwrap();

        let missing = parent.path().join("nope");
        assert!(!move_into(&base, &missing).unwrap());

        let no_db = parent.path().join("no-db");
        fs::create_dir_all(recordings_dir(&no_db)).unwrap();
        write_wav(&recordings_dir(&no_db).join("rec_1.wav"), 10);
        assert!(!move_into(&base, &no_db).unwrap());
        assert_nothing_published(&base);
    }

    #[test]
    fn an_existing_database_is_never_touched_or_copied_over() {
        let parent = tempdir().unwrap();
        let (previous, base) = (parent.path().join("old"), parent.path().join("new"));
        make_previous(&previous);
        fs::create_dir_all(&base).unwrap();
        fs::write(db_path(&base), b"the person's newer data").unwrap();

        assert!(!move_into(&base, &previous).unwrap());

        assert_eq!(
            fs::read(db_path(&base)).unwrap(),
            b"the person's newer data"
        );
        assert!(wavs(&base).is_empty(), "no recordings are brought along");
    }

    #[test]
    fn a_copy_that_fails_half_way_publishes_nothing_and_the_retry_copies_everything() {
        let parent = tempdir().unwrap();
        let (previous, base) = (parent.path().join("old"), parent.path().join("new"));
        make_previous(&previous);
        let old_wavs = wavs(&previous);
        let mut copied = 0;

        let err = move_into_with(&base, &previous, &mut |_| {
            copied += 1;
            if copied == 3 {
                Err(AppError::new(ErrorKind::Io, "disk went away"))
            } else {
                Ok(())
            }
        })
        .unwrap_err();

        assert_eq!(err.kind(), ErrorKind::MigrationFailed);
        assert!(
            err.message().contains("disk went away"),
            "{}",
            err.message()
        );
        assert_nothing_published(&base);
        assert_eq!(wavs(&previous), old_wavs, "old data whole");

        assert!(move_into(&base, &previous).unwrap(), "the retry works");
        assert_eq!(result_count(&base), 2);
        assert_eq!(wavs(&base), old_wavs);
    }

    #[test]
    fn a_recording_with_the_wrong_size_is_caught() {
        let parent = tempdir().unwrap();
        let (previous, base) = (parent.path().join("old"), parent.path().join("new"));
        make_previous(&previous);

        let err = move_into_with(&base, &previous, &mut |copy| {
            if copy.file_name().is_some_and(|n| n == "rec_200.wav") {
                fs::OpenOptions::new().write(true).open(copy)?.set_len(10)?;
            }
            Ok(())
        })
        .unwrap_err();

        assert_eq!(err.kind(), ErrorKind::MigrationFailed);
        assert_nothing_published(&base);
    }

    #[test]
    fn a_missing_recording_is_caught() {
        let parent = tempdir().unwrap();
        let (previous, base) = (parent.path().join("old"), parent.path().join("new"));
        make_previous(&previous);

        let err = move_into_with(&base, &previous, &mut |copy| {
            if copy.file_name().is_some_and(|n| n == "rec_300.wav") {
                fs::remove_file(copy)?;
            }
            Ok(())
        })
        .unwrap_err();

        assert_eq!(err.kind(), ErrorKind::MigrationFailed);
        assert_nothing_published(&base);
    }

    #[test]
    fn a_recording_that_appeared_in_the_old_folder_during_the_copy_is_caught() {
        let parent = tempdir().unwrap();
        let (previous, base) = (parent.path().join("old"), parent.path().join("new"));
        make_previous(&previous);

        let err = move_into_with(&base, &previous, &mut |copy| {
            if copy.file_name().is_some_and(|n| n == "rec_300.wav") {
                write_wav(&recordings_dir(&previous).join("rec_999.wav"), 5);
            }
            Ok(())
        })
        .unwrap_err();

        assert_eq!(err.kind(), ErrorKind::MigrationFailed);
        assert_nothing_published(&base);
    }

    #[test]
    fn a_database_that_does_not_pass_the_integrity_check_is_not_used() {
        let parent = tempdir().unwrap();
        let (previous, base) = (parent.path().join("old"), parent.path().join("new"));
        make_previous(&previous);
        let bytes = fs::read(old_db_path(&previous)).unwrap();
        // Same size, damaged inside the first table's pages.
        let mut damaged = bytes.clone();
        let mid = damaged.len() / 2;
        damaged[mid..mid + 600].fill(0xAB);
        fs::write(old_db_path(&previous), &damaged).unwrap();

        let err = move_into(&base, &previous).unwrap_err();

        assert_eq!(err.kind(), ErrorKind::MigrationFailed);
        assert_nothing_published(&base);
        assert_eq!(fs::read(old_db_path(&previous)).unwrap(), damaged);
    }

    #[test]
    fn a_database_that_is_not_ours_is_skipped_and_its_folder_left_alone() {
        let parent = tempdir().unwrap();
        let base = parent.path().join("new");
        for (name, make) in [
            ("foreign", foreign_db as fn(&Path)),
            ("text", |p: &Path| {
                fs::write(p, b"old database bytes").unwrap();
            }),
        ] {
            let previous = parent.path().join(name);
            fs::create_dir_all(recordings_dir(&previous)).unwrap();
            write_wav(&recordings_dir(&previous).join("rec_1.wav"), 10);
            make(&old_db_path(&previous));
            let before = (fs::read(old_db_path(&previous)).unwrap(), wavs(&previous));

            assert!(!move_into(&base, &previous).unwrap(), "{name}");

            assert_nothing_published(&base);
            assert_eq!(
                (fs::read(old_db_path(&previous)).unwrap(), wavs(&previous)),
                before
            );
        }
    }

    #[test]
    fn the_copy_is_a_snapshot_with_the_same_schema_version_and_no_side_files() {
        let parent = tempdir().unwrap();
        let (previous, base) = (parent.path().join("old"), parent.path().join("new"));
        make_previous(&previous);

        move_into(&base, &previous).unwrap();

        let version = |db: &Path| -> i64 {
            Connection::open(db)
                .unwrap()
                .pragma_query_value(None, "user_version", |r| r.get(0))
                .unwrap()
        };
        assert_eq!(
            version(&db_path(&base)),
            version(&old_db_path(&previous)),
            "it is not migrated again"
        );
        assert_eq!(version(&db_path(&base)), db::SCHEMA_VERSION);
        let side_files: Vec<_> = fs::read_dir(&base)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().contains("-journal"))
            .collect();
        assert!(side_files.is_empty());
    }

    #[test]
    fn rows_a_writer_has_not_committed_yet_are_not_in_the_copy() {
        let parent = tempdir().unwrap();
        let (previous, base) = (parent.path().join("old"), parent.path().join("new"));
        make_previous(&previous);
        let writer = Connection::open(old_db_path(&previous)).unwrap();
        writer.execute_batch("BEGIN IMMEDIATE").unwrap();
        db::insert_result(&writer, &new_result("glides", 12.0), 1_730_000_999).unwrap();

        assert!(move_into(&base, &previous).unwrap());

        assert_eq!(result_count(&base), 2);
        writer.execute_batch("ROLLBACK").unwrap();
    }

    #[test]
    fn a_database_a_crashed_writer_left_a_hot_journal_on_is_copied_as_it_was_before_the_crash() {
        let parent = tempdir().unwrap();
        let (previous, base) = (parent.path().join("old"), parent.path().join("new"));
        make_previous(&previous);
        leave_hot_journal(&old_db_path(&previous));
        let before = tree_bytes(&previous);

        assert!(move_into(&base, &previous).unwrap());

        assert_eq!(result_count(&base), 2, "the committed rows, not the rest");
        assert_eq!(wavs(&base), wavs(&previous));
        assert_eq!(
            tree_bytes(&previous),
            before,
            "the old folder is not written"
        );
        assert!(!base.join(STAGING).exists());
    }

    #[test]
    fn a_copy_with_fewer_rows_than_the_original_is_caught() {
        let parent = tempdir().unwrap();
        let (previous, base) = (parent.path().join("old"), parent.path().join("new"));
        make_previous(&previous);

        let err = move_into_with(&base, &previous, &mut |copy| {
            if copy.file_name().is_some_and(|n| n == crate::paths::DB_FILE) {
                Connection::open(copy)?.execute("DELETE FROM exercise_result", [])?;
            }
            Ok(())
        })
        .unwrap_err();

        assert_eq!(err.kind(), ErrorKind::MigrationFailed);
        assert_nothing_published(&base);
    }

    #[test]
    fn a_database_cut_short_by_the_copy_is_caught() {
        let parent = tempdir().unwrap();
        let (previous, base) = (parent.path().join("old"), parent.path().join("new"));
        make_previous(&previous);

        let err = move_into_with(&base, &previous, &mut |copy| {
            if copy.file_name().is_some_and(|n| n == crate::paths::DB_FILE) {
                let cut = fs::metadata(copy)?.len() / 2;
                fs::OpenOptions::new()
                    .write(true)
                    .open(copy)?
                    .set_len(cut)?;
            }
            Ok(())
        })
        .unwrap_err();

        assert_eq!(err.kind(), ErrorKind::MigrationFailed);
        assert_nothing_published(&base);
    }

    #[cfg(unix)]
    #[test]
    fn a_publish_that_fails_midway_leaves_the_folder_unused_and_the_retry_finishes() {
        use std::os::unix::fs::PermissionsExt;
        let parent = tempdir().unwrap();
        let (previous, base) = (parent.path().join("old"), parent.path().join("new"));
        make_previous(&previous);
        let target = recordings_dir(&base);
        fs::create_dir_all(&target).unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o555)).unwrap();
        if fs::File::create(target.join("probe")).is_ok() {
            return;
        }

        let err = move_into(&base, &previous).unwrap_err();

        fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(err.kind(), ErrorKind::MigrationFailed);
        assert!(!db_path(&base).exists(), "the database goes in last");
        assert!(move_into(&base, &previous).unwrap());
        assert_eq!(wavs(&base), wavs(&previous));
        assert_eq!(result_count(&base), 2);
    }

    #[test]
    fn staging_left_by_a_crash_is_replaced_not_reused() {
        let parent = tempdir().unwrap();
        let (previous, base) = (parent.path().join("old"), parent.path().join("new"));
        make_previous(&previous);
        let stale = base.join(STAGING);
        fs::create_dir_all(stale.join("recordings")).unwrap();
        fs::write(stale.join("recordings/rec_77.wav"), b"half a file").unwrap();
        fs::write(stale.join(crate::paths::DB_FILE), b"half a database").unwrap();

        assert!(move_into(&base, &previous).unwrap());

        assert_eq!(result_count(&base), 2);
        assert!(!recordings_dir(&base).join("rec_77.wav").exists());
        assert!(!stale.exists());
    }
}
