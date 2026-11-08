//! Where things live on disk, and the rules for names.
//!
//! Everything takes a base directory so tests can use a temp folder. The
//! webview never sends a path: it sends a recording `name`, checked here.

use std::ffi::OsString;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

pub const DB_FILE: &str = "lilthop.db";
/// What the database was called before the rename, in both older folders.
pub const OLD_DB_FILE: &str = "voice_trainer.db";
/// The bundle identifier the app had before it became Lilthop. Its data folder
/// is `<Tauri data dir>/com.voice.trainer`.
const PREVIOUS_IDENTIFIER: &str = "com.voice.trainer";
const MAX_NAME_BYTES: usize = 128;
const WINDOWS_DEVICE_NAMES: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

pub fn db_path(base: &Path) -> PathBuf {
    base.join(DB_FILE)
}

/// The database of an older folder (the first version's, or the one for the
/// previous identifier).
pub fn old_db_path(dir: &Path) -> PathBuf {
    dir.join(OLD_DB_FILE)
}

pub fn recordings_dir(base: &Path) -> PathBuf {
    base.join("recordings")
}

/// The data folder of the previous identifier, next to the current one.
/// `data_dir` is the folder Tauri puts every app's data folder in (the parent
/// of `app_data_dir`), so the two always sit side by side.
pub fn previous_data_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(PREVIOUS_IDENTIFIER)
}

/// The folder the first version of the app used: `%APPDATA%\voice-trainer`.
/// `None` when APPDATA is not set, because guessing a folder is how data got
/// lost before.
pub fn legacy_data_dir(appdata: Option<OsString>) -> Option<PathBuf> {
    let appdata = appdata.filter(|v| !v.is_empty())?;
    Some(PathBuf::from(appdata).join("voice-trainer"))
}

fn is_allowed_name_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.'
}

/// A recording name is a bare file name: letters, digits, `_`, `-`, `.`,
/// ending in `.wav`. No separators, no `..`, no Windows device names.
pub fn validate_recording_name(name: &str) -> AppResult<()> {
    let bad = |why: &str| AppError::invalid(format!("not a valid recording name: {why}"));
    let stem = name
        .strip_suffix(".wav")
        .ok_or_else(|| bad("it must end in .wav"))?;
    if name.len() > MAX_NAME_BYTES {
        return Err(bad("too long"));
    }
    if stem.is_empty() || stem.starts_with('.') {
        return Err(bad("empty or hidden"));
    }
    if !name.chars().all(is_allowed_name_char) || name.contains("..") {
        return Err(bad("only letters, digits, _ - . are allowed"));
    }
    let device = stem.split('.').next().unwrap_or(stem).to_ascii_lowercase();
    if WINDOWS_DEVICE_NAMES.contains(&device.as_str()) {
        return Err(bad("reserved name"));
    }
    Ok(())
}

/// True for the names the recorder gives its files (`rec_<milliseconds>.wav`).
/// Stricter than `validate_recording_name`, which also lets imported names in:
/// code that deletes files in a folder it does not own uses this one.
pub fn is_app_recording_name(name: &str) -> bool {
    name.strip_prefix("rec_")
        .and_then(|rest| rest.strip_suffix(".wav"))
        .is_some_and(|digits| !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit()))
}

/// Full path of an existing recording. The name is validated and the file
/// must be a regular file (not a link or folder) in the recordings folder.
pub fn recording_path(base: &Path, name: &str) -> AppResult<PathBuf> {
    validate_recording_name(name)?;
    let path = recordings_dir(base).join(name);
    match fs::symlink_metadata(&path) {
        Ok(meta) if meta.is_file() => Ok(path),
        Ok(_) => Err(AppError::invalid("not a recording file")),
        Err(e) => Err(e.into()),
    }
}

/// Write `dest` by writing a sibling `.partial` file, syncing it, then renaming
/// it over `dest`. A failure leaves any existing `dest` as it was.
pub fn write_atomic(dest: &Path, write: impl FnOnce(&mut File) -> AppResult<()>) -> AppResult<()> {
    let file_name = dest
        .file_name()
        .ok_or_else(|| AppError::invalid("destination has no file name"))?;
    let mut partial_name = OsString::from(".");
    partial_name.push(file_name);
    partial_name.push(".partial");
    let partial = dest.with_file_name(partial_name);
    let result = write_and_sync(&partial, write).and_then(|()| Ok(fs::rename(&partial, dest)?));
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result
}

