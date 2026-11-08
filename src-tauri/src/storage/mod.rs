//! Local storage: SQLite rows, recordings on disk, backups.
//!
//! `Storage` only knows where the data folder is. Each piece below takes the
//! folder (`&Path`) or a `&Connection`, so tests run in a temp folder.

pub mod backup;
pub mod db;
pub mod export;
pub mod legacy;
pub mod model;
pub mod old_folder;
pub mod previous_folder;
pub mod recordings;

use std::fs;
use std::io::Write;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError, RwLock, RwLockReadGuard};

use rusqlite::Connection;

use crate::error::{AppError, AppResult};
use crate::paths;
use old_folder::{MigrationReport, Removal};

#[derive(Debug, Clone)]
pub struct Storage {
    base: PathBuf,
    /// The data folder of the previous bundle identifier (`com.voice.trainer`).
    previous: Option<PathBuf>,
    /// The first version's folder.
    legacy: Option<PathBuf>,
    /// True once the older folders have been dealt with. Shared by every clone.
    settled: Arc<Mutex<bool>>,
    /// Held shared by every open `Conn` and exclusively while earlier data is
    /// moved over, so the move sees no write in flight and none starts under it.
    writers: Arc<RwLock<()>>,
}

/// An open database. While it lives, "Move my earlier data again" cannot run:
/// a save made through it can never land in a database the move is about to
/// replace. Keep it only as long as the work needs it.
#[derive(Debug)]
pub struct Conn<'a> {
    // Declared first so the connection closes before the lock is released.
    conn: Connection,
    _writer: RwLockReadGuard<'a, ()>,
}

impl Deref for Conn<'_> {
    type Target = Connection;

    fn deref(&self) -> &Connection {
        &self.conn
    }
}

/// What `delete_all` removed beyond the current data.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteReport {
    /// The app's data in the first version's folder was removed too (the folder
    /// itself only if nothing else was in it).
    pub old_folder_removed: bool,
    /// So was the data in the folder of the previous bundle identifier.
    pub previous_folder_removed: bool,
    /// An older folder's database could not be read, so the folder was left
    /// in place: it cannot be said to be ours.
    pub could_not_check: bool,
}

impl Storage {
    /// Create the folders and bring in what the older folders hold: first the
    /// previous identifier's data, then the first version's. If the previous
    /// data (or the first version's database) cannot be copied yet, the app
    /// still starts: every `conn()` tries again and fails with
    /// `MigrationFailed` until it works, so nothing is ever saved into a
    /// folder that only looks empty.
    pub fn init(base: PathBuf, previous: Option<&Path>, legacy: Option<&Path>) -> AppResult<Self> {
        fs::create_dir_all(paths::recordings_dir(&base))?;
        let storage = Self {
            base,
            previous: previous.map(Path::to_path_buf),
            legacy: legacy.map(Path::to_path_buf),
            settled: Arc::new(Mutex::new(false)),
            writers: Arc::new(RwLock::new(())),
        };
        // Before anything reads an older database: a crash may have left a
        // scratch copy of one behind.
        db::sweep_scratch(&storage.base);
        match storage.settle() {
            Ok(()) => drop(storage.conn()?),
            Err(e) => eprintln!("could not move the earlier data yet, will ask to retry: {e}"),
        }
        Ok(storage)
    }

    pub fn base(&self) -> &Path {
        &self.base
    }

    pub fn recordings_dir(&self) -> PathBuf {
        paths::recordings_dir(&self.base)
    }

