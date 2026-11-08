//! SQLite access. Every query takes a `&Connection` so tests use a temp file
//! or memory. Schema changes go through `PRAGMA user_version` migrations.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use rusqlite::{Connection, ErrorCode, OpenFlags, OptionalExtension, Row, params};

use crate::error::{AppError, AppResult, ErrorKind};
use crate::paths::validate_recording_name;
use crate::storage::model::{BackupResult, NewResult, Profile, RecordingMeta, SavedResult};

pub const SCHEMA_VERSION: i64 = 2;

const RESULT_COLUMNS: &str = "id, exercise_id, score, pitch_mean, pitch_sd, duration_s, \
     voiced_s, scoring_version, created_at";

pub fn open(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(Duration::from_secs(5))?;
    migrate(&conn)?;
    Ok(conn)
}

/// Bring the schema to `SCHEMA_VERSION`. Works on an empty file and on the
/// first version's database (user_version 0 with tables already there).
pub fn migrate(conn: &Connection) -> AppResult<()> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version > SCHEMA_VERSION {
        return Err(AppError::new(
            crate::error::ErrorKind::Database,
            "this data was saved by a newer version of the app",
        ));
    }
    if version < 1 {
        let tx = conn.unchecked_transaction()?;
        migrate_to_v1(&tx)?;
        tx.pragma_update(None, "user_version", 1)?;
        tx.commit()?;
    }
    if version < 2 {
        let tx = conn.unchecked_transaction()?;
        migrate_to_v2(&tx)?;
        tx.pragma_update(None, "user_version", 2)?;
        tx.commit()?;
    }
    Ok(())
}

/// Columns this app's tables have had since the first version. A database in
/// an old data folder is only ever read, copied or cleaned up if it has all of
/// them: file names alone (`voice_trainer.db`) can belong to another program.
const MARKER_COLUMNS: [(&str, &[&str]); 2] = [
    (
        "exercise_result",
        &[
            "exercise_id",
            "score",
            "pitch_mean",
            "pitch_sd",
            "duration_s",
            "created_at",
        ],
    ),
    (
        "profile",
        &["target_min_hz", "target_max_hz", "baseline_hz"],
    ),
];

/// Is `path` a SQLite database that carries this app's schema: a `user_version`
/// the app knows (0 is the first version's, which never set it), the columns in
/// `MARKER_COLUMNS`, and a `recording_meta` table keyed by `name` or, in the
/// first version, `path`, with `note` and `tags`? Read through
/// `open_for_reading`, so the folder is never written.
///
/// `Ok(false)` means it is certainly not ours: not a SQLite file, another
/// program's tables, or saved by a newer version. `Err` means we could not tell
/// (locked, unreadable, damaged), which callers must not treat as "foreign".
pub fn is_apps_database(path: &Path, scratch_parent: &Path) -> AppResult<bool> {
    let conn = open_for_reading(path, scratch_parent)?;
    let version: i64 = match conn.pragma_query_value(None, "user_version", |r| r.get(0)) {
        Ok(version) => version,
        Err(e) if is_not_a_database(&e) => return Ok(false),
        Err(e) => return Err(e.into()),
    };
    if !(0..=SCHEMA_VERSION).contains(&version) {
        return Ok(false);
    }
    let has = |table: &str, column: &str| -> AppResult<bool> {
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
            params![table, column],
            |r| r.get(0),
        )?;
        Ok(n == 1)
    };
    for (table, columns) in MARKER_COLUMNS {
        for column in columns {
            if !has(table, column)? {
                return Ok(false);
            }
        }
    }
    Ok(
        (has("recording_meta", "name")? || has("recording_meta", "path")?)
            && has("recording_meta", "note")?
            && has("recording_meta", "tags")?,
    )
}

fn is_not_a_database(e: &rusqlite::Error) -> bool {
    matches!(
        e,
        rusqlite::Error::SqliteFailure(f, _) if f.code == rusqlite::ErrorCode::NotADatabase
    )
}

/// How long a reader waits for a writer that is busy right now.
const READ_BUSY_TIMEOUT: Duration = Duration::from_secs(2);

/// `path` with `suffix` added to its file name: `x.db` and `-journal` is
/// `x.db-journal`, where SQLite keeps the changes of a write in progress.
pub(crate) fn side_file(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_owned();
    name.push(suffix);
    path.with_file_name(name)
}

/// A database open for reading only. Most of the time that is the file itself.
/// If a writer crashed and left a hot `-journal`, SQLite will not read the
/// file without writing (to roll the journal back), which a read-only
/// connection cannot do; then this is a scratch copy of the pair, rolled back,
/// and the original is never written. The copy is deleted on drop.
pub struct ReadableDatabase {
    // Declared first so the connection closes before the copy is deleted.
    conn: Connection,
    _scratch: Option<ScratchDir>,
}

impl Deref for ReadableDatabase {
    type Target = Connection;

    fn deref(&self) -> &Connection {
        &self.conn
    }
}

/// A private folder inside the app's own data folder (never the OS temp
/// folder, which other users and programs can reach), removed with its
/// contents on drop. One left behind by a crash is swept at the next start.
struct ScratchDir(PathBuf);

/// Start of every scratch folder's name, so a sweep knows them.
const SCRATCH_PREFIX: &str = ".read-scratch-";

impl ScratchDir {
    /// Created exclusively (a name that exists is never reused) and, on unix,
    /// readable by this user only.
    fn create_in(parent: &Path) -> AppResult<Self> {
        fs::create_dir_all(parent)?;
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        loop {
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let dir = parent.join(format!("{SCRATCH_PREFIX}{n}"));
            let mut builder = fs::DirBuilder::new();
            #[cfg(unix)]
            std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
            match builder.create(&dir) {
                Ok(()) => return Ok(Self(dir)),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(e.into()),
            }
        }
    }
}