fn write_and_sync(partial: &Path, write: impl FnOnce(&mut File) -> AppResult<()>) -> AppResult<()> {
    let mut file = File::create(partial)?;
    write(&mut file)?;
    file.flush()?;
    file.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn accepts_plain_wav_names() {
        for ok in ["rec_100.wav", "rec_1730000000123.wav", "a-b.c.wav"] {
            assert!(validate_recording_name(ok).is_ok(), "{ok}");
        }
    }

    #[test]
    fn only_the_recorders_own_names_count_as_the_apps_recordings() {
        for ok in ["rec_1.wav", "rec_1730000000123.wav"] {
            assert!(is_app_recording_name(ok), "{ok}");
        }
        for other in [
            "rec_.wav",
            "rec_x.wav",
            "rec_1.WAV",
            "rec_1.wav.bak",
            "my_rec_1.wav",
            "rec_1 .wav",
            "notes.txt",
            "a-b.c.wav",
            "rec_1/../x.wav",
            "",
        ] {
            assert!(!is_app_recording_name(other), "{other:?}");
        }
    }

    #[test]
    fn rejects_traversal_and_odd_names() {
        let bad = [
            "../x.wav",
            "..\\x.wav",
            "a/b.wav",
            "a\\b.wav",
            "/etc/passwd.wav",
            "C:x.wav",
            "x.txt",
            "x.WAV",
            "x",
            "",
            ".wav",
            ".hidden.wav",
            "a b.wav",
            "a..b.wav",
            "CON.wav",
            "nul.wav",
            "Com1.wav",
            "con.x.wav",
            "x.wav\0",
        ];
        for name in bad {
            assert!(validate_recording_name(name).is_err(), "{name:?}");
        }
        let long = format!("{}.wav", "a".repeat(200));
        assert!(validate_recording_name(&long).is_err());
    }

    #[test]
    fn recording_path_needs_an_existing_regular_file() {
        let base = tempdir().unwrap();
        fs::create_dir_all(recordings_dir(base.path()).join("dir.wav")).unwrap();
        fs::write(recordings_dir(base.path()).join("a.wav"), b"x").unwrap();
        assert!(recording_path(base.path(), "a.wav").is_ok());
        assert_eq!(
            recording_path(base.path(), "missing.wav")
                .unwrap_err()
                .kind(),
            crate::error::ErrorKind::NotFound
        );
        assert!(recording_path(base.path(), "dir.wav").is_err());
        assert!(recording_path(base.path(), "../a.wav").is_err());
    }

    #[test]
    fn legacy_dir_needs_appdata() {
        assert_eq!(legacy_data_dir(None), None);
        assert_eq!(legacy_data_dir(Some(OsString::new())), None);
        let dir = legacy_data_dir(Some(OsString::from("/x/Roaming"))).unwrap();
        assert!(dir.ends_with("voice-trainer"));
    }

    #[test]
    fn the_previous_folder_sits_next_to_the_current_one() {
        let data_dir = Path::new("/x/share");
        assert_eq!(
            previous_data_dir(data_dir),
            Path::new("/x/share/com.voice.trainer")
        );
    }

    #[test]
    fn the_database_was_renamed_and_the_old_name_is_kept_for_older_folders() {
        let dir = Path::new("/d");
        assert!(db_path(dir).ends_with("lilthop.db"));
        assert!(old_db_path(dir).ends_with("voice_trainer.db"));
    }

    #[test]
    fn write_atomic_keeps_the_old_file_when_the_writer_fails() {
        let dir = tempdir().unwrap();
        let dest = dir.path().join("out.bin");
        fs::write(&dest, b"keep me").unwrap();

        let err = write_atomic(&dest, |_| Err(AppError::invalid("boom"))).unwrap_err();

        assert_eq!(err.message(), "boom");
        assert_eq!(fs::read(&dest).unwrap(), b"keep me");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn write_atomic_replaces_the_file_on_success() {
        let dir = tempdir().unwrap();
        let dest = dir.path().join("out.bin");
        write_atomic(&dest, |f| Ok(f.write_all(b"new")?)).unwrap();
        assert_eq!(fs::read(&dest).unwrap(), b"new");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
