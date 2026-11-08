//! Backup and restore. One format: a zip holding `data.json` and
//! `recordings/<name>.wav`. A backup file is untrusted input.

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{self, Read, Seek, Write};
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive};

use crate::error::{AppError, AppResult};
use crate::paths::{recordings_dir, validate_recording_name, write_atomic};
use crate::storage::model::{BackupResult, Profile, RecordingMeta, RestoreSummary};
use crate::storage::{db, legacy};

pub const FORMAT_VERSION: i64 = 2;
const DATA_ENTRY: &str = "data.json";
/// The first version's zip called its data file this.
const OLD_DATA_ENTRY: &str = "backup.json";
const RECORDINGS_PREFIX: &str = "recordings/";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupData {
    pub version: i64,
    pub profile: Option<Profile>,
    pub results: Vec<BackupResult>,
    pub recording_meta: Vec<RecordingMeta>,
}

/// Caps on what a backup file may ask us to read.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub max_entries: usize,
    pub max_data_bytes: u64,
    pub max_wav_bytes: u64,
    pub max_total_bytes: u64,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_entries: 20_000,
            max_data_bytes: 64 * 1024 * 1024,
            max_wav_bytes: 1024 * 1024 * 1024,
            max_total_bytes: 4 * 1024 * 1024 * 1024,
        }
    }
}

/// Write a backup zip to `dest`, via a temp file and a rename. `dest` must be
/// outside the app's data folder: a backup written next to the recordings
/// could replace one of them.
pub fn create_to(base: &Path, conn: &Connection, dest: &Path) -> AppResult<()> {
    refuse_inside_data_folder(base, dest)?;
    let json = serde_json::to_vec_pretty(&collect(conn)?)?;
    let names = recording_files(base)?;
    write_atomic(dest, |file| write_zip(file, base, &json, &names))
}

fn refuse_inside_data_folder(base: &Path, dest: &Path) -> AppResult<()> {
    let parent = dest
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let parent = fs::canonicalize(parent)?;
    if parent.starts_with(fs::canonicalize(base)?) {
        return Err(AppError::invalid(
            "save the backup outside the app's data folder",
        ));
    }
    Ok(())
}

fn collect(conn: &Connection) -> AppResult<BackupData> {
    let mut results: Vec<BackupResult> = db::list_results(conn)?
        .into_iter()
        .map(|r| BackupResult {
            created_at: r.created_at,
            result: r.result,
        })
        .collect();
    results.reverse();
    Ok(BackupData {
        version: FORMAT_VERSION,
        profile: db::get_profile(conn)?,
        results,
        recording_meta: db::list_meta(conn)?,
    })
}

fn recording_files(base: &Path) -> AppResult<Vec<String>> {
    let mut names: Vec<String> = fs::read_dir(recordings_dir(base))?
        .flatten()
        .filter(|e| fs::symlink_metadata(e.path()).is_ok_and(|m| m.is_file()))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| validate_recording_name(n).is_ok())
        .collect();
    names.sort();
    Ok(names)
}

fn write_zip(file: &mut File, base: &Path, json: &[u8], names: &[String]) -> AppResult<()> {
    let mut zip = zip::ZipWriter::new(file);
    let text = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    zip.start_file(DATA_ENTRY, text)?;
    zip.write_all(json)?;
    let audio = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .large_file(true);
    for name in names {
        zip.start_file(format!("{RECORDINGS_PREFIX}{name}"), audio)?;
        let mut wav = File::open(recordings_dir(base).join(name))?;
        io::copy(&mut wav, &mut zip)?;
    }
    zip.finish()?;
    Ok(())
}

pub fn restore_from(
    base: &Path,
    conn: &Connection,
    src: &Path,
    now: i64,
) -> AppResult<RestoreSummary> {
    restore_with(base, conn, src, now, &Limits::default())
}

/// Restore a backup file. The whole file is checked before anything is
/// written; the database changes in one transaction; recordings are moved into
/// place last. Notes and recordings you already have are kept, the profile in
/// the backup replaces yours.
pub fn restore_with(
    base: &Path,
    conn: &Connection,
    src: &Path,
    now: i64,
    limits: &Limits,
) -> AppResult<RestoreSummary> {
    let mut file = File::open(src)?;
    if is_zip(&mut file)? {
        let mut archive = zip::ZipArchive::new(file)?;
        let wavs = check_entries(&mut archive, limits)?;
        let mut data = read_data(&mut archive, limits)?;
        validate(&data, now)?;
        fs::create_dir_all(recordings_dir(base))?;
        let existing = recording_files(base)?;
        align_note_names(&mut data, &existing, &wavs);
        let staged = stage_wavs(&mut archive, &wavs, &existing, base, limits)?;
        let (results, recordings) = commit_with_files(conn, &data, staged)?;
        Ok(summary(&data, results, recordings))
    } else {
        let mut data = parse_data(&read_bounded(&mut file, limits.max_data_bytes)?)?;
        validate(&data, now)?;
        fs::create_dir_all(recordings_dir(base))?;
        align_note_names(&mut data, &recording_files(base)?, &[]);
        let (results, _) = commit_with_files(conn, &data, Staged::default())?;
        Ok(summary(&data, results, 0))
    }
}

fn summary(data: &BackupData, results: usize, recordings: usize) -> RestoreSummary {
    RestoreSummary {
        results,
        recordings,
        profile: data.profile.is_some(),
    }
}