/// Remove every scratch folder in `base`: what a crash (or a Delete all)
/// leaves behind. A link with that name is removed as a link, never followed.
pub fn sweep_scratch(base: &Path) {
    let Ok(entries) = fs::read_dir(base) else {
        return;
    };
    for entry in entries.flatten() {
        if !entry
            .file_name()
            .to_string_lossy()
            .starts_with(SCRATCH_PREFIX)
        {
            continue;
        }
        let path = entry.path();
        if fs::symlink_metadata(&path).is_ok_and(|m| m.is_dir()) {
            let _ = fs::remove_dir_all(&path);
        } else {
            let _ = fs::remove_file(&path);
        }
    }
}

impl Drop for ScratchDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Open `path` for reading; see `ReadableDatabase`. A scratch copy, if one is
/// needed, goes inside `scratch_parent` (the app's data folder). A reader that
/// finds the database busy waits a couple of seconds for the writer.
pub fn open_for_reading(path: &Path, scratch_parent: &Path) -> AppResult<ReadableDatabase> {
    match open_and_probe(path) {
        Ok(conn) => Ok(ReadableDatabase {
            conn,
            _scratch: None,
        }),
        Err(e) if needs_a_write(&e) && has_journal(path) => {
            open_rolled_back_copy(path, scratch_parent)
        }
        Err(e) => Err(e.into()),
    }
}

/// Open read-only and read once, because opening alone touches nothing: the
/// hot journal shows on the first read. A file that is not a database is
/// returned as it is, for the caller to rule on.
fn open_and_probe(path: &Path) -> rusqlite::Result<Connection> {
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(path, flags)?;
    conn.busy_timeout(READ_BUSY_TIMEOUT)?;
    match conn.query_row("SELECT COUNT(*) FROM sqlite_master", [], |r| {
        r.get::<_, i64>(0)
    }) {
        Err(e) if !is_not_a_database(&e) => Err(e),
        _ => Ok(conn),
    }
}

/// What a read-only connection says when it would have to write to read.
fn needs_a_write(e: &rusqlite::Error) -> bool {
    matches!(
        e,
        rusqlite::Error::SqliteFailure(f, _)
            if matches!(f.code, ErrorCode::ReadOnly | ErrorCode::CannotOpen)
    )
}

fn has_journal(path: &Path) -> bool {
    fs::metadata(side_file(path, "-journal")).is_ok_and(|m| m.len() > 0)
}

/// Copy the database and its journal under the same names, let SQLite roll the
/// journal back there, and open the result read-only.
fn open_rolled_back_copy(path: &Path, scratch_parent: &Path) -> AppResult<ReadableDatabase> {
    let scratch = ScratchDir::create_in(scratch_parent)?;
    let name: OsString = path
        .file_name()
        .ok_or_else(|| AppError::invalid("the database has no file name"))?
        .to_owned();
    let copy = scratch.0.join(name);
    fs::copy(path, &copy)?;
    fs::copy(side_file(path, "-journal"), side_file(&copy, "-journal"))?;
    {
        // Reading it is what rolls the journal back; this one may write.
        let recovering = Connection::open(&copy)?;
        recovering.busy_timeout(READ_BUSY_TIMEOUT)?;
        recovering.query_row("SELECT COUNT(*) FROM sqlite_master", [], |r| {
            r.get::<_, i64>(0)
        })?;
    }
    let conn = open_and_probe(&copy)?;
    Ok(ReadableDatabase {
        conn,
        _scratch: Some(scratch),
    })
}

/// Write a consistent copy of the database to `to`. SQLite itself reads it
/// (`VACUUM INTO` on a read-only connection), so the copy holds exactly the
/// committed rows even if a writer is active, and needs no journal beside it.
/// The result is synced to disk. `to` must not exist.
pub fn snapshot_database(from: &Path, to: &Path, scratch_parent: &Path) -> AppResult<()> {
    let source = open_for_reading(from, scratch_parent)?;
    source.execute("VACUUM INTO ?1", [to.to_string_lossy()])?;
    drop(source);
    OpenOptions::new().write(true).open(to)?.sync_all()?;
    Ok(())
}

/// Both databases pass SQLite's own integrity check (a damaged original could
/// be copied without complaint and lose rows silently), and every table has as
/// many rows in the copy as in the original. Byte size is no test here:
/// `VACUUM INTO` repacks the file, so it is rarely the size of the original.
pub fn verify_database(source: &Path, copy: &Path, scratch_parent: &Path) -> AppResult<()> {
    let original = open_for_reading(source, scratch_parent)?;
    let copied = open_for_reading(copy, scratch_parent)?;
    for (which, conn) in [("original", &original), ("copied", &copied)] {
        let verdict: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
        if verdict != "ok" {
            return Err(mismatch(format!(
                "the {which} database is damaged: {verdict}"
            )));
        }
    }
    let (want, got) = (row_counts(&original)?, row_counts(&copied)?);
    if want != got {
        return Err(mismatch(format!(
            "the copied database has different rows: {got:?}, the original {want:?}"
        )));
    }
    Ok(())
}

fn mismatch(what: impl Into<String>) -> AppError {
    AppError::new(ErrorKind::MigrationFailed, what)
}

