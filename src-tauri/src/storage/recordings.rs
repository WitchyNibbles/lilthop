//! The recordings folder and the notes attached to its files.

use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use rusqlite::Connection;

use crate::error::AppResult;
use crate::paths::{recording_path, recordings_dir, validate_recording_name};
use crate::storage::db;
use crate::storage::model::{RecordingInfo, RecordingMeta, validate_note_and_tags};

/// Size of the header hound writes; the rest of the file is sample data.
const WAV_HEADER_BYTES: u64 = 44;

/// All recordings in the folder, newest first, with their notes.
pub fn list(base: &Path, conn: &Connection) -> AppResult<Vec<RecordingInfo>> {
    let notes = db::list_meta(conn)?;
    let mut out = Vec::new();
    for entry in fs::read_dir(recordings_dir(base))?.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if validate_recording_name(&name).is_err() {
            continue;
        }
        let Ok(meta) = fs::symlink_metadata(entry.path()) else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let note = notes.iter().find(|m| m.name == name);
        out.push(RecordingInfo {
            size_bytes: meta.len(),
            modified_ts: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_secs()),
            duration_s: duration_s(&entry.path(), meta.len()),
            note: note.map(|m| m.note.clone()).unwrap_or_default(),
            tags: note.map(|m| m.tags.clone()).unwrap_or_default(),
            name,
        });
    }
    out.sort_by(|a, b| {
        b.modified_ts
            .cmp(&a.modified_ts)
            .then_with(|| b.name.cmp(&a.name))
    });
    Ok(out)
}

/// Length from the file size, not the header: a recording cut short by a
/// crash has a header that still says zero samples.
fn duration_s(path: &Path, len: u64) -> f64 {
    let Ok(reader) = hound::WavReader::open(path) else {
        return 0.0;
    };
    let spec = reader.spec();
    let frame_bytes = u64::from(spec.channels) * u64::from(spec.bits_per_sample / 8);
    if frame_bytes == 0 || spec.sample_rate == 0 {
        return 0.0;
    }
    let frames = len.saturating_sub(WAV_HEADER_BYTES) / frame_bytes;
    frames as f64 / f64::from(spec.sample_rate)
}

/// Delete one recording and its note. Only a validated bare name that exists
/// in the recordings folder is touched.
pub fn delete(base: &Path, conn: &Connection, name: &str) -> AppResult<()> {
    let path = recording_path(base, name)?;
    fs::remove_file(path)?;
    db::delete_meta(conn, name)
}

/// Save the note and tags of an existing recording.
pub fn set_meta(
    base: &Path,
    conn: &Connection,
    name: &str,
    note: &str,
    tags: &str,
) -> AppResult<()> {
    recording_path(base, name)?;
    validate_note_and_tags(note, tags)?;
    db::set_meta(
        conn,
        &RecordingMeta {
            name: name.to_owned(),
            note: note.to_owned(),
            tags: tags.to_owned(),
        },
    )
}

/// Remove every recording file and any half-written leftovers.
pub fn delete_all_files(base: &Path) -> AppResult<()> {
    for entry in fs::read_dir(recordings_dir(base))?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let ours = validate_recording_name(&name).is_ok() || name.ends_with(".partial");
        let is_file = fs::symlink_metadata(entry.path()).is_ok_and(|m| m.is_file());
        if ours && is_file {
            fs::remove_file(entry.path())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorKind;
    use crate::storage::testutil::write_wav;
    use rusqlite::Connection;
    use tempfile::{TempDir, tempdir};

    fn setup() -> (TempDir, Connection) {
        let base = tempdir().unwrap();
        fs::create_dir_all(recordings_dir(base.path())).unwrap();
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        (base, conn)
    }

    fn rec(base: &Path, name: &str, samples: usize) {
        write_wav(&recordings_dir(base).join(name), samples);
    }

    #[test]
    fn list_shows_wavs_with_duration_and_notes() {
        let (base, conn) = setup();
        rec(base.path(), "rec_1.wav", 16000);
        fs::write(recordings_dir(base.path()).join("readme.txt"), "x").unwrap();
        fs::write(recordings_dir(base.path()).join("bad name.wav"), "x").unwrap();
        set_meta(base.path(), &conn, "rec_1.wav", "warm", "am").unwrap();

        let all = list(base.path(), &conn).unwrap();

        assert_eq!(all.len(), 1);
        assert_eq!(all[0].name, "rec_1.wav");
        assert_eq!((all[0].note.as_str(), all[0].tags.as_str()), ("warm", "am"));
        assert!((all[0].duration_s - 2.0).abs() < 1e-9);
        assert_eq!(all[0].size_bytes, 44 + 32000);
    }

    #[test]
    fn a_recording_cut_short_by_a_crash_still_shows_its_length() {
        let (base, conn) = setup();
        let path = recordings_dir(base.path()).join("rec_9.wav");
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 8000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut w = hound::WavWriter::create(&path, spec).unwrap();
        for _ in 0..8000 {
            w.write_sample(1i16).unwrap();
        }
        w.flush().unwrap();
        let cut = fs::read(&path).unwrap();
        drop(w);
        let crashed = recordings_dir(base.path()).join("rec_8.wav");
        fs::write(&crashed, cut).unwrap();
        fs::remove_file(&path).unwrap();

        let all = list(base.path(), &conn).unwrap();

        assert_eq!(all.len(), 1);
        assert!(
            (all[0].duration_s - 1.0).abs() < 0.01,
            "{}",
            all[0].duration_s
        );
    }

    #[test]
    fn delete_removes_the_file_and_its_note() {
        let (base, conn) = setup();
        rec(base.path(), "a.wav", 10);
        set_meta(base.path(), &conn, "a.wav", "n", "").unwrap();
        delete(base.path(), &conn, "a.wav").unwrap();
        assert!(list(base.path(), &conn).unwrap().is_empty());
        assert_eq!(db::get_meta(&conn, "a.wav").unwrap(), None);
    }

    #[test]
    fn delete_refuses_a_name_that_climbs_out_of_the_folder() {
        let (base, conn) = setup();
        let outside = base.path().join("x.wav");
        fs::write(&outside, b"not a recording").unwrap();

        let err = delete(base.path(), &conn, "../x.wav").unwrap_err();

        assert_eq!(err.kind(), ErrorKind::InvalidInput);
        assert!(outside.exists());
    }

    #[test]
    fn delete_of_a_missing_recording_is_not_found() {
        let (base, conn) = setup();
        let err = delete(base.path(), &conn, "gone.wav").unwrap_err();
        assert_eq!(err.kind(), ErrorKind::NotFound);
    }

    #[test]
    fn meta_needs_an_existing_recording() {
        let (base, conn) = setup();
        let err = set_meta(base.path(), &conn, "gone.wav", "n", "").unwrap_err();
        assert_eq!(err.kind(), ErrorKind::NotFound);
        assert!(db::list_meta(&conn).unwrap().is_empty());
    }

    #[test]
    fn delete_all_files_clears_wavs_and_partials_only() {
        let (base, _conn) = setup();
        rec(base.path(), "a.wav", 10);
        let dir = recordings_dir(base.path());
        fs::write(dir.join(".b.wav.partial"), b"x").unwrap();
        fs::write(dir.join("keep.txt"), b"x").unwrap();
        delete_all_files(base.path()).unwrap();
        let left: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        assert_eq!(left, vec![std::ffi::OsString::from("keep.txt")]);
    }
}