fn is_zip(file: &mut File) -> AppResult<bool> {
    let mut magic = [0u8; 4];
    let read = file.read(&mut magic)?;
    file.rewind()?;
    Ok(read == 4 && magic == *b"PK\x03\x04")
}

/// Read at most `cap` bytes; a longer source is an error, whatever its header
/// claimed.
fn read_bounded(source: &mut impl Read, cap: u64) -> AppResult<Vec<u8>> {
    let mut bytes = Vec::new();
    source.take(cap + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > cap {
        return Err(AppError::invalid_backup(
            "an entry in the backup is too large",
        ));
    }
    Ok(bytes)
}

/// Check every entry name and declared size. Returns the recording names.
fn check_entries(archive: &mut ZipArchive<File>, limits: &Limits) -> AppResult<Vec<String>> {
    if archive.len() > limits.max_entries {
        return Err(AppError::invalid_backup("the backup has too many files"));
    }
    let (mut data_files, mut wavs, mut total) = (0, Vec::<String>::new(), 0u64);
    for index in 0..archive.len() {
        let (name, size) = entry_name_and_size(archive, index)?;
        total = total.saturating_add(size);
        match classify(&name)? {
            Entry::Data => {
                data_files += 1;
                check_size(size, limits.max_data_bytes)?;
            }
            Entry::Wav(wav) => {
                // Windows and macOS see `A.wav` and `a.wav` as one file.
                if wavs.iter().any(|w| w.eq_ignore_ascii_case(&wav)) {
                    return Err(AppError::invalid_backup("the backup lists a file twice"));
                }
                check_size(size, limits.max_wav_bytes)?;
                wavs.push(wav);
            }
            Entry::Folder => {}
        }
    }
    check_size(total, limits.max_total_bytes)?;
    if data_files != 1 {
        return Err(AppError::invalid_backup(
            "the backup needs exactly one data.json",
        ));
    }
    Ok(wavs)
}

/// Name and declared size, read without unpacking the entry.
fn entry_name_and_size(archive: &mut ZipArchive<File>, index: usize) -> AppResult<(String, u64)> {
    let entry = archive.by_index_raw(index)?;
    Ok((entry.name().to_owned(), entry.size()))
}

fn check_size(size: u64, cap: u64) -> AppResult<()> {
    if size > cap {
        return Err(AppError::invalid_backup("the backup is too large"));
    }
    Ok(())
}

enum Entry {
    Data,
    Wav(String),
    Folder,
}

/// Only `data.json` (or the first version's `backup.json`) and
/// `recordings/<bare>.wav` are accepted. Anything else is refused, which is
/// what stops a name like `../x` from ever reaching the file system.
fn classify(name: &str) -> AppResult<Entry> {
    if name == DATA_ENTRY || name == OLD_DATA_ENTRY {
        return Ok(Entry::Data);
    }
    if name == RECORDINGS_PREFIX {
        return Ok(Entry::Folder);
    }
    match name.strip_prefix(RECORDINGS_PREFIX) {
        Some(wav) if validate_recording_name(wav).is_ok() => Ok(Entry::Wav(wav.to_owned())),
        _ => Err(AppError::invalid_backup(format!(
            "the backup holds a file that does not belong in it: {name:?}"
        ))),
    }
}

fn read_data(archive: &mut ZipArchive<File>, limits: &Limits) -> AppResult<BackupData> {
    let index = (0..archive.len())
        .find(|&i| {
            archive
                .name_for_index(i)
                .is_some_and(|n| n == DATA_ENTRY || n == OLD_DATA_ENTRY)
        })
        .ok_or_else(|| AppError::invalid_backup("the backup has no data.json"))?;
    let mut entry = archive.by_index(index)?;
    parse_data(&read_bounded(&mut entry, limits.max_data_bytes)?)
}

fn parse_data(bytes: &[u8]) -> AppResult<BackupData> {
    let value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|e| AppError::invalid_backup(format!("this is not a backup file ({e})")))?;
    match value.get("version").and_then(serde_json::Value::as_i64) {
        Some(FORMAT_VERSION) => Ok(serde_json::from_value(value)?),
        Some(1) => legacy::convert(value),
        _ => Err(AppError::invalid_backup("unknown backup version")),
    }
}

fn validate(data: &BackupData, now: i64) -> AppResult<()> {
    if let Some(profile) = &data.profile {
        profile.validate().map_err(as_backup_error)?;
    }
    for row in &data.results {
        row.validate(now).map_err(as_backup_error)?;
    }
    data.recording_meta
        .iter()
        .try_for_each(|m| m.validate().map_err(as_backup_error))
}

fn as_backup_error(e: AppError) -> AppError {
    AppError::invalid_backup(format!("the backup holds bad data: {}", e.message()))
}

/// Notes follow the file they belong to, however its name is cased: a note
/// for `REC_1.wav` goes to the `rec_1.wav` you already have (or the one this
/// backup brings). If two notes end up on one name, the first is kept.
fn align_note_names(data: &mut BackupData, existing: &[String], incoming: &[String]) {
    for meta in &mut data.recording_meta {
        let known = existing.iter().chain(incoming);
        if let Some(name) = known
            .into_iter()
            .find(|n| n.eq_ignore_ascii_case(&meta.name))
        {
            meta.name.clone_from(name);
        }
    }
    let mut seen = HashSet::new();
    data.recording_meta
        .retain(|m| seen.insert(m.name.to_ascii_lowercase()));
}