/// Rows per table, for every table the database has.
fn row_counts(conn: &Connection) -> AppResult<BTreeMap<String, i64>> {
    let tables: Vec<String> = conn
        .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    let mut counts = BTreeMap::new();
    for table in tables {
        let quoted = table.replace('"', "\"\"");
        let rows = conn.query_row(&format!("SELECT COUNT(*) FROM \"{quoted}\""), [], |r| {
            r.get(0)
        })?;
        counts.insert(table, rows);
    }
    Ok(counts)
}

/// Brightness practice has no score, so `score` may be NULL. SQLite treats
/// NULLs as distinct in a unique index, so the key uses `IFNULL(score, -1)`
/// (real scores are 0..100): a null-score row still dedupes on restore.
fn migrate_to_v2(conn: &Connection) -> AppResult<()> {
    let score_required: i64 = conn.query_row(
        "SELECT \"notnull\" FROM pragma_table_info('exercise_result') WHERE name = 'score'",
        [],
        |r| r.get(0),
    )?;
    if score_required == 1 {
        conn.execute_batch(
            "CREATE TABLE exercise_result_v2 (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                exercise_id TEXT NOT NULL,
                score REAL,
                pitch_mean REAL NOT NULL,
                pitch_sd REAL NOT NULL,
                duration_s REAL NOT NULL,
                created_at INTEGER NOT NULL,
                voiced_s REAL NOT NULL DEFAULT 0,
                scoring_version INTEGER NOT NULL DEFAULT 0
            );
            INSERT INTO exercise_result_v2
                (id, exercise_id, score, pitch_mean, pitch_sd, duration_s, created_at,
                 voiced_s, scoring_version)
                SELECT id, exercise_id, score, pitch_mean, pitch_sd, duration_s, created_at,
                       voiced_s, scoring_version
                FROM exercise_result;
            DROP TABLE exercise_result;
            ALTER TABLE exercise_result_v2 RENAME TO exercise_result;",
        )?;
    }
    conn.execute_batch(
        "DROP INDEX IF EXISTS ux_result_key;
         CREATE UNIQUE INDEX ux_result_key
            ON exercise_result (exercise_id, created_at, IFNULL(score, -1));",
    )?;
    Ok(())
}

/// Columns added after the first version, with the value old rows get.
const ADDED_COLUMNS: [(&str, &str, &str); 9] = [
    ("exercise_result", "voiced_s", "REAL NOT NULL DEFAULT 0"),
    (
        "exercise_result",
        "scoring_version",
        "INTEGER NOT NULL DEFAULT 0",
    ),
    ("profile", "goals", "TEXT NOT NULL DEFAULT '[]'"),
    ("profile", "language", "TEXT NOT NULL DEFAULT 'en'"),
    ("profile", "theme", "TEXT NOT NULL DEFAULT 'dark'"),
    ("profile", "onboarded", "INTEGER NOT NULL DEFAULT 0"),
    ("profile", "baseline_centroid", "REAL NOT NULL DEFAULT 2000"),
    ("profile", "baseline_rms", "REAL NOT NULL DEFAULT 0"),
    // Old profiles were measured by the biased detector.
    ("profile", "pitch_engine", "INTEGER NOT NULL DEFAULT 1"),
];

fn migrate_to_v1(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS exercise_result (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exercise_id TEXT NOT NULL,
            score REAL NOT NULL,
            pitch_mean REAL NOT NULL,
            pitch_sd REAL NOT NULL,
            duration_s REAL NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS profile (
            id INTEGER PRIMARY KEY,
            target_min_hz REAL NOT NULL,
            target_max_hz REAL NOT NULL,
            baseline_hz REAL NOT NULL
        );",
    )?;
    for (table, column, decl) in ADDED_COLUMNS {
        add_column_if_missing(conn, table, column, decl)?;
    }
    // Restoring a backup twice used to duplicate rows; keep the first copy.
    conn.execute_batch(
        "DELETE FROM exercise_result WHERE id NOT IN
            (SELECT MIN(id) FROM exercise_result GROUP BY exercise_id, created_at, score);
         CREATE UNIQUE INDEX IF NOT EXISTS ux_result_key
            ON exercise_result (exercise_id, created_at, score);",
    )?;
    migrate_meta_keys(conn)
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    decl: &str,
) -> AppResult<()> {
    let present: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
        params![table, column],
        |r| r.get(0),
    )?;
    if present == 0 {
        conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"))?;
    }
    Ok(())
}

const META_TABLE: &str = "CREATE TABLE recording_meta (
    name TEXT PRIMARY KEY,
    note TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT ''
)";

/// Notes used to be keyed by full path. Key them by file name; a path that
/// does not end in a valid recording name cannot be reached any more, so its
/// note is not carried over.
fn migrate_meta_keys(conn: &Connection) -> AppResult<()> {
    let has_table: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='recording_meta'",
        [],
        |r| r.get(0),
    )?;
    if has_table == 0 {
        conn.execute_batch(META_TABLE)?;
        return Ok(());
    }
    let keyed_by_path: i64 = conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info('recording_meta') WHERE name = 'path'",
        [],
        |r| r.get(0),
    )?;
    if keyed_by_path == 0 {
        return Ok(());
    }
    conn.execute_batch("ALTER TABLE recording_meta RENAME TO recording_meta_v0")?;
    conn.execute_batch(META_TABLE)?;
    let old: Vec<(String, String, String)> = {
        let mut stmt =
            conn.prepare("SELECT path, note, tags FROM recording_meta_v0 ORDER BY rowid")?;
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<_, _>>()?
    };
    for (path, note, tags) in old {
        let name = path.rsplit(['/', '\\']).next().unwrap_or_default();
        if validate_recording_name(name).is_ok() {
            conn.execute(
                "INSERT OR IGNORE INTO recording_meta (name, note, tags) VALUES (?1, ?2, ?3)",
                params![name, note, tags],
            )?;
        }
    }
    conn.execute_batch("DROP TABLE recording_meta_v0")?;
    Ok(())
}