    /// Open the database. Until the older folders are dealt with this first
    /// tries to, so a failed copy is retried by whatever asks next.
    pub fn conn(&self) -> AppResult<Conn<'_>> {
        // The shared lock comes first: a move that runs between settling and
        // opening would otherwise leave this connection on a replaced file.
        let writer = self.writers.read().unwrap_or_else(PoisonError::into_inner);
        self.settle()?;
        let conn = db::open(&paths::db_path(&self.base))?;
        Ok(Conn {
            conn,
            _writer: writer,
        })
    }

    /// Copy the previous identifier's data if the new folder has no database,
    /// then the first version's if it is still waiting. Either failing is an
    /// error until a retry works.
    fn settle(&self) -> AppResult<()> {
        let mut settled = self.settled.lock().unwrap_or_else(PoisonError::into_inner);
        if *settled {
            return Ok(());
        }
        if self.base.join(old_folder::SKIP_IMPORT_MARKER).exists() {
            *settled = true;
            return Ok(());
        }
        self.bring_over_older()?;
        *settled = true;
        Ok(())
    }

    /// The moves themselves, whatever the skip marker says.
    fn bring_over_older(&self) -> AppResult<()> {
        if let Some(previous) = &self.previous {
            previous_folder::move_into(&self.base, previous)?;
        }
        if let Some(old) = &self.legacy {
            // Like the previous folder: while the database cannot be brought
            // over the app saves nothing, or the first save would make the
            // empty database "the person's data" and the old one never read.
            settle_first_version(old_folder::migrate(&self.base, old), old)?;
        }
        Ok(())
    }

    /// The way out of a move that can never work: remember not to try again,
    /// and open an empty database. Neither older folder is touched, now or
    /// later. Nothing already in the data folder is changed or removed.
    pub fn start_fresh(&self) -> AppResult<()> {
        {
            let mut settled = self.settled.lock().unwrap_or_else(PoisonError::into_inner);
            paths::write_atomic(&self.base.join(old_folder::SKIP_IMPORT_MARKER), |file| {
                Ok(file
                    .write_all(b"the earlier data was left where it is; see the app's source\n")?)
            })?;
            *settled = true;
        }
        drop(self.conn()?);
        Ok(())
    }

    /// True when "Start fresh" skipped a move that could still be done: an
    /// older folder has a database, and nothing has been saved here since (no
    /// result, profile, note or recording), so moving cannot replace anything.
    pub fn can_move_earlier_data(&self) -> bool {
        let _writers = self.writers.read().unwrap_or_else(PoisonError::into_inner);
        let _settled = self.settled.lock().unwrap_or_else(PoisonError::into_inner);
        self.move_is_possible()
    }

    fn move_is_possible(&self) -> bool {
        // A database that is certainly not ours does not count; one that
        // cannot be read yet might be, and a move that fails changes nothing.
        let older_database = [&self.previous, &self.legacy]
            .into_iter()
            .flatten()
            .map(|folder| paths::old_db_path(folder))
            .any(|db| db.is_file() && !matches!(db::is_apps_database(&db, &self.base), Ok(false)));
        self.base.join(old_folder::SKIP_IMPORT_MARKER).exists()
            && !self
                .base
                .join(old_folder::EARLIER_DATA_DELETED_MARKER)
                .exists()
            && older_database
            && !self.holds_data()
    }

    /// Anything the person (or an earlier move) put here. A database that
    /// cannot be read counts as data, so it is never deleted by mistake.
    fn holds_data(&self) -> bool {
        let db = paths::db_path(&self.base);
        let recordings = fs::read_dir(self.recordings_dir()).is_ok_and(|entries| {
            entries.flatten().any(|e| {
                e.file_name()
                    .to_str()
                    .is_some_and(|n| paths::validate_recording_name(n).is_ok())
            })
        });
        recordings || (db.exists() && !old_folder::db_is_empty(&db))
    }

    /// The way back from "Start fresh": drop the empty database, run the move
    /// again, and only when it worked forget the skip. Refused once anything
    /// was saved. If the move fails again, `MigrationFailed` is returned, the
    /// skip stays and the app opens empty as after "Start fresh".
    pub fn move_earlier_data(&self) -> AppResult<()> {
        // Exclusive: waits for every save in flight, and holds off new ones
        // until the move is done. That is what makes "nothing saved since"
        // still true when the empty database is replaced.
        let _exclusive = self.writers.write().unwrap_or_else(PoisonError::into_inner);
        let mut settled = self.settled.lock().unwrap_or_else(PoisonError::into_inner);
        if !self.move_is_possible() {
            return Err(AppError::invalid(
                "there is no earlier data to move, or something was saved since",
            ));
        }
        let db = paths::db_path(&self.base);
        if db.exists() {
            fs::remove_file(db)?;
        }
        // On failure the skip marker stays, so her "Start fresh" still
        // stands: the next `conn()` opens an empty database again.
        self.bring_over_older()?;
        fs::remove_file(self.base.join(old_folder::SKIP_IMPORT_MARKER))?;
        *settled = true;
        drop(db::open(&paths::db_path(&self.base))?);
        Ok(())
    }

    /// Delete every result, the profile, all notes and all recordings, and
    /// both older folders (they hold recordings too). The report says if an
    /// older folder had to be left because its database could not be checked.
    pub fn delete_all(&self) -> AppResult<DeleteReport> {
        let conn = self.conn()?;
        recordings::delete_all_files(&self.base)?;
        db::delete_all(&conn)?;
        db::sweep_scratch(&self.base);
        // Before the older folders go: even one that cannot be checked and is
        // left in place must not be offered back.
        paths::write_atomic(
            &self.base.join(old_folder::EARLIER_DATA_DELETED_MARKER),
            |file| Ok(file.write_all(b"the earlier data was deleted on request\n")?),
        )?;
        let legacy = self.remove_older(self.legacy.as_deref())?;
        let previous = self.remove_older(self.previous.as_deref())?;
        Ok(DeleteReport {
            old_folder_removed: legacy == Removal::Removed,
            previous_folder_removed: previous == Removal::Removed,
            could_not_check: legacy == Removal::CouldNotCheck || previous == Removal::CouldNotCheck,
        })
    }

    fn remove_older(&self, folder: Option<&Path>) -> AppResult<Removal> {
        match folder {
            Some(folder) => old_folder::remove(&self.base, folder),
            None => Ok(Removal::NothingToRemove),
        }
    }
}