/// Database changes and recordings go in together: the transaction stays open
/// while the files are moved into place, and is committed last. If anything
/// fails the transaction rolls back and the files placed so far are removed.
/// Returns (results added, recordings added).
fn commit_with_files(
    conn: &Connection,
    data: &BackupData,
    staged: Staged,
) -> AppResult<(usize, usize)> {
    let tx = conn.unchecked_transaction()?;
    let added = apply(&tx, data)?;
    let placed = staged.place()?;
    tx.commit()?;
    Ok((added, placed.keep()))
}

/// One transaction body: profile, results, notes. Returns how many results were new.
fn apply(conn: &Connection, data: &BackupData) -> AppResult<usize> {
    if let Some(profile) = &data.profile {
        db::set_profile(conn, profile)?;
    }
    let mut added = 0;
    for row in &data.results {
        added += usize::from(db::insert_backup_result(conn, row)?);
    }
    for meta in &data.recording_meta {
        db::insert_meta_if_absent(conn, meta)?;
    }
    Ok(added)
}

/// Recordings written next to their final place, not yet visible by name.
/// Dropping this removes whatever was not placed.
#[derive(Default)]
struct Staged {
    files: Vec<(PathBuf, PathBuf)>,
}

impl Staged {
    /// Move every file to its final name. On failure the files already moved
    /// are removed again (they did not exist before) and the error is returned.
    fn place(&self) -> AppResult<Placed> {
        let mut placed = Placed::default();
        for (temp, target) in &self.files {
            fs::rename(temp, target)?;
            placed.files.push(target.clone());
        }
        Ok(placed)
    }
}

impl Drop for Staged {
    fn drop(&mut self) {
        for (temp, _) in &self.files {
            let _ = fs::remove_file(temp);
        }
    }
}

/// Files moved into place but not yet part of a committed restore. Dropped
/// without `keep`, they are removed.
#[derive(Default)]
struct Placed {
    files: Vec<PathBuf>,
}

impl Placed {
    fn keep(mut self) -> usize {
        std::mem::take(&mut self.files).len()
    }
}

impl Drop for Placed {
    fn drop(&mut self) {
        for file in &self.files {
            let _ = fs::remove_file(file);
        }
    }
}

fn stage_wavs(
    archive: &mut ZipArchive<File>,
    wavs: &[String],
    existing: &[String],
    base: &Path,
    limits: &Limits,
) -> AppResult<Staged> {
    let dir = recordings_dir(base);
    let mut staged = Staged::default();
    let mut budget = limits.max_total_bytes;
    for wav in wavs {
        if existing.iter().any(|e| e.eq_ignore_ascii_case(wav)) {
            continue;
        }
        let temp = dir.join(format!(".restore-{wav}.partial"));
        staged.files.push((temp.clone(), dir.join(wav)));
        let mut entry = archive.by_name(&format!("{RECORDINGS_PREFIX}{wav}"))?;
        // What an entry really holds counts, not what its header says.
        let written = write_wav_entry(&mut entry, &temp, limits.max_wav_bytes.min(budget))?;
        budget -= written;
    }
    Ok(staged)
}