pub fn get_profile(conn: &Connection) -> AppResult<Option<Profile>> {
    let row = conn
        .query_row(
            "SELECT baseline_hz, baseline_centroid, baseline_rms, target_min_hz, target_max_hz,
                    goals, language, theme, onboarded, pitch_engine
             FROM profile WHERE id = 1",
            [],
            |r| {
                let goals: String = r.get(5)?;
                Ok(Profile {
                    baseline_hz: r.get(0)?,
                    baseline_centroid: r.get(1)?,
                    baseline_rms: r.get(2)?,
                    target_min_hz: r.get(3)?,
                    target_max_hz: r.get(4)?,
                    // A damaged goals cell must not hide the whole profile.
                    goals: serde_json::from_str(&goals).unwrap_or_default(),
                    language: r.get(6)?,
                    theme: r.get(7)?,
                    onboarded: r.get::<_, i64>(8)? != 0,
                    pitch_engine: r.get(9)?,
                })
            },
        )
        .optional()?;
    Ok(row)
}

pub fn set_profile(conn: &Connection, profile: &Profile) -> AppResult<()> {
    profile.validate()?;
    let goals = serde_json::to_string(&profile.goals)?;
    conn.execute(
        "INSERT INTO profile (id, baseline_hz, baseline_centroid, baseline_rms, target_min_hz,
                              target_max_hz, goals, language, theme, onboarded, pitch_engine)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
            baseline_hz = excluded.baseline_hz,
            baseline_centroid = excluded.baseline_centroid,
            baseline_rms = excluded.baseline_rms,
            target_min_hz = excluded.target_min_hz,
            target_max_hz = excluded.target_max_hz,
            goals = excluded.goals,
            language = excluded.language,
            theme = excluded.theme,
            onboarded = excluded.onboarded,
            pitch_engine = excluded.pitch_engine",
        params![
            profile.baseline_hz,
            profile.baseline_centroid,
            profile.baseline_rms,
            profile.target_min_hz,
            profile.target_max_hz,
            goals,
            profile.language,
            profile.theme,
            profile.onboarded,
            profile.pitch_engine,
        ],
    )?;
    Ok(())
}

/// Insert a result; a row with the same exercise, time and score is kept
/// once. Returns the id of the stored row either way.
pub fn insert_result(conn: &Connection, result: &NewResult, created_at: i64) -> AppResult<i64> {
    result.validate()?;
    insert_or_ignore(conn, result, created_at)?;
    let id = conn.query_row(
        "SELECT id FROM exercise_result WHERE exercise_id = ?1 AND created_at = ?2 AND score IS ?3",
        params![result.exercise_id, created_at, result.score],
        |r| r.get(0),
    )?;
    Ok(id)
}

/// Same as `insert_result` for a backup row; true if a new row was added.
pub fn insert_backup_result(conn: &Connection, row: &BackupResult) -> AppResult<bool> {
    row.result.validate()?;
    Ok(insert_or_ignore(conn, &row.result, row.created_at)? == 1)
}

fn insert_or_ignore(conn: &Connection, r: &NewResult, created_at: i64) -> AppResult<usize> {
    let changed = conn.execute(
        "INSERT OR IGNORE INTO exercise_result
            (exercise_id, score, pitch_mean, pitch_sd, duration_s, voiced_s, scoring_version, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            r.exercise_id,
            r.score,
            r.pitch_mean,
            r.pitch_sd,
            r.duration_s,
            r.voiced_s,
            r.scoring_version,
            created_at,
        ],
    )?;
    Ok(changed)
}

fn saved_result(r: &Row<'_>) -> rusqlite::Result<SavedResult> {
    Ok(SavedResult {
        id: r.get(0)?,
        created_at: r.get(8)?,
        result: NewResult {
            exercise_id: r.get(1)?,
            score: r.get(2)?,
            pitch_mean: r.get(3)?,
            pitch_sd: r.get(4)?,
            duration_s: r.get(5)?,
            voiced_s: r.get(6)?,
            scoring_version: r.get(7)?,
        },
    })
}

/// Every row, newest first.
pub fn list_results(conn: &Connection) -> AppResult<Vec<SavedResult>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {RESULT_COLUMNS} FROM exercise_result ORDER BY created_at DESC, id DESC"
    ))?;
    let rows = stmt
        .query_map([], saved_result)?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

fn meta_from_row(r: &Row<'_>) -> rusqlite::Result<RecordingMeta> {
    Ok(RecordingMeta {
        name: r.get(0)?,
        note: r.get(1)?,
        tags: r.get(2)?,
    })
}

#[cfg(test)]
pub fn get_meta(conn: &Connection, name: &str) -> AppResult<Option<RecordingMeta>> {
    let meta = conn
        .query_row(
            "SELECT name, note, tags FROM recording_meta WHERE name = ?1",
            params![name],
            meta_from_row,
        )
        .optional()?;
    Ok(meta)
}