/// A database that could not be brought over (or any other failure of the
/// copy) stops saving until a retry works, like the previous folder. A
/// recording that could not be read yet does not: the database is in, and the
/// next start tries that file again. The log line is for whoever runs it from
/// a terminal.
fn settle_first_version(outcome: AppResult<MigrationReport>, folder: &Path) -> AppResult<()> {
    match outcome {
        Ok(MigrationReport {
            db_error: Some(cause),
            ..
        }) => Err(previous_folder::copy_failed(folder, &cause)),
        Ok(report) => {
            if report.recordings_failed > 0 {
                eprintln!("some old recordings not copied yet, will retry: {report:?}");
            }
            Ok(())
        }
        Err(e) => Err(previous_folder::copy_failed(folder, e.message())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorKind;
    use crate::storage::export::{self, ExportFormat};
    use crate::storage::model::fixtures::{new_result, profile};
    use crate::storage::testutil::{leave_hot_journal, tree_bytes, write_wav};
    use tempfile::tempdir;

    /// A folder as the first version left it: its schema, full-path notes.
    fn first_version_folder(dir: &Path) {
        fs::create_dir_all(dir.join("recordings")).unwrap();
        write_wav(&dir.join("recordings/rec_5.wav"), 100);
        let conn = Connection::open(paths::old_db_path(dir)).unwrap();
        conn.execute_batch(
            "CREATE TABLE exercise_result (
                id INTEGER PRIMARY KEY AUTOINCREMENT, exercise_id TEXT NOT NULL,
                score REAL NOT NULL, pitch_mean REAL NOT NULL, pitch_sd REAL NOT NULL,
                duration_s REAL NOT NULL, created_at INTEGER NOT NULL);
             CREATE TABLE profile (
                id INTEGER PRIMARY KEY, target_min_hz REAL NOT NULL, target_max_hz REAL NOT NULL,
                baseline_hz REAL NOT NULL, goals TEXT NOT NULL DEFAULT '[]',
                language TEXT NOT NULL DEFAULT 'en', theme TEXT NOT NULL DEFAULT 'dark',
                onboarded INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE recording_meta (
                path TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '');
             INSERT INTO exercise_result VALUES (1,'glides',61.5,172,9,60,1730000000);
             INSERT INTO profile VALUES (1,165,255,128,'[\"pitch\"]','es','light',1);
             INSERT INTO recording_meta VALUES ('D:\\old\\voice-trainer\\recordings\\rec_5.wav','mine','x');",
        )
        .unwrap();
    }

    /// The folder of the previous identifier as that build left it: the old
    /// database name, a profile, two results, a note and two recordings.
    fn previous_folder(dir: &Path) {
        fs::create_dir_all(paths::recordings_dir(dir)).unwrap();
        write_wav(&paths::recordings_dir(dir).join("rec_10.wav"), 200);
        write_wav(&paths::recordings_dir(dir).join("rec_20.wav"), 400);
        let conn = db::open(&paths::old_db_path(dir)).unwrap();
        db::set_profile(&conn, &profile()).unwrap();
        db::insert_result(&conn, &new_result("glides", 70.0), 1_730_000_100).unwrap();
        db::insert_result(&conn, &new_result("pitch_hold", 55.0), 1_730_000_200).unwrap();
        conn.execute(
            "INSERT INTO recording_meta (name, note, tags) VALUES ('rec_10.wav', 'warm', 'a')",
            [],
        )
        .unwrap();
    }

    fn names_of(storage: &Storage) -> Vec<String> {
        let conn = storage.conn().unwrap();
        let mut names: Vec<_> = recordings::list(storage.base(), &conn)
            .unwrap()
            .into_iter()
            .map(|r| r.name)
            .collect();
        names.sort();
        names
    }

    fn scores_of(storage: &Storage) -> Vec<Option<f64>> {
        let mut scores: Vec<_> = db::list_results(&storage.conn().unwrap())
            .unwrap()
            .into_iter()
            .map(|r| r.result.score)
            .collect();
        scores.sort_by(|a, b| a.partial_cmp(b).unwrap());
        scores
    }

    #[test]
    fn a_fresh_install_starts_empty() {
        let parent = tempdir().unwrap();
        let new = parent.path().join("com.witchynibbles.lilthop");
        let previous = parent.path().join("com.voice.trainer");
        let legacy = parent.path().join("voice-trainer");

        let storage = Storage::init(new.clone(), Some(&previous), Some(&legacy)).unwrap();

        assert!(scores_of(&storage).is_empty());
        assert_eq!(db::get_profile(&storage.conn().unwrap()).unwrap(), None);
        assert!(names_of(&storage).is_empty());
        assert!(paths::db_path(&new).exists());
        assert!(
            !previous.exists() && !legacy.exists(),
            "nothing is invented"
        );
    }

    #[test]
    fn the_previous_identifiers_data_is_there_on_first_start_and_its_folder_stays() {
        let parent = tempdir().unwrap();
        let new = parent.path().join("com.witchynibbles.lilthop");
        let previous = parent.path().join("com.voice.trainer");
        previous_folder(&previous);
        let before = tree_bytes(&previous);

        let storage = Storage::init(new, Some(&previous), None).unwrap();

        assert_eq!(scores_of(&storage), vec![Some(55.0), Some(70.0)]);
        assert_eq!(names_of(&storage), vec!["rec_10.wav", "rec_20.wav"]);
        let conn = storage.conn().unwrap();
        assert_eq!(db::get_profile(&conn).unwrap().unwrap().language, "es");
        let listed = recordings::list(storage.base(), &conn).unwrap();
        let note_of = |name: &str| listed.iter().find(|r| r.name == name).unwrap().note.clone();
        assert_eq!(
            (note_of("rec_10.wav"), note_of("rec_20.wav")),
            ("warm".into(), String::new())
        );
        assert_eq!(tree_bytes(&previous), before, "the old folder is untouched");
    }

    #[test]
    fn the_first_versions_folder_alone_still_comes_along() {
        let legacy = tempdir().unwrap();
        let base = tempdir().unwrap();
        first_version_folder(legacy.path());
        let old_db = fs::read(paths::old_db_path(legacy.path())).unwrap();

        let storage = Storage::init(base.path().join("new"), None, Some(legacy.path())).unwrap();

        let conn = storage.conn().unwrap();
        let rows = db::list_results(&conn).unwrap();
        assert_eq!((rows.len(), rows[0].result.score), (1, Some(61.5)));
        let p = db::get_profile(&conn).unwrap().unwrap();
        assert_eq!(
            (p.baseline_hz, p.pitch_engine, p.onboarded),
            (128.0, 1, true)
        );
        assert_eq!(p.goals, vec!["pitch"]);
        let all = recordings::list(storage.base(), &conn).unwrap();
        assert_eq!(
            (all.len(), all[0].name.as_str(), all[0].note.as_str()),
            (1, "rec_5.wav", "mine")
        );
        assert_eq!(
            fs::read(paths::old_db_path(legacy.path())).unwrap(),
            old_db,
            "old folder untouched"
        );
    }

    #[test]
    fn with_both_folders_the_previous_one_wins_and_nothing_is_imported_twice() {
        let parent = tempdir().unwrap();
        let legacy = parent.path().join("voice-trainer");
        let previous = parent.path().join("com.voice.trainer");
        let new = parent.path().join("com.witchynibbles.lilthop");
        first_version_folder(&legacy);
        // The previous build had already imported the first version's folder,
        // then the person practised some more.
        let earlier = Storage::init(previous.clone(), None, Some(&legacy)).unwrap();
        db::insert_result(
            &earlier.conn().unwrap(),
            &new_result("glides", 80.0),
            1_730_001_000,
        )
        .unwrap();
        fs::rename(paths::db_path(&previous), paths::old_db_path(&previous)).unwrap();
        let before = (tree_bytes(&previous), tree_bytes(&legacy));

        let storage = Storage::init(new.clone(), Some(&previous), Some(&legacy)).unwrap();
        let again = Storage::init(new, Some(&previous), Some(&legacy)).unwrap();

        for s in [&storage, &again] {
            assert_eq!(scores_of(s), vec![Some(61.5), Some(80.0)], "61.5 only once");
            assert_eq!(names_of(s), vec!["rec_5.wav"]);
        }
        assert_eq!((tree_bytes(&previous), tree_bytes(&legacy)), before);
    }

    #[test]
    fn the_previous_data_wins_even_when_it_never_finished_importing_the_first_version() {
        let parent = tempdir().unwrap();
        let legacy = parent.path().join("voice-trainer");
        let previous = parent.path().join("com.voice.trainer");
        first_version_folder(&legacy);
        previous_folder(&previous);

        let storage =
            Storage::init(parent.path().join("new"), Some(&previous), Some(&legacy)).unwrap();

        assert_eq!(scores_of(&storage), vec![Some(55.0), Some(70.0)]);
        assert_eq!(
            db::get_profile(&storage.conn().unwrap())
                .unwrap()
                .unwrap()
                .baseline_hz,
            130.0
        );
    }

    #[test]
    fn a_new_folder_that_already_has_data_is_never_touched() {
        let parent = tempdir().unwrap();
        let previous = parent.path().join("com.voice.trainer");
        let new = parent.path().join("com.witchynibbles.lilthop");
        previous_folder(&previous);
        let first = Storage::init(new.clone(), None, None).unwrap();
        db::insert_result(
            &first.conn().unwrap(),
            &new_result("glides", 33.0),
            1_730_500_000,
        )
        .unwrap();
        let before = tree_bytes(&new);

        let storage = Storage::init(new.clone(), Some(&previous), None).unwrap();

        assert_eq!(scores_of(&storage), vec![Some(33.0)]);
        assert!(names_of(&storage).is_empty(), "no recordings copied in");
        assert_eq!(tree_bytes(&new), before);
    }

    #[cfg(unix)]
    fn lock(path: &Path, locked: bool) -> bool {
        use std::os::unix::fs::PermissionsExt;
        let mode = if locked { 0o000 } else { 0o644 };
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
        !locked || fs::File::open(path).is_err()
    }

    #[cfg(unix)]
    #[test]
    fn a_copy_that_cannot_finish_starts_the_app_but_saves_nothing_and_a_retry_brings_it_all() {
        let parent = tempdir().unwrap();
        let previous = parent.path().join("com.voice.trainer");
        let new = parent.path().join("com.witchynibbles.lilthop");
        previous_folder(&previous);
        let stuck = paths::recordings_dir(&previous).join("rec_20.wav");
        if !lock(&stuck, true) {
            return;
        }

        let storage = Storage::init(new.clone(), Some(&previous), None).unwrap();

        let err = storage.conn().unwrap_err();
        assert_eq!(err.kind(), ErrorKind::MigrationFailed);
        assert!(
            !paths::db_path(&new).exists(),
            "no empty database to save into"
        );
        assert!(
            paths::recordings_dir(&new)
                .read_dir()
                .unwrap()
                .next()
                .is_none()
        );
        assert!(paths::old_db_path(&previous).exists(), "old data safe");

        lock(&stuck, false);
        assert_eq!(
            scores_of(&storage),
            vec![Some(55.0), Some(70.0)],
            "same app, retried"
        );
        assert_eq!(names_of(&storage), vec!["rec_10.wav", "rec_20.wav"]);
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_copy_is_also_retried_by_the_next_start() {
        let parent = tempdir().unwrap();
        let previous = parent.path().join("com.voice.trainer");
        let new = parent.path().join("com.witchynibbles.lilthop");
        previous_folder(&previous);
        let stuck = paths::old_db_path(&previous);
        if !lock(&stuck, true) {
            return;
        }
        let first = Storage::init(new.clone(), Some(&previous), None).unwrap();
        assert!(first.conn().is_err());

        lock(&stuck, false);
        let second = Storage::init(new, Some(&previous), None).unwrap();

        assert_eq!(scores_of(&second), vec![Some(55.0), Some(70.0)]);
    }

    #[test]
    fn a_previous_folder_left_with_a_hot_journal_still_comes_along_and_stays_as_it_was() {
        let parent = tempdir().unwrap();
        let new = parent.path().join("com.witchynibbles.lilthop");
        let previous = parent.path().join("com.voice.trainer");
        previous_folder(&previous);
        leave_hot_journal(&paths::old_db_path(&previous));
        let before = tree_bytes(&previous);

        let storage = Storage::init(new, Some(&previous), None).unwrap();

        assert_eq!(scores_of(&storage), vec![Some(55.0), Some(70.0)]);
        assert_eq!(tree_bytes(&previous), before);
    }

    #[test]
    fn a_first_version_folder_left_with_a_hot_journal_still_comes_along_and_stays_as_it_was() {
        let parent = tempdir().unwrap();
        let new = parent.path().join("com.witchynibbles.lilthop");
        let legacy = parent.path().join("voice-trainer");
        first_version_folder(&legacy);
        leave_hot_journal(&paths::old_db_path(&legacy));
        let before = tree_bytes(&legacy);

        let storage = Storage::init(new.clone(), None, Some(&legacy)).unwrap();

        assert_eq!(scores_of(&storage), vec![Some(61.5)]);
        assert_eq!(names_of(&storage), vec!["rec_5.wav"]);
        assert_eq!(tree_bytes(&legacy), before);
    }

    #[cfg(unix)]
    #[test]
    fn a_first_version_import_that_fails_is_not_silent_and_never_marks_itself_done() {
        let parent = tempdir().unwrap();
        let new = parent.path().join("com.witchynibbles.lilthop");
        let legacy = parent.path().join("voice-trainer");
        first_version_folder(&legacy);
        let stuck = paths::old_db_path(&legacy);
        if !lock(&stuck, true) {
            return;
        }

        let storage = Storage::init(new.clone(), None, Some(&legacy)).unwrap();

        let err = storage.conn().unwrap_err();
        assert_eq!(err.kind(), ErrorKind::MigrationFailed);
        assert!(
            !paths::db_path(&new).exists(),
            "no empty database to save into"
        );
        assert!(!new.join(old_folder::DONE_MARKER).exists());

        lock(&stuck, false);
        assert_eq!(scores_of(&storage), vec![Some(61.5)], "the retry brings it");
        assert!(new.join(old_folder::DONE_MARKER).exists());
    }

    #[cfg(unix)]
    #[test]
    fn start_fresh_gets_out_of_a_first_version_import_that_cannot_work() {
        let parent = tempdir().unwrap();
        let new = parent.path().join("com.witchynibbles.lilthop");
        let legacy = parent.path().join("voice-trainer");
        first_version_folder(&legacy);
        let before = tree_bytes(&legacy);
        let stuck = paths::old_db_path(&legacy);
        if !lock(&stuck, true) {
            return;
        }
        let storage = Storage::init(new, None, Some(&legacy)).unwrap();
        assert!(storage.conn().is_err());

        storage.start_fresh().unwrap();

        assert!(scores_of(&storage).is_empty());
        lock(&stuck, false);
        assert_eq!(tree_bytes(&legacy), before);
    }

    /// A start where the previous folder's move cannot work, then "Start
    /// fresh". The stuck recording is unlocked by `lock(&stuck, false)`.
    #[cfg(unix)]
    fn started_fresh_after_a_failed_move(parent: &Path) -> Option<(Storage, PathBuf, PathBuf)> {
        let previous = parent.join("com.voice.trainer");
        let new = parent.join("com.witchynibbles.lilthop");
        previous_folder(&previous);
        let stuck = paths::recordings_dir(&previous).join("rec_20.wav");
        if !lock(&stuck, true) {
            return None;
        }
        let storage = Storage::init(new, Some(&previous), None).unwrap();
        assert!(storage.conn().is_err());
        storage.start_fresh().unwrap();
        Some((storage, previous, stuck))
    }

    #[cfg(unix)]
    #[test]
    fn earlier_data_skipped_with_start_fresh_can_be_moved_after_all_while_nothing_new_was_saved() {
        let parent = tempdir().unwrap();
        let Some((storage, previous, stuck)) = started_fresh_after_a_failed_move(parent.path())
        else {
            return;
        };
        assert!(storage.can_move_earlier_data());
        lock(&stuck, false);
        let before = tree_bytes(&previous);

        storage.move_earlier_data().unwrap();

        assert_eq!(scores_of(&storage), vec![Some(55.0), Some(70.0)]);
        assert_eq!(names_of(&storage), vec!["rec_10.wav", "rec_20.wav"]);
        assert!(!storage.can_move_earlier_data(), "done, nothing to offer");
        assert_eq!(
            tree_bytes(&previous),
            before,
            "the old folder is not written"
        );
        let restarted = Storage::init(storage.base().to_path_buf(), Some(&previous), None).unwrap();
        assert_eq!(scores_of(&restarted), vec![Some(55.0), Some(70.0)]);
    }

    #[cfg(unix)]
    #[test]
    fn once_anything_is_saved_the_move_is_not_offered_and_not_allowed() {
        let parent = tempdir().unwrap();
        let Some((storage, previous, stuck)) = started_fresh_after_a_failed_move(parent.path())
        else {
            return;
        };
        lock(&stuck, false);
        db::insert_result(
            &storage.conn().unwrap(),
            &new_result("glides", 44.0),
            1_730_600_000,
        )
        .unwrap();

        assert!(!storage.can_move_earlier_data());
        let err = storage.move_earlier_data().unwrap_err();

        assert_eq!(err.kind(), ErrorKind::InvalidInput);
        assert_eq!(scores_of(&storage), vec![Some(44.0)], "her data is intact");
        assert!(previous.exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_recording_made_since_also_ends_the_offer() {
        let parent = tempdir().unwrap();
        let Some((storage, _, _)) = started_fresh_after_a_failed_move(parent.path()) else {
            return;
        };
        write_wav(&storage.recordings_dir().join("rec_900.wav"), 50);

        assert!(!storage.can_move_earlier_data());
    }

    #[cfg(unix)]
    #[test]
    fn a_move_that_fails_again_keeps_her_start_fresh_choice() {
        let parent = tempdir().unwrap();
        let Some((storage, previous, stuck)) = started_fresh_after_a_failed_move(parent.path())
        else {
            return;
        };

        let err = storage.move_earlier_data().unwrap_err();

        assert_eq!(err.kind(), ErrorKind::MigrationFailed);
        assert!(
            storage.base().join(old_folder::SKIP_IMPORT_MARKER).exists(),
            "Start fresh still stands"
        );
        assert!(scores_of(&storage).is_empty(), "the app still opens, empty");
        assert!(storage.can_move_earlier_data(), "she can try again");
        let restarted = Storage::init(storage.base().to_path_buf(), Some(&previous), None).unwrap();
        assert!(
            scores_of(&restarted).is_empty(),
            "a restart does not move it"
        );
        lock(&stuck, false);
        restarted.move_earlier_data().unwrap();
        assert_eq!(scores_of(&restarted), vec![Some(55.0), Some(70.0)]);
    }

    #[test]
    fn a_foreign_database_with_our_file_name_is_never_offered_as_earlier_data() {
        use crate::storage::testutil::foreign_db;
        let parent = tempdir().unwrap();
        let previous = parent.path().join("com.voice.trainer");
        fs::create_dir_all(&previous).unwrap();
        foreign_db(&paths::old_db_path(&previous));
        let storage = Storage::init(parent.path().join("new"), Some(&previous), None).unwrap();
        storage.start_fresh().unwrap();

        assert!(!storage.can_move_earlier_data());
        assert_eq!(
            storage.move_earlier_data().unwrap_err().kind(),
            ErrorKind::InvalidInput
        );
    }

    #[cfg(unix)]
    #[test]
    fn after_delete_all_could_not_check_a_folder_the_move_is_not_offered() {
        let parent = tempdir().unwrap();
        let legacy = parent.path().join("voice-trainer");
        first_version_folder(&legacy);
        let storage = Storage::init(parent.path().join("new"), None, Some(&legacy)).unwrap();
        storage.start_fresh().unwrap();
        let stuck = paths::old_db_path(&legacy);
        if !lock(&stuck, true) {
            return;
        }

        let report = storage.delete_all().unwrap();

        lock(&stuck, false);
        assert!(report.could_not_check);
        assert!(
            !storage.can_move_earlier_data(),
            "she asked for it to be deleted"
        );
        assert_eq!(
            storage.move_earlier_data().unwrap_err().kind(),
            ErrorKind::InvalidInput
        );
        let restarted = Storage::init(storage.base().to_path_buf(), None, Some(&legacy)).unwrap();
        assert!(!restarted.can_move_earlier_data(), "nor after a restart");
    }

    #[cfg(unix)]
    #[test]
    fn a_save_in_flight_while_the_move_runs_is_never_lost() {
        let parent = tempdir().unwrap();
        let Some((storage, _, stuck)) = started_fresh_after_a_failed_move(parent.path()) else {
            return;
        };
        lock(&stuck, false);
        let (opened_tx, opened_rx) = std::sync::mpsc::channel();
        let saver = storage.clone();
        let save = std::thread::spawn(move || {
            // The save has its connection, as a command does, and writes later.
            let conn = saver.conn().unwrap();
            opened_tx.send(()).unwrap();
            std::thread::sleep(std::time::Duration::from_millis(300));
            db::insert_result(&conn, &new_result("glides", 44.0), 1_730_600_000).unwrap();
        });
        opened_rx.recv().unwrap();

        let outcome = storage.move_earlier_data();
        save.join().unwrap();

        assert_eq!(
            outcome.unwrap_err().kind(),
            ErrorKind::InvalidInput,
            "something was saved, so the move gives way"
        );
        assert_eq!(scores_of(&storage), vec![Some(44.0)], "the save landed");
    }

    #[test]
    fn without_start_fresh_there_is_nothing_to_offer() {
        let parent = tempdir().unwrap();
        let previous = parent.path().join("com.voice.trainer");
        previous_folder(&previous);
        let storage = Storage::init(parent.path().join("new"), Some(&previous), None).unwrap();

        assert!(!storage.can_move_earlier_data());
        assert_eq!(
            storage.move_earlier_data().unwrap_err().kind(),
            ErrorKind::InvalidInput
        );
    }

    #[test]
    fn start_fresh_with_no_old_folder_to_move_offers_nothing() {
        let parent = tempdir().unwrap();
        let storage = Storage::init(parent.path().join("new"), None, None).unwrap();
        storage.start_fresh().unwrap();

        assert!(!storage.can_move_earlier_data());
    }

    #[cfg(unix)]
    #[test]
    fn start_fresh_opens_an_empty_database_for_good_and_leaves_the_old_folder_alone() {
        let parent = tempdir().unwrap();
        let (previous, legacy) = (
            parent.path().join("com.voice.trainer"),
            parent.path().join("voice-trainer"),
        );
        let new = parent.path().join("com.witchynibbles.lilthop");
        previous_folder(&previous);
        first_version_folder(&legacy);
        let (before_previous, before_legacy) = (tree_bytes(&previous), tree_bytes(&legacy));
        let stuck = paths::recordings_dir(&previous).join("rec_20.wav");
        if !lock(&stuck, true) {
            return;
        }
        let storage = Storage::init(new.clone(), Some(&previous), Some(&legacy)).unwrap();
        assert_eq!(
            storage.conn().unwrap_err().kind(),
            ErrorKind::MigrationFailed
        );

        storage.start_fresh().unwrap();

        assert!(scores_of(&storage).is_empty());
        lock(&stuck, false);
        assert!(scores_of(&storage).is_empty(), "not retried while running");
        db::insert_result(
            &storage.conn().unwrap(),
            &new_result("glides", 44.0),
            1_730_600_000,
        )
        .unwrap();
        let restarted = Storage::init(new, Some(&previous), Some(&legacy)).unwrap();
        assert_eq!(
            scores_of(&restarted),
            vec![Some(44.0)],
            "nor on the next start"
        );
        assert!(names_of(&restarted).is_empty());
        assert_eq!(tree_bytes(&previous), before_previous);
        assert_eq!(tree_bytes(&legacy), before_legacy);
    }

    #[test]
    fn a_start_fresh_marker_keeps_both_older_folders_from_being_imported() {
        let parent = tempdir().unwrap();
        let (previous, legacy) = (
            parent.path().join("com.voice.trainer"),
            parent.path().join("voice-trainer"),
        );
        let new = parent.path().join("com.witchynibbles.lilthop");
        previous_folder(&previous);
        first_version_folder(&legacy);
        fs::create_dir_all(&new).unwrap();
        fs::write(new.join(old_folder::SKIP_IMPORT_MARKER), b"").unwrap();

        let storage = Storage::init(new, Some(&previous), Some(&legacy)).unwrap();

        assert!(scores_of(&storage).is_empty());
        assert!(names_of(&storage).is_empty());
    }

    #[test]
    fn start_fresh_on_a_healthy_start_changes_nothing_that_was_copied() {
        let parent = tempdir().unwrap();
        let previous = parent.path().join("com.voice.trainer");
        let new = parent.path().join("com.witchynibbles.lilthop");
        previous_folder(&previous);
        let storage = Storage::init(new, Some(&previous), None).unwrap();

        storage.start_fresh().unwrap();

        assert_eq!(scores_of(&storage), vec![Some(55.0), Some(70.0)]);
    }

    #[test]
    fn many_callers_at_once_copy_only_once() {
        let parent = tempdir().unwrap();
        let previous = parent.path().join("com.voice.trainer");
        let new = parent.path().join("com.witchynibbles.lilthop");
        previous_folder(&previous);
        fs::create_dir_all(paths::recordings_dir(&new)).unwrap();
        let storage = Storage {
            base: new,
            previous: Some(previous),
            legacy: None,
            settled: Arc::new(Mutex::new(false)),
            writers: Arc::new(RwLock::new(())),
        };

        let handles: Vec<_> = (0..4)
            .map(|_| {
                let s = storage.clone();
                std::thread::spawn(move || s.conn().map(|_| ()))
            })
            .collect();

        for h in handles {
            h.join().unwrap().unwrap();
        }
        assert_eq!(scores_of(&storage), vec![Some(55.0), Some(70.0)]);
    }

    #[test]
    fn backup_export_and_restore_work_on_the_moved_data() {
        let parent = tempdir().unwrap();
        let previous = parent.path().join("com.voice.trainer");
        previous_folder(&previous);
        let moved = Storage::init(parent.path().join("a"), Some(&previous), None).unwrap();
        let zip = parent.path().join("backup.zip");
        let csv = parent.path().join("results.csv");

        backup::create_to(moved.base(), &moved.conn().unwrap(), &zip).unwrap();
        export::export_to(&moved.conn().unwrap(), &csv, ExportFormat::Csv).unwrap();
        let fresh = Storage::init(parent.path().join("b"), None, None).unwrap();
        let summary =
            backup::restore_from(fresh.base(), &fresh.conn().unwrap(), &zip, 1_800_000_000)
                .unwrap();

        assert_eq!((summary.results, summary.recordings), (2, 2));
        assert_eq!(scores_of(&fresh), vec![Some(55.0), Some(70.0)]);
        assert_eq!(names_of(&fresh), vec!["rec_10.wav", "rec_20.wav"]);
        assert_eq!(fs::read_to_string(csv).unwrap().lines().count(), 3);
    }

    #[test]
    fn delete_all_wipes_every_place_and_nothing_comes_back_on_restart() {
        let parent = tempdir().unwrap();
        let legacy = parent.path().join("voice-trainer");
        let previous = parent.path().join("com.voice.trainer");
        let new = parent.path().join("com.witchynibbles.lilthop");
        let neighbour = parent.path().join("other-app");
        first_version_folder(&legacy);
        previous_folder(&previous);
        fs::create_dir_all(&neighbour).unwrap();
        fs::write(neighbour.join("keep.txt"), b"x").unwrap();
        let storage = Storage::init(new.clone(), Some(&previous), Some(&legacy)).unwrap();
        let conn = storage.conn().unwrap();
        db::insert_result(&conn, &new_result("glides", 99.0), 1_730_000_900).unwrap();

        let report = storage.delete_all().unwrap();
        let again = Storage::init(new.clone(), Some(&previous), Some(&legacy)).unwrap();

        assert!(report.old_folder_removed && report.previous_folder_removed);
        assert!(
            !legacy.exists(),
            "the first version's folder held recordings too"
        );
        assert!(!previous.exists(), "so did the previous identifier's");
        assert!(neighbour.join("keep.txt").exists());
        assert!(scores_of(&again).is_empty());
        assert_eq!(db::get_profile(&again.conn().unwrap()).unwrap(), None);
        assert!(names_of(&again).is_empty());
        assert!(
            tree_bytes(&paths::recordings_dir(&new)).is_empty(),
            "recordings are gone from disk too"
        );
    }

    fn stale_scratch(base: &Path) -> PathBuf {
        let stale = base.join(".read-scratch-7");
        fs::create_dir_all(&stale).unwrap();
        fs::write(stale.join("voice_trainer.db"), b"a copy of her old data").unwrap();
        stale
    }

    #[test]
    fn a_scratch_copy_left_by_a_crash_is_swept_at_the_next_start() {
        let parent = tempdir().unwrap();
        let new = parent.path().join("com.witchynibbles.lilthop");
        let stale = stale_scratch(&new);

        let storage = Storage::init(new, None, None).unwrap();

        assert!(!stale.exists());
        assert!(scores_of(&storage).is_empty());
    }

    #[test]
    fn reading_an_old_database_with_a_hot_journal_leaves_no_scratch_copy_in_the_data_folder() {
        let parent = tempdir().unwrap();
        let previous = parent.path().join("com.voice.trainer");
        let new = parent.path().join("com.witchynibbles.lilthop");
        previous_folder(&previous);
        leave_hot_journal(&paths::old_db_path(&previous));

        let storage = Storage::init(new.clone(), Some(&previous), None).unwrap();

        assert_eq!(scores_of(&storage), vec![Some(55.0), Some(70.0)]);
        let scratch: Vec<_> = fs::read_dir(&new)
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with(".read-scratch-")
            })
            .collect();
        assert!(scratch.is_empty());
    }

    #[test]
    fn delete_all_removes_scratch_copies_too() {
        let parent = tempdir().unwrap();
        let new = parent.path().join("com.witchynibbles.lilthop");
        let storage = Storage::init(new.clone(), None, None).unwrap();
        let stale = stale_scratch(&new);

        storage.delete_all().unwrap();

        assert!(!stale.exists(), "a copy of her data is not left behind");
    }

    #[test]
    fn deleting_all_removes_the_previous_data_even_if_it_was_never_copied() {
        let parent = tempdir().unwrap();
        let previous = parent.path().join("com.voice.trainer");
        let new = parent.path().join("com.witchynibbles.lilthop");
        previous_folder(&previous);
        let storage = Storage::init(new.clone(), Some(&previous), None).unwrap();

        storage.delete_all().unwrap();
        let again = Storage::init(new, Some(&previous), None).unwrap();

        assert!(!previous.exists());
        assert!(scores_of(&again).is_empty());
    }

    #[test]
    fn folders_that_only_share_our_file_names_are_neither_imported_nor_deleted() {
        use crate::storage::testutil::foreign_db;
        let parent = tempdir().unwrap();
        let legacy = parent.path().join("voice-trainer");
        let previous = parent.path().join("com.voice.trainer");
        let new = parent.path().join("com.witchynibbles.lilthop");
        for folder in [&legacy, &previous] {
            fs::create_dir_all(folder.join("recordings")).unwrap();
            write_wav(&folder.join("recordings/rec_5.wav"), 100);
        }
        foreign_db(&paths::old_db_path(&legacy));
        fs::write(paths::old_db_path(&previous), b"not even sqlite").unwrap();
        let (before_legacy, before_previous) = (tree_bytes(&legacy), tree_bytes(&previous));

        let storage = Storage::init(new.clone(), Some(&previous), Some(&legacy)).unwrap();
        let conn = storage.conn().unwrap();
        assert!(db::list_results(&conn).unwrap().is_empty(), "started fresh");
        assert!(names_of(&storage).is_empty());
        let report = storage.delete_all().unwrap();

        assert_eq!(report, DeleteReport::default());
        assert_eq!(tree_bytes(&legacy), before_legacy);
        assert_eq!(tree_bytes(&previous), before_previous);
    }

    #[cfg(unix)]
    #[test]
    fn delete_all_says_when_an_older_folder_could_not_be_checked_and_leaves_it() {
        let parent = tempdir().unwrap();
        let legacy = parent.path().join("voice-trainer");
        let new = parent.path().join("com.witchynibbles.lilthop");
        first_version_folder(&legacy);
        let storage = Storage::init(new, None, Some(&legacy)).unwrap();
        let stuck = paths::old_db_path(&legacy);
        if !lock(&stuck, true) {
            return;
        }

        let report = storage.delete_all().unwrap();

        lock(&stuck, false);
        assert!(report.could_not_check && !report.old_folder_removed);
        assert!(stuck.exists() && legacy.join("recordings/rec_5.wav").exists());
        assert!(scores_of(&storage).is_empty(), "the current data is gone");
    }

    #[test]
    fn delete_all_without_older_folders_reports_nothing_removed() {
        let base = tempdir().unwrap();
        let storage = Storage::init(base.path().join("new"), None, None).unwrap();
        assert_eq!(storage.delete_all().unwrap(), DeleteReport::default());
    }
}

#[cfg(test)]
pub(crate) mod testutil {
    use crate::storage::db::side_file;
    use rusqlite::Connection;
    use std::path::Path;

    /// A database as the first version left it (no `user_version`, notes keyed
    /// by full path), holding one result.
    pub fn first_version_db(path: &Path) {
        Connection::open(path)
            .unwrap()
            .execute_batch(
                "CREATE TABLE exercise_result (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, exercise_id TEXT NOT NULL,
                    score REAL NOT NULL, pitch_mean REAL NOT NULL, pitch_sd REAL NOT NULL,
                    duration_s REAL NOT NULL, created_at INTEGER NOT NULL);
                 CREATE TABLE profile (
                    id INTEGER PRIMARY KEY, target_min_hz REAL NOT NULL,
                    target_max_hz REAL NOT NULL, baseline_hz REAL NOT NULL);
                 CREATE TABLE recording_meta (
                    path TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '',
                    tags TEXT NOT NULL DEFAULT '');
                 INSERT INTO exercise_result VALUES (1,'glides',61.5,172,9,60,1730000000);",
            )
            .unwrap();
    }

    /// Rows the crashed writer of `leave_hot_journal` never committed.
    pub const UNCOMMITTED_ROWS: i64 = 3000;

    /// Turn the database at `db` into what a writer that crashed mid-commit
    /// leaves: the file with changes already in it, and a `-journal` beside it
    /// that SQLite must replay before anything can be read. Made the way it
    /// happens: a write transaction big enough to spill its cache into the
    /// file, with the files copied while it is still open. Nothing the writer
    /// adds is ever committed, so a reader that recovers sees exactly the rows
    /// `db` had before.
    pub fn leave_hot_journal(db: &Path) {
        let scratch = tempfile::tempdir().unwrap();
        let work = scratch.path().join(db.file_name().unwrap());
        std::fs::copy(db, &work).unwrap();
        let writer = Connection::open(&work).unwrap();
        writer
            .execute_batch(&format!(
                "PRAGMA cache_size = 10;
                 BEGIN IMMEDIATE;
                 WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < {UNCOMMITTED_ROWS})
                 INSERT INTO exercise_result (exercise_id, score, pitch_mean, pitch_sd, duration_s, created_at)
                 SELECT printf('%0200d', i), 50, 150, 5, 30, 1800000000 + i FROM n;"
            ))
            .unwrap();
        std::fs::copy(&work, db).unwrap();
        std::fs::copy(side_file(&work, "-journal"), side_file(db, "-journal")).unwrap();
        drop(writer);
        smash_journaled_pages(db);
        assert!(
            Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                .unwrap()
                .query_row("SELECT COUNT(*) FROM exercise_result", [], |r| r
                    .get::<_, i64>(0))
                .is_err(),
            "the fixture must really be unreadable read-only"
        );
    }

    /// Every file under a folder with its bytes, so "untouched" means untouched.
    pub fn tree_bytes(dir: &Path) -> std::collections::BTreeMap<std::path::PathBuf, Vec<u8>> {
        let mut files = std::collections::BTreeMap::new();
        let mut pending = vec![dir.to_path_buf()];
        while let Some(folder) = pending.pop() {
            for entry in std::fs::read_dir(folder).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    pending.push(path);
                } else {
                    files.insert(
                        path.strip_prefix(dir).unwrap().to_path_buf(),
                        std::fs::read(&path).unwrap(),
                    );
                }
            }
        }
        files
    }

    /// Overwrite every page the journal holds a copy of, as a crash half-way
    /// through writing the file would leave them: the file then only makes
    /// sense once the journal is rolled back.
    fn smash_journaled_pages(db: &Path) {
        use std::io::{Seek, SeekFrom, Write};
        let journal = std::fs::read(side_file(db, "-journal")).unwrap();
        let be = |at: usize| u32::from_be_bytes(journal[at..at + 4].try_into().unwrap()) as usize;
        let (sector, page_size) = (be(20), be(24));
        let record = 4 + page_size + 4;
        let recorded = match be(8) {
            0 | 0xFFFF_FFFF => (journal.len() - sector) / record,
            n => n,
        };
        assert!(recorded > 0, "the writer must have spilled into the file");
        let mut file = std::fs::OpenOptions::new().write(true).open(db).unwrap();
        for n in 0..recorded {
            let page = be(sector + n * record);
            file.seek(SeekFrom::Start(((page - 1) * page_size) as u64))
                .unwrap();
            file.write_all(&vec![0xAA; page_size]).unwrap();
        }
    }

    /// Another program's SQLite database that happens to be named like ours.
    pub fn foreign_db(path: &Path) {
        Connection::open(path)
            .unwrap()
            .execute_batch("CREATE TABLE contacts (id INTEGER PRIMARY KEY, name TEXT);")
            .unwrap();
    }

    /// A real 16-bit mono WAV of silence-ish samples.
    pub fn write_wav(path: &Path, samples: usize) {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 8000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut w = hound::WavWriter::create(path, spec).unwrap();
        for i in 0..samples {
            w.write_sample((i % 100) as i16).unwrap();
        }
        w.finalize().unwrap();
    }
}