/// Copy a recording to `temp`, at most `cap` bytes. Returns the bytes written.
fn write_wav_entry(entry: &mut impl Read, temp: &Path, cap: u64) -> AppResult<u64> {
    let too_large = || AppError::invalid_backup("a recording in the backup is too large");
    let mut out = File::create(temp)?;
    let mut limited = entry.take(cap.saturating_add(1));
    let mut header = [0u8; 12];
    limited
        .read_exact(&mut header)
        .map_err(|_| AppError::invalid_backup("a recording in the backup is cut short"))?;
    if &header[..4] != b"RIFF" || &header[8..] != b"WAVE" {
        return Err(AppError::invalid_backup(
            "a recording in the backup is not a WAV file",
        ));
    }
    out.write_all(&header)?;
    let written = 12 + io::copy(&mut limited, &mut out)?;
    if written > cap {
        return Err(too_large());
    }
    out.sync_all()?;
    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorKind;
    use crate::paths::{db_path, recordings_dir};
    use crate::storage::model::fixtures::{new_result, profile, unscored_result};
    use crate::storage::testutil::write_wav;
    use crate::storage::{db, recordings};
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;
    use tempfile::{TempDir, tempdir};

    const NOW: i64 = 1_740_000_000;
    const T0: i64 = 1_730_000_000;

    /// A data folder with a database, as the app would have it.
    struct Env {
        _dir: TempDir,
        base: PathBuf,
        conn: Connection,
    }

    fn env() -> Env {
        let dir = tempdir().unwrap();
        let base = dir.path().join("data");
        fs::create_dir_all(recordings_dir(&base)).unwrap();
        let conn = db::open(&db_path(&base)).unwrap();
        Env {
            _dir: dir,
            base,
            conn,
        }
    }

    fn filled() -> Env {
        let e = env();
        db::set_profile(&e.conn, &profile()).unwrap();
        db::insert_result(&e.conn, &new_result("glides", 70.0), T0).unwrap();
        db::insert_result(&e.conn, &new_result("sustained_tone", 82.5), T0 + 600).unwrap();
        db::insert_result(&e.conn, &unscored_result("resonance"), T0 + 900).unwrap();
        write_wav(&recordings_dir(&e.base).join("rec_1.wav"), 800);
        write_wav(&recordings_dir(&e.base).join("rec_2.wav"), 1600);
        recordings::set_meta(&e.base, &e.conn, "rec_1.wav", "first take", "am").unwrap();
        e
    }

    fn out_file(name: &str) -> (TempDir, PathBuf) {
        let dir = tempdir().unwrap();
        let path = dir.path().join(name);
        (dir, path)
    }

    fn zip_with(path: &Path, entries: &[(&str, &[u8])]) {
        let mut zip = zip::ZipWriter::new(fs::File::create(path).unwrap());
        let opts = zip::write::SimpleFileOptions::default();
        for (name, bytes) in entries {
            zip.start_file(*name, opts).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    fn wav_bytes() -> Vec<u8> {
        let (_d, p) = out_file("w.wav");
        write_wav(&p, 100);
        fs::read(p).unwrap()
    }

    fn data_json(results: serde_json::Value) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "version": 2, "profile": null, "results": results, "recordingMeta": []
        }))
        .unwrap()
    }

    fn good_row() -> serde_json::Value {
        serde_json::json!({
            "createdAt": T0, "exerciseId": "glides", "score": 70.0, "pitchMean": 180.0,
            "pitchSd": 4.0, "durationS": 60.0, "voicedS": 40.0, "scoringVersion": 2
        })
    }

    fn row_with(field: &str, value: serde_json::Value) -> serde_json::Value {
        let mut row = good_row();
        row[field] = value;
        row
    }

    fn row_without(field: &str) -> serde_json::Value {
        let mut row = good_row();
        row.as_object_mut().unwrap().remove(field);
        row
    }

    /// Everything that restore could have changed.
    fn snapshot(e: &Env) -> (Option<Profile>, usize, usize, Vec<String>) {
        let files = fs::read_dir(recordings_dir(&e.base))
            .unwrap()
            .flatten()
            .map(|f| f.file_name().to_string_lossy().into_owned())
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        (
            db::get_profile(&e.conn).unwrap(),
            db::list_results(&e.conn).unwrap().len(),
            db::list_meta(&e.conn).unwrap().len(),
            files,
        )
    }

    fn assert_rejected_and_unchanged(e: &Env, file: &Path) {
        let before = snapshot(e);
        let err = restore_from(&e.base, &e.conn, file, NOW).unwrap_err();
        assert_eq!(err.kind(), ErrorKind::InvalidBackup, "{err}");
        assert_eq!(snapshot(e), before);
    }

    #[test]
    fn zip_round_trip_restores_profile_results_notes_and_recordings() {
        let src = filled();
        let (_o, zip_path) = out_file("backup.zip");
        create_to(&src.base, &src.conn, &zip_path).unwrap();

        let dst = env();
        let summary = restore_from(&dst.base, &dst.conn, &zip_path, NOW).unwrap();

        assert_eq!(
            summary,
            RestoreSummary {
                results: 3,
                recordings: 2,
                profile: true
            }
        );
        assert_eq!(db::get_profile(&dst.conn).unwrap(), Some(profile()));
        let strip = |e: &Env| {
            db::list_results(&e.conn)
                .unwrap()
                .into_iter()
                .map(|r| (r.created_at, r.result))
                .collect::<Vec<_>>()
        };
        assert_eq!(strip(&dst), strip(&src));
        assert_eq!(
            db::list_meta(&dst.conn).unwrap(),
            db::list_meta(&src.conn).unwrap()
        );
        for name in ["rec_1.wav", "rec_2.wav"] {
            let a = fs::read(recordings_dir(&src.base).join(name)).unwrap();
            let b = fs::read(recordings_dir(&dst.base).join(name)).unwrap();
            assert_eq!(a, b, "{name}");
        }
    }

    #[test]
    fn restoring_a_profile_replaces_the_baseline() {
        let src = filled();
        let (_o, zip_path) = out_file("backup.zip");
        create_to(&src.base, &src.conn, &zip_path).unwrap();
        let dst = env();
        let mut stale = profile();
        stale.baseline_hz = 1.0;
        db::set_profile(&dst.conn, &stale).unwrap();

        restore_from(&dst.base, &dst.conn, &zip_path, NOW).unwrap();

        assert_eq!(
            db::get_profile(&dst.conn).unwrap().unwrap().baseline_hz,
            130.0
        );
    }

    #[test]
    fn restoring_twice_keeps_the_count() {
        let src = filled();
        let (_o, zip_path) = out_file("backup.zip");
        create_to(&src.base, &src.conn, &zip_path).unwrap();
        let dst = env();
        restore_from(&dst.base, &dst.conn, &zip_path, NOW).unwrap();

        let again = restore_from(&dst.base, &dst.conn, &zip_path, NOW).unwrap();

        assert_eq!(
            again,
            RestoreSummary {
                results: 0,
                recordings: 0,
                profile: true
            }
        );
        assert_eq!(db::list_results(&dst.conn).unwrap().len(), 3);
        assert_eq!(db::list_meta(&dst.conn).unwrap().len(), 1);
    }

    #[test]
    fn restore_keeps_a_note_and_a_recording_you_already_have() {
        let src = filled();
        let (_o, zip_path) = out_file("backup.zip");
        create_to(&src.base, &src.conn, &zip_path).unwrap();
        let dst = env();
        write_wav(&recordings_dir(&dst.base).join("rec_1.wav"), 50);
        let mine = fs::read(recordings_dir(&dst.base).join("rec_1.wav")).unwrap();
        recordings::set_meta(&dst.base, &dst.conn, "rec_1.wav", "newer note", "").unwrap();

        let summary = restore_from(&dst.base, &dst.conn, &zip_path, NOW).unwrap();

        assert_eq!(summary.recordings, 1, "only rec_2 is new");
        assert_eq!(
            fs::read(recordings_dir(&dst.base).join("rec_1.wav")).unwrap(),
            mine
        );
        assert_eq!(
            db::get_meta(&dst.conn, "rec_1.wav").unwrap().unwrap().note,
            "newer note"
        );
    }

    #[test]
    fn backup_only_holds_data_json_and_recordings() {
        let src = filled();
        fs::write(recordings_dir(&src.base).join("junk.txt"), b"x").unwrap();
        let (_o, zip_path) = out_file("backup.zip");
        create_to(&src.base, &src.conn, &zip_path).unwrap();

        let zip = zip::ZipArchive::new(fs::File::open(&zip_path).unwrap()).unwrap();
        let mut names: Vec<_> = zip.file_names().map(str::to_owned).collect();
        names.sort();
        assert_eq!(
            names,
            ["data.json", "recordings/rec_1.wav", "recordings/rec_2.wav"]
        );
    }

    #[test]
    fn zip_slip_entries_are_rejected_and_nothing_is_written() {
        let evil = [
            "../evil.wav",
            "recordings/../evil.wav",
            "recordings/sub/a.wav",
            "/abs.wav",
            "recordings//a.wav",
            "recordings\\..\\evil.wav",
            "recordings/a.txt",
            "recordings/.wav",
            "other.json",
            "data.json/../x",
        ];
        for name in evil {
            let e = env();
            let (_o, zip_path) = out_file("evil.zip");
            zip_with(
                &zip_path,
                &[
                    ("data.json", &data_json(serde_json::json!([]))),
                    (name, &wav_bytes()),
                ],
            );

            assert_rejected_and_unchanged(&e, &zip_path);

            let outside = e.base.parent().unwrap();
            assert!(!outside.join("evil.wav").exists(), "{name}");
        }
    }

    #[test]
    fn junk_rows_are_rejected_and_nothing_changes() {
        let bad_rows = [
            row_with("score", serde_json::json!(500)),
            row_with("score", serde_json::json!(-1)),
            row_with("score", serde_json::json!("80")),
            row_without("score"),
            row_with("pitchMean", serde_json::json!(1e300)),
            row_with("createdAt", serde_json::json!(5)),
            row_with("createdAt", serde_json::json!(NOW + 10_000_000)),
            row_with("createdAt", serde_json::json!(1.5)),
            row_with("exerciseId", serde_json::json!("../x")),
            row_with("exerciseId", serde_json::json!("")),
            row_with("exerciseId", serde_json::json!("Glides")),
            row_with("scoringVersion", serde_json::json!(-3)),
            serde_json::json!({ "exerciseId": "glides" }),
            serde_json::json!("glides"),
        ];
        for bad in bad_rows {
            let e = filled();
            let (_o, zip_path) = out_file("junk.zip");
            let rows = serde_json::json!([good_row(), bad]);
            zip_with(
                &zip_path,
                &[
                    ("data.json", &data_json(rows)),
                    ("recordings/new.wav", &wav_bytes()),
                ],
            );

            assert_rejected_and_unchanged(&e, &zip_path);
        }
    }

    #[test]
    fn a_null_score_restores_as_unscored_and_twice_keeps_the_count() {
        let e = env();
        let (_o, zip_path) = out_file("unscored.zip");
        let rows = serde_json::json!([row_with("score", serde_json::json!(null))]);
        zip_with(&zip_path, &[("data.json", &data_json(rows))]);

        let first = restore_from(&e.base, &e.conn, &zip_path, NOW).unwrap();
        let again = restore_from(&e.base, &e.conn, &zip_path, NOW).unwrap();

        assert_eq!((first.results, again.results), (1, 0));
        let stored = db::list_results(&e.conn).unwrap();
        assert_eq!(stored.len(), 1);
        assert_eq!(stored[0].result.score, None);
    }

    #[test]
    fn non_finite_numbers_are_rejected() {
        let e = env();
        let (_o, zip_path) = out_file("nan.zip");
        let text = String::from_utf8(data_json(serde_json::json!([good_row()]))).unwrap();
        for bad in ["NaN", "Infinity", "1e999"] {
            let broken = text.replace("\"score\":70.0", &format!("\"score\":{bad}"));
            assert_ne!(broken, text);
            zip_with(&zip_path, &[("data.json", broken.as_bytes())]);
            assert_rejected_and_unchanged(&e, &zip_path);
        }
    }

    #[test]
    fn bad_profile_or_note_name_is_rejected() {
        let mut bad_profile = serde_json::to_value(profile()).unwrap();
        bad_profile["targetMinHz"] = serde_json::json!(900.0);
        let docs = [
            serde_json::json!({ "version": 2, "profile": bad_profile, "results": [], "recordingMeta": [] }),
            serde_json::json!({ "version": 2, "profile": null, "results": [],
                "recordingMeta": [{ "name": "../x.wav", "note": "", "tags": "" }] }),
            serde_json::json!({ "version": 3, "profile": null, "results": [], "recordingMeta": [] }),
            serde_json::json!({ "profile": null, "results": [], "recordingMeta": [] }),
        ];
        for doc in docs {
            let e = filled();
            let (_o, zip_path) = out_file("bad.zip");
            zip_with(
                &zip_path,
                &[("data.json", &serde_json::to_vec(&doc).unwrap())],
            );
            assert_rejected_and_unchanged(&e, &zip_path);
        }
    }

    #[test]
    fn a_wav_entry_that_is_not_a_wav_is_rejected() {
        let e = env();
        let (_o, zip_path) = out_file("fake.zip");
        zip_with(
            &zip_path,
            &[
                ("data.json", &data_json(serde_json::json!([good_row()]))),
                ("recordings/a.wav", b"MZ not audio"),
            ],
        );
        assert_rejected_and_unchanged(&e, &zip_path);
    }

    #[test]
    fn a_zip_without_data_json_is_rejected() {
        let e = env();
        let (_o, zip_path) = out_file("nodata.zip");
        zip_with(&zip_path, &[("recordings/a.wav", &wav_bytes())]);
        assert_rejected_and_unchanged(&e, &zip_path);
    }

    #[test]
    fn oversized_entries_and_too_many_entries_are_rejected() {
        let e = env();
        let (_o, zip_path) = out_file("big.zip");
        let data = data_json(serde_json::json!([good_row()]));
        zip_with(
            &zip_path,
            &[("data.json", &data), ("recordings/a.wav", &wav_bytes())],
        );
        let roomy = Limits::default();
        let cases = [
            Limits {
                max_data_bytes: 20,
                ..roomy
            },
            Limits {
                max_wav_bytes: 20,
                ..roomy
            },
            Limits {
                max_total_bytes: 100,
                ..roomy
            },
            Limits {
                max_entries: 1,
                ..roomy
            },
        ];
        for limits in cases {
            let before = snapshot(&e);
            let err = restore_with(&e.base, &e.conn, &zip_path, NOW, &limits).unwrap_err();
            assert_eq!(err.kind(), ErrorKind::InvalidBackup, "{limits:?}");
            assert_eq!(snapshot(&e), before);
        }
        restore_with(&e.base, &e.conn, &zip_path, NOW, &roomy).unwrap();
    }

    /// A WAV that is small on disk and huge once unpacked: a header and zeros.
    fn zero_wav(unpacked: usize) -> Vec<u8> {
        let mut bytes = b"RIFF\0\0\0\0WAVE".to_vec();
        bytes.resize(unpacked, 0);
        bytes
    }

    /// Rewrite the declared unpacked size of every `recordings/` entry, in both
    /// the local and the central headers, as a hostile file would.
    fn lie_about_sizes(path: &Path, declared: u32) {
        let mut bytes = fs::read(path).unwrap();
        for (signature, size_at, len_at, name_at) in [
            (&b"PK\x03\x04"[..], 22, 26, 30),
            (&b"PK\x01\x02"[..], 24, 28, 46),
        ] {
            let mut from = 0;
            while let Some(found) = bytes[from..].windows(4).position(|w| w == signature) {
                let at = from + found;
                from = at + 4;
                let len = usize::from(u16::from_le_bytes([
                    bytes[at + len_at],
                    bytes[at + len_at + 1],
                ]));
                if bytes[at + name_at..at + name_at + len].starts_with(b"recordings/") {
                    bytes[at + size_at..at + size_at + 4].copy_from_slice(&declared.to_le_bytes());
                }
            }
        }
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn declared_sizes_that_lie_cannot_get_past_the_total_cap() {
        let e = env();
        let (_o, zip_path) = out_file("bomb.zip");
        let data = data_json(serde_json::json!([good_row()]));
        zip_with(
            &zip_path,
            &[
                ("data.json", &data),
                ("recordings/a.wav", &zero_wav(3_000_000)),
            ],
        );
        lie_about_sizes(&zip_path, 500);
        let limits = Limits {
            max_total_bytes: 100_000,
            ..Limits::default()
        };

        let before = snapshot(&e);
        let err = restore_with(&e.base, &e.conn, &zip_path, NOW, &limits).unwrap_err();

        assert_eq!(err.kind(), ErrorKind::InvalidBackup);
        assert_eq!(snapshot(&e), before, "nothing written, no leftovers");
    }

    #[test]
    fn declared_sizes_that_lie_cannot_get_past_the_per_file_cap() {
        let e = env();
        let (_o, zip_path) = out_file("bomb.zip");
        let data = data_json(serde_json::json!([good_row()]));
        zip_with(
            &zip_path,
            &[
                ("data.json", &data),
                ("recordings/a.wav", &zero_wav(3_000_000)),
            ],
        );
        lie_about_sizes(&zip_path, 500);
        let limits = Limits {
            max_wav_bytes: 100_000,
            ..Limits::default()
        };

        let before = snapshot(&e);
        let err = restore_with(&e.base, &e.conn, &zip_path, NOW, &limits).unwrap_err();

        assert_eq!(err.kind(), ErrorKind::InvalidBackup);
        assert_eq!(snapshot(&e), before);
    }

    #[test]
    fn the_total_cap_is_shared_by_all_recordings() {
        let e = env();
        let (_o, zip_path) = out_file("many.zip");
        let data = data_json(serde_json::json!([good_row()]));
        let wav = zero_wav(60_000);
        zip_with(
            &zip_path,
            &[
                ("data.json", &data),
                ("recordings/a.wav", &wav),
                ("recordings/b.wav", &wav),
            ],
        );
        lie_about_sizes(&zip_path, 100);
        let limits = Limits {
            max_total_bytes: 100_000,
            ..Limits::default()
        };

        let before = snapshot(&e);
        assert!(restore_with(&e.base, &e.conn, &zip_path, NOW, &limits).is_err());
        assert_eq!(snapshot(&e), before);
    }

    #[test]
    fn wav_writer_stops_at_its_budget() {
        let dir = tempdir().unwrap();
        let temp = dir.path().join("t.partial");
        let mut source = io::Cursor::new(zero_wav(5_000_000));
        assert!(write_wav_entry(&mut source, &temp, 1_000_000).is_err());
        assert!(fs::metadata(&temp).unwrap().len() <= 1_000_001);
    }

    #[test]
    fn names_that_differ_only_by_case_are_rejected() {
        let e = env();
        let (_o, zip_path) = out_file("case.zip");
        let data = data_json(serde_json::json!([]));
        zip_with(
            &zip_path,
            &[
                ("data.json", &data),
                ("recordings/a.wav", &wav_bytes()),
                ("recordings/A.wav", &wav_bytes()),
            ],
        );
        assert_rejected_and_unchanged(&e, &zip_path);
    }

    fn zip_with_note(name: &str, note: &str) -> (TempDir, PathBuf) {
        let (o, zip_path) = out_file("note.zip");
        let doc = serde_json::json!({
            "version": 2, "profile": null, "results": [],
            "recordingMeta": [{ "name": name, "note": note, "tags": "" }]
        });
        let data = serde_json::to_vec(&doc).unwrap();
        zip_with(
            &zip_path,
            &[
                ("data.json", &data),
                (&format!("recordings/{name}"), &wav_bytes()),
            ],
        );
        (o, zip_path)
    }

    #[test]
    fn a_recording_that_differs_only_by_case_from_one_you_have_is_skipped_and_its_note_follows() {
        let e = env();
        write_wav(&recordings_dir(&e.base).join("rec_1.wav"), 50);
        let (_o, zip_path) = zip_with_note("REC_1.wav", "theirs");

        let summary = restore_from(&e.base, &e.conn, &zip_path, NOW).unwrap();

        assert_eq!(summary.recordings, 0);
        let names: Vec<_> = snapshot(&e).3;
        assert_eq!(names, ["rec_1.wav"], "no second copy under another case");
        let metas = db::list_meta(&e.conn).unwrap();
        assert_eq!(metas.len(), 1);
        assert_eq!(
            (metas[0].name.as_str(), metas[0].note.as_str()),
            ("rec_1.wav", "theirs")
        );
    }

    #[test]
    fn a_note_you_already_have_wins_over_one_that_differs_only_by_case() {
        let e = env();
        write_wav(&recordings_dir(&e.base).join("rec_1.wav"), 50);
        recordings::set_meta(&e.base, &e.conn, "rec_1.wav", "mine", "").unwrap();
        let (_o, zip_path) = zip_with_note("REC_1.wav", "theirs");

        restore_from(&e.base, &e.conn, &zip_path, NOW).unwrap();

        let metas = db::list_meta(&e.conn).unwrap();
        assert_eq!(metas.len(), 1);
        assert_eq!(metas[0].note, "mine");
    }

    #[test]
    fn a_failure_while_placing_files_rolls_the_database_back_and_removes_what_was_placed() {
        let e = env();
        let dir = recordings_dir(&e.base);
        fs::write(dir.join(".restore-a.wav.partial"), b"RIFF....WAVE").unwrap();
        let staged = Staged {
            files: vec![
                (dir.join(".restore-a.wav.partial"), dir.join("a.wav")),
                (dir.join(".restore-missing.partial"), dir.join("b.wav")),
            ],
        };
        let data = BackupData {
            version: FORMAT_VERSION,
            profile: Some(profile()),
            results: vec![BackupResult {
                created_at: T0,
                result: new_result("glides", 70.0),
            }],
            recording_meta: vec![],
        };

        let err = commit_with_files(&e.conn, &data, staged).unwrap_err();

        assert_eq!(err.kind(), ErrorKind::NotFound);
        assert!(db::list_results(&e.conn).unwrap().is_empty());
        assert_eq!(db::get_profile(&e.conn).unwrap(), None);
        assert!(
            !dir.join("a.wav").exists(),
            "a file placed before the failure is taken back"
        );
        assert!(
            fs::read_dir(&dir).unwrap().next().is_none(),
            "no staging leftovers"
        );
    }

    #[test]
    fn files_that_are_not_backups_are_rejected() {
        let e = filled();
        let (_o, path) = out_file("x.bin");
        for bytes in [
            &b""[..],
            b"hello",
            b"PK\x03\x04 truncated",
            b"{\"version\": 2",
            b"\xff\xfe\x00",
        ] {
            fs::write(&path, bytes).unwrap();
            assert_rejected_and_unchanged(&e, &path);
        }
        let missing = path.with_file_name("missing.zip");
        let err = restore_from(&e.base, &e.conn, &missing, NOW).unwrap_err();
        assert_eq!(err.kind(), ErrorKind::NotFound);
    }

    fn old_json_backup() -> serde_json::Value {
        serde_json::json!({
            "version": 1,
            "profile": {
                "baseline_hz": 130.0, "target_min_hz": 165.0, "target_max_hz": 255.0,
                "goals": "[\"pitch\",\"range\"]", "language": "es", "theme": "light",
                "onboarded": true
            },
            "results": [
                { "id": 7, "exercise_id": "sustained_tone", "score": 91.0, "pitch_mean": 170.0,
                  "pitch_sd": 3.0, "duration_s": 45.0, "created_at": T0 },
                { "id": 8, "exercise_id": "glides", "score": 40.0, "pitch_mean": 0.0,
                  "pitch_sd": 0.0, "duration_s": 5.0, "created_at": T0 + 90 }
            ],
            "recording_meta": [
                { "path": "D:\\data\\voice-trainer\\recordings\\rec_1.wav", "note": "old note", "tags": "t" },
                { "path": "/somewhere/not-audio.txt", "note": "dropped", "tags": "" }
            ]
        })
    }

    #[test]
    fn an_old_json_backup_still_restores() {
        let e = env();
        let (_o, path) = out_file("old-backup.json");
        fs::write(
            &path,
            serde_json::to_vec_pretty(&old_json_backup()).unwrap(),
        )
        .unwrap();

        let summary = restore_from(&e.base, &e.conn, &path, NOW).unwrap();

        assert_eq!(
            summary,
            RestoreSummary {
                results: 2,
                recordings: 0,
                profile: true
            }
        );
        let p = db::get_profile(&e.conn).unwrap().unwrap();
        assert_eq!(
            (p.baseline_hz, p.language.as_str(), p.pitch_engine),
            (130.0, "es", 1)
        );
        assert_eq!(p.goals, vec!["pitch", "range"]);
        let rows = db::list_results(&e.conn).unwrap();
        assert_eq!(rows[1].result.score, Some(91.0));
        assert_eq!(rows[1].result.scoring_version, 0);
        assert_eq!(db::list_meta(&e.conn).unwrap().len(), 1);
        assert_eq!(
            db::get_meta(&e.conn, "rec_1.wav").unwrap().unwrap().note,
            "old note"
        );
    }

    #[test]
    fn an_old_json_backup_restored_twice_keeps_the_count() {
        let e = env();
        let (_o, path) = out_file("old-backup.json");
        fs::write(&path, serde_json::to_vec(&old_json_backup()).unwrap()).unwrap();
        restore_from(&e.base, &e.conn, &path, NOW).unwrap();
        restore_from(&e.base, &e.conn, &path, NOW).unwrap();
        assert_eq!(db::list_results(&e.conn).unwrap().len(), 2);
    }

    #[test]
    fn old_junk_json_is_rejected_not_imported_as_zero_scores() {
        let e = env();
        let (_o, path) = out_file("junk.json");
        let junk = serde_json::json!({ "version": 1, "profile": null,
            "results": [{ "foo": 1 }, { "exercise_id": "glides" }], "recording_meta": [] });
        fs::write(&path, serde_json::to_vec(&junk).unwrap()).unwrap();
        assert_rejected_and_unchanged(&e, &path);
    }

    #[test]
    fn an_old_zip_backup_with_backup_json_restores_with_its_recordings() {
        let e = env();
        let (_o, path) = out_file("old.zip");
        let json = serde_json::to_vec(&old_json_backup()).unwrap();
        zip_with(
            &path,
            &[
                ("backup.json", &json),
                ("recordings/rec_1.wav", &wav_bytes()),
            ],
        );

        let summary = restore_from(&e.base, &e.conn, &path, NOW).unwrap();

        assert_eq!(
            summary,
            RestoreSummary {
                results: 2,
                recordings: 1,
                profile: true
            }
        );
        assert!(recordings_dir(&e.base).join("rec_1.wav").exists());
    }

    #[test]
    fn backup_into_the_recordings_folder_cannot_zero_a_file() {
        let e = filled();
        let victim = recordings_dir(&e.base).join("rec_1.wav");
        let before = fs::read(&victim).unwrap();
        for dest in [
            victim.clone(),
            recordings_dir(&e.base).join("backup.zip"),
            db_path(&e.base),
        ] {
            let err = create_to(&e.base, &e.conn, &dest).unwrap_err();
            assert_eq!(err.kind(), ErrorKind::InvalidInput, "{dest:?}");
        }
        assert_eq!(fs::read(&victim).unwrap(), before);
        assert!(!recordings_dir(&e.base).join("backup.zip").exists());
        assert!(db::get_profile(&e.conn).unwrap().is_some());
    }

    #[test]
    fn backup_replaces_the_target_and_skips_folders_named_like_wavs() {
        let e = filled();
        let (_o, dest) = out_file("backup.zip");
        fs::write(&dest, b"previous backup").unwrap();
        fs::remove_file(recordings_dir(&e.base).join("rec_1.wav")).unwrap();
        fs::create_dir(recordings_dir(&e.base).join("dir.wav")).unwrap();
        create_to(&e.base, &e.conn, &dest).unwrap();
        let zip = zip::ZipArchive::new(fs::File::open(&dest).unwrap()).unwrap();
        assert_eq!(
            zip.len(),
            2,
            "data.json and rec_2.wav; the folder is skipped"
        );
    }
}