pub fn list_meta(conn: &Connection) -> AppResult<Vec<RecordingMeta>> {
    let mut stmt = conn.prepare("SELECT name, note, tags FROM recording_meta ORDER BY name")?;
    let rows = stmt
        .query_map([], meta_from_row)?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn set_meta(conn: &Connection, meta: &RecordingMeta) -> AppResult<()> {
    meta.validate()?;
    conn.execute(
        "INSERT INTO recording_meta (name, note, tags) VALUES (?1, ?2, ?3)
         ON CONFLICT(name) DO UPDATE SET note = excluded.note, tags = excluded.tags",
        params![meta.name, meta.note, meta.tags],
    )?;
    Ok(())
}

/// Add a note only where the recording has none yet; true if added.
pub fn insert_meta_if_absent(conn: &Connection, meta: &RecordingMeta) -> AppResult<bool> {
    meta.validate()?;
    let changed = conn.execute(
        "INSERT OR IGNORE INTO recording_meta (name, note, tags) VALUES (?1, ?2, ?3)",
        params![meta.name, meta.note, meta.tags],
    )?;
    Ok(changed == 1)
}

pub fn delete_meta(conn: &Connection, name: &str) -> AppResult<()> {
    conn.execute("DELETE FROM recording_meta WHERE name = ?1", params![name])?;
    Ok(())
}

/// Remove every row and give the freed pages back to the file system.
pub fn delete_all(conn: &Connection) -> AppResult<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(
        "DELETE FROM exercise_result; DELETE FROM profile; DELETE FROM recording_meta;",
    )?;
    tx.commit()?;
    conn.execute_batch("VACUUM")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorKind;
    use crate::storage::model::fixtures::{new_result, profile, unscored_result};
    use crate::storage::testutil::leave_hot_journal;
    use std::fs;
    use tempfile::tempdir;

    const T0: i64 = 1_730_000_000;

    fn fresh() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    /// The schema the first version created, plus the junk its bugs left:
    /// a duplicated result (restore ran twice) and full-path meta keys.
    /// The profile table predates goals/language/theme/onboarded.
    fn old_db(conn: &Connection) {
        conn.execute_batch(
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
             INSERT INTO exercise_result VALUES
                (1,'sustained_tone',80,150,3,45,1730000000),
                (2,'sustained_tone',80,150,3,45,1730000000),
                (3,'glides',55,170,12,60,1730000500);
             INSERT INTO profile VALUES (1,165,255,130);
             INSERT INTO recording_meta VALUES
                ('D:\\data\\voice-trainer\\recordings\\rec_1.wav','first take','warmup'),
                ('/home/x/voice-trainer/recordings/rec_2.wav','','');",
        )
        .unwrap();
    }

    #[test]
    fn the_apps_own_databases_are_recognised() {
        let dir = tempdir().unwrap();
        let current = dir.path().join("current.db");
        open(&current).unwrap();
        let first = dir.path().join("first.db");
        old_db(&Connection::open(&first).unwrap());

        assert!(is_apps_database(&current, dir.path()).unwrap());
        assert!(
            is_apps_database(&first, dir.path()).unwrap(),
            "the first version's has no user_version"
        );
    }

    #[test]
    fn anything_else_is_not_taken_for_ours() {
        let dir = tempdir().unwrap();
        let path = |name: &str| dir.path().join(name);
        // Another program's database.
        Connection::open(path("foreign.db"))
            .unwrap()
            .execute_batch("CREATE TABLE contacts (id INTEGER PRIMARY KEY, name TEXT);")
            .unwrap();
        // Same table names, different columns.
        Connection::open(path("lookalike.db"))
            .unwrap()
            .execute_batch(
                "CREATE TABLE exercise_result (id INTEGER PRIMARY KEY);
                 CREATE TABLE profile (id INTEGER PRIMARY KEY);
                 CREATE TABLE recording_meta (id INTEGER PRIMARY KEY);",
            )
            .unwrap();
        // Ours, but saved by a newer version.
        let newer = path("newer.db");
        open(&newer).unwrap();
        Connection::open(&newer)
            .unwrap()
            .pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .unwrap();
        fs::write(path("text.db"), b"old database bytes").unwrap();
        fs::write(path("empty.db"), b"").unwrap();

        for name in [
            "foreign.db",
            "lookalike.db",
            "newer.db",
            "text.db",
            "empty.db",
        ] {
            assert!(
                !is_apps_database(&path(name), dir.path()).unwrap(),
                "{name}"
            );
        }
    }

    #[test]
    fn a_database_that_cannot_be_read_is_an_error_not_a_verdict() {
        let dir = tempdir().unwrap();
        assert!(is_apps_database(&dir.path().join("missing.db"), dir.path()).is_err());
    }

    #[test]
    fn checking_a_database_never_changes_it() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("a.db");
        open(&file).unwrap();
        let before = fs::read(&file).unwrap();

        assert!(is_apps_database(&file, dir.path()).unwrap());

        assert_eq!(fs::read(&file).unwrap(), before);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    /// A current-schema database with one result, left with a hot journal.
    fn hot_database(dir: &Path) -> std::path::PathBuf {
        let file = dir.join("hot.db");
        let conn = open(&file).unwrap();
        insert_result(&conn, &new_result("glides", 61.5), T0).unwrap();
        drop(conn);
        leave_hot_journal(&file);
        file
    }

    fn folder_bytes(dir: &Path) -> Vec<(std::ffi::OsString, Vec<u8>)> {
        let mut files: Vec<_> = fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| (e.file_name(), fs::read(e.path()).unwrap()))
            .collect();
        files.sort();
        files
    }

    fn rows(source: &Connection) -> i64 {
        source
            .query_row("SELECT COUNT(*) FROM exercise_result", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn a_database_with_a_hot_journal_is_read_as_it_was_before_the_crash() {
        let dir = tempdir().unwrap();
        let scratch = tempdir().unwrap();
        let file = hot_database(dir.path());
        let before = folder_bytes(dir.path());

        let source = open_for_reading(&file, scratch.path()).unwrap();

        assert_eq!(rows(&source), 1, "the uncommitted rows are not there");
        assert_eq!(
            folder_bytes(dir.path()),
            before,
            "the original folder is not written"
        );
        drop(source);
        assert_eq!(fs::read_dir(scratch.path()).unwrap().count(), 0);
    }

    #[test]
    fn a_hot_database_is_still_recognised_as_ours() {
        let dir = tempdir().unwrap();
        assert!(is_apps_database(&hot_database(dir.path()), dir.path()).unwrap());
    }

    #[test]
    fn a_healthy_database_is_read_in_place_without_a_copy() {
        let dir = tempdir().unwrap();
        let scratch = tempdir().unwrap();
        let file = dir.path().join("fine.db");
        insert_result(&open(&file).unwrap(), &new_result("glides", 61.5), T0).unwrap();

        let source = open_for_reading(&file, scratch.path()).unwrap();

        assert_eq!(rows(&source), 1);
        assert_eq!(fs::read_dir(scratch.path()).unwrap().count(), 0);
    }

    #[test]
    fn a_missing_database_or_a_journal_without_one_is_an_error_and_leaves_no_copy() {
        let dir = tempdir().unwrap();
        let scratch = tempdir().unwrap();
        let file = dir.path().join("gone.db");
        assert!(open_for_reading(&file, scratch.path()).is_err());
        fs::write(side_file(&file, "-journal"), b"not empty").unwrap();

        assert!(open_for_reading(&file, scratch.path()).is_err());

        assert_eq!(fs::read_dir(scratch.path()).unwrap().count(), 0);
    }

    #[cfg(unix)]
    #[test]
    fn the_scratch_copy_is_removed_when_the_journal_cannot_be_copied() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let scratch = tempdir().unwrap();
        let file = hot_database(dir.path());
        let journal = side_file(&file, "-journal");
        fs::set_permissions(&journal, fs::Permissions::from_mode(0o000)).unwrap();
        if fs::File::open(&journal).is_ok() {
            return; // this process ignores permissions
        }

        let outcome = open_for_reading(&file, scratch.path());

        assert!(outcome.is_err());
        assert_eq!(fs::read_dir(scratch.path()).unwrap().count(), 0);
    }

    #[test]
    fn the_scratch_copy_lives_inside_the_given_folder_and_is_private() {
        let dir = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        let file = hot_database(dir.path());

        let source = open_for_reading(&file, app_data.path()).unwrap();

        let scratches: Vec<_> = fs::read_dir(app_data.path())
            .unwrap()
            .map(|e| e.unwrap())
            .collect();
        assert_eq!(scratches.len(), 1);
        assert!(
            scratches[0]
                .file_name()
                .to_string_lossy()
                .starts_with(".read-scratch-"),
            "named so the sweep knows it"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = scratches[0].metadata().unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o700, "nobody else can read it");
        }
        drop(source);
        assert_eq!(fs::read_dir(app_data.path()).unwrap().count(), 0);
    }

    #[test]
    fn a_scratch_folder_is_never_a_name_that_already_exists() {
        let dir = tempdir().unwrap();
        let app_data = tempdir().unwrap();
        let file = hot_database(dir.path());
        // Every name a stale or planted folder could have taken.
        for n in 0..3 {
            let taken = app_data.path().join(format!(".read-scratch-{n}"));
            fs::create_dir(&taken).unwrap();
            fs::write(taken.join("planted"), b"mine").unwrap();
        }

        let source = open_for_reading(&file, app_data.path()).unwrap();

        assert_eq!(rows(&source), 1);
        for n in 0..3 {
            let planted = app_data.path().join(format!(".read-scratch-{n}/planted"));
            assert_eq!(fs::read(planted).unwrap(), b"mine");
        }
    }

    #[test]
    fn the_sweep_removes_stale_scratch_folders_and_nothing_else() {
        let base = tempdir().unwrap();
        let outside = tempdir().unwrap();
        fs::write(outside.path().join("keep.txt"), b"x").unwrap();
        for n in ["1", "2-old"] {
            let stale = base.path().join(format!(".read-scratch-{n}"));
            fs::create_dir_all(stale.join("deeper")).unwrap();
            fs::write(stale.join("voice_trainer.db"), b"a copy").unwrap();
        }
        fs::write(base.path().join(".read-scratch-3"), b"a file").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), base.path().join(".read-scratch-4")).unwrap();
        fs::write(base.path().join("lilthop.db"), b"data").unwrap();
        fs::create_dir(base.path().join("recordings")).unwrap();

        sweep_scratch(base.path());

        let mut left: Vec<_> = fs::read_dir(base.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(left, vec!["lilthop.db", "recordings"]);
        assert!(
            outside.path().join("keep.txt").exists(),
            "a link is not followed"
        );
    }

    #[test]
    fn sweeping_a_folder_that_is_missing_does_nothing() {
        let base = tempdir().unwrap();
        sweep_scratch(&base.path().join("not-there"));
    }

    #[test]
    fn a_snapshot_of_a_hot_database_has_the_committed_rows_and_passes_the_check() {
        let dir = tempdir().unwrap();
        let scratch = tempdir().unwrap();
        let file = hot_database(dir.path());
        let copy = scratch.path().join("copy.db");

        snapshot_database(&file, &copy, scratch.path()).unwrap();

        verify_database(&file, &copy, scratch.path()).unwrap();
        assert_eq!(rows(&Connection::open(&copy).unwrap()), 1);
    }

    #[test]
    fn fresh_database_gets_the_current_version() {
        let conn = fresh();
        let v: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v, SCHEMA_VERSION);
        assert_eq!(get_profile(&conn).unwrap(), None);
        assert!(list_results(&conn).unwrap().is_empty());
    }

    #[test]
    fn migrating_twice_changes_nothing() {
        let conn = Connection::open_in_memory().unwrap();
        old_db(&conn);
        migrate(&conn).unwrap();
        let before = list_results(&conn).unwrap();
        migrate(&conn).unwrap();
        assert_eq!(list_results(&conn).unwrap(), before);
    }

    #[test]
    fn old_database_keeps_its_results_and_marks_them_version_zero() {
        let conn = Connection::open_in_memory().unwrap();
        old_db(&conn);
        migrate(&conn).unwrap();

        let rows = list_results(&conn).unwrap();

        assert_eq!(rows.len(), 2, "the duplicated pair collapses to one");
        assert_eq!(rows[0].result.exercise_id, "glides");
        assert_eq!(rows[0].created_at, 1_730_000_500);
        assert_eq!(rows[0].result.score, Some(55.0));
        assert_eq!(rows[0].result.scoring_version, 0);
        assert_eq!(rows[0].result.voiced_s, 0.0);
        assert_eq!(rows[1].result.exercise_id, "sustained_tone");
        assert_eq!(rows[1].id, 1, "the first copy is the one kept");
    }

    #[test]
    fn old_profile_is_engine_one_with_defaults_for_new_columns() {
        let conn = Connection::open_in_memory().unwrap();
        old_db(&conn);
        migrate(&conn).unwrap();

        let p = get_profile(&conn).unwrap().unwrap();

        assert_eq!(p.baseline_hz, 130.0);
        assert_eq!((p.target_min_hz, p.target_max_hz), (165.0, 255.0));
        assert_eq!(p.pitch_engine, 1);
        assert_eq!(p.baseline_centroid, 2000.0);
        assert_eq!(p.baseline_rms, 0.0);
        assert!(p.goals.is_empty());
        assert_eq!((p.language.as_str(), p.theme.as_str()), ("en", "dark"));
        assert!(!p.onboarded);
    }

    #[test]
    fn old_meta_keys_become_file_names() {
        let conn = Connection::open_in_memory().unwrap();
        old_db(&conn);
        migrate(&conn).unwrap();

        let first = get_meta(&conn, "rec_1.wav").unwrap().unwrap();
        assert_eq!(
            (first.note.as_str(), first.tags.as_str()),
            ("first take", "warmup")
        );
        assert!(get_meta(&conn, "rec_2.wav").unwrap().is_some());
        assert_eq!(list_meta(&conn).unwrap().len(), 2);
    }

    #[test]
    fn newer_database_is_refused_and_left_alone() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .unwrap();
        let err = migrate(&conn).unwrap_err();
        assert_eq!(err.kind(), ErrorKind::Database);
        let tables: i64 = conn
            .query_row("SELECT COUNT(*) FROM sqlite_master", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tables, 0);
    }

    #[test]
    fn open_creates_a_file_database_that_reopens() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("t.db");
        {
            let conn = open(&path).unwrap();
            set_profile(&conn, &profile()).unwrap();
        }
        let conn = open(&path).unwrap();
        assert_eq!(get_profile(&conn).unwrap(), Some(profile()));
    }

    #[test]
    fn profile_round_trips_and_updates_in_place() {
        let conn = fresh();
        set_profile(&conn, &profile()).unwrap();
        let mut changed = profile();
        changed.baseline_hz = 180.0;
        changed.baseline_centroid = 2600.0;
        changed.goals = vec![];
        set_profile(&conn, &changed).unwrap();
        assert_eq!(get_profile(&conn).unwrap(), Some(changed));
    }

    #[test]
    fn all_results_come_back_newest_first_with_no_cap() {
        let conn = fresh();
        for i in 0..250 {
            insert_result(
                &conn,
                &new_result("glides", f64::from(i % 100)),
                T0 + i64::from(i),
            )
            .unwrap();
        }
        let rows = list_results(&conn).unwrap();
        assert_eq!(rows.len(), 250);
        assert!(rows.windows(2).all(|w| w[0].created_at >= w[1].created_at));
    }

    #[test]
    fn same_exercise_time_and_score_is_stored_once() {
        let conn = fresh();
        let first = insert_result(&conn, &new_result("glides", 70.0), T0).unwrap();
        let again = insert_result(&conn, &new_result("glides", 70.0), T0).unwrap();
        assert_eq!(first, again);
        assert_eq!(list_results(&conn).unwrap().len(), 1);
        insert_result(&conn, &new_result("glides", 71.0), T0).unwrap();
        assert_eq!(list_results(&conn).unwrap().len(), 2);
    }

    #[test]
    fn backup_rows_report_whether_they_were_new() {
        let conn = fresh();
        let row = BackupResult {
            created_at: T0,
            result: new_result("glides", 70.0),
        };
        assert!(insert_backup_result(&conn, &row).unwrap());
        assert!(!insert_backup_result(&conn, &row).unwrap());
    }

    #[test]
    fn meta_set_get_delete() {
        let conn = fresh();
        let meta = RecordingMeta {
            name: "a.wav".into(),
            note: "n".into(),
            tags: "t".into(),
        };
        set_meta(&conn, &meta).unwrap();
        let edited = RecordingMeta {
            note: "n2".into(),
            ..meta.clone()
        };
        set_meta(&conn, &edited).unwrap();
        assert_eq!(get_meta(&conn, "a.wav").unwrap(), Some(edited));
        delete_meta(&conn, "a.wav").unwrap();
        assert_eq!(get_meta(&conn, "a.wav").unwrap(), None);
    }

    #[test]
    fn insert_if_absent_never_overwrites_a_note() {
        let conn = fresh();
        let mine = RecordingMeta {
            name: "a.wav".into(),
            note: "mine".into(),
            tags: "".into(),
        };
        set_meta(&conn, &mine).unwrap();
        let theirs = RecordingMeta {
            note: "theirs".into(),
            ..mine.clone()
        };
        assert!(!insert_meta_if_absent(&conn, &theirs).unwrap());
        assert_eq!(get_meta(&conn, "a.wav").unwrap(), Some(mine));
    }

    #[test]
    fn delete_all_empties_every_table() {
        let conn = fresh();
        set_profile(&conn, &profile()).unwrap();
        insert_result(&conn, &new_result("glides", 70.0), T0).unwrap();
        set_meta(
            &conn,
            &RecordingMeta {
                name: "a.wav".into(),
                note: "n".into(),
                tags: "".into(),
            },
        )
        .unwrap();
        delete_all(&conn).unwrap();
        assert_eq!(get_profile(&conn).unwrap(), None);
        assert!(list_results(&conn).unwrap().is_empty());
        assert!(list_meta(&conn).unwrap().is_empty());
    }

    /// The schema as version 1 left it: score NOT NULL, key on the raw score.
    fn v1_db(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE exercise_result (
                id INTEGER PRIMARY KEY AUTOINCREMENT, exercise_id TEXT NOT NULL,
                score REAL NOT NULL, pitch_mean REAL NOT NULL, pitch_sd REAL NOT NULL,
                duration_s REAL NOT NULL, created_at INTEGER NOT NULL,
                voiced_s REAL NOT NULL DEFAULT 0, scoring_version INTEGER NOT NULL DEFAULT 0);
             CREATE UNIQUE INDEX ux_result_key ON exercise_result (exercise_id, created_at, score);
             CREATE TABLE profile (
                id INTEGER PRIMARY KEY, target_min_hz REAL NOT NULL, target_max_hz REAL NOT NULL,
                baseline_hz REAL NOT NULL, goals TEXT NOT NULL DEFAULT '[]',
                language TEXT NOT NULL DEFAULT 'en', theme TEXT NOT NULL DEFAULT 'dark',
                onboarded INTEGER NOT NULL DEFAULT 0, baseline_centroid REAL NOT NULL DEFAULT 2000,
                baseline_rms REAL NOT NULL DEFAULT 0, pitch_engine INTEGER NOT NULL DEFAULT 1);
             CREATE TABLE recording_meta (
                name TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '');
             INSERT INTO exercise_result VALUES (5,'glides',0,170,4,60,1730000000,40,2);
             INSERT INTO exercise_result VALUES (9,'glides',72.5,175,3,60,1730000900,41,2);
             INSERT INTO recording_meta VALUES ('rec_1.wav','keep','t');
             PRAGMA user_version = 1;",
        )
        .unwrap();
    }

    #[test]
    fn version_one_database_keeps_every_row_and_learns_to_hold_no_score() {
        let conn = Connection::open_in_memory().unwrap();
        v1_db(&conn);
        migrate(&conn).unwrap();

        let rows = list_results(&conn).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!((rows[0].id, rows[0].result.score), (9, Some(72.5)));
        assert_eq!((rows[1].id, rows[1].result.score), (5, Some(0.0)));
        assert_eq!(rows[1].result.voiced_s, 40.0);
        assert_eq!(rows[1].result.scoring_version, 2);
        assert_eq!(list_meta(&conn).unwrap().len(), 1);
        let v: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(v, SCHEMA_VERSION);

        insert_result(&conn, &unscored_result("resonance"), T0 + 5000).unwrap();
        assert_eq!(list_results(&conn).unwrap()[0].result.score, None);
    }

    #[test]
    fn migrating_a_version_one_database_twice_changes_nothing() {
        let conn = Connection::open_in_memory().unwrap();
        v1_db(&conn);
        migrate(&conn).unwrap();
        let before = list_results(&conn).unwrap();
        migrate(&conn).unwrap();
        assert_eq!(list_results(&conn).unwrap(), before);
    }

    #[test]
    fn an_unscored_session_is_stored_once_per_exercise_and_time() {
        let conn = fresh();
        let first = insert_result(&conn, &unscored_result("resonance"), T0).unwrap();
        let again = insert_result(&conn, &unscored_result("resonance"), T0).unwrap();
        assert_eq!(first, again);
        insert_result(&conn, &unscored_result("resonance"), T0 + 60).unwrap();
        assert_eq!(list_results(&conn).unwrap().len(), 2);
        let row = BackupResult {
            created_at: T0 + 60,
            result: unscored_result("resonance"),
        };
        assert!(!insert_backup_result(&conn, &row).unwrap());
    }

    #[test]
    fn no_score_and_a_score_of_zero_are_different_sessions() {
        let conn = fresh();
        insert_result(&conn, &new_result("resonance", 0.0), T0).unwrap();
        insert_result(&conn, &unscored_result("resonance"), T0).unwrap();
        let scores: Vec<_> = list_results(&conn)
            .unwrap()
            .iter()
            .map(|r| r.result.score)
            .collect();
        assert_eq!(scores.len(), 2);
        assert!(scores.contains(&None) && scores.contains(&Some(0.0)));
    }
}
