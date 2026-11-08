//! One error type for everything the webview can see.
//!
//! It serializes to `{ "kind": string, "message": string }`. The message is for
//! a person to read; the kind is for the UI to branch on.

use std::fmt;

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// What went wrong, in terms the UI can act on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    /// The caller sent something that is not allowed (bad name, bad number).
    InvalidInput,
    /// The thing asked for does not exist.
    NotFound,
    /// A backup file failed validation. Nothing was changed.
    InvalidBackup,
    /// The database is newer than this app, or it failed.
    Database,
    /// Disk read or write failed.
    Io,
    /// No microphone, or it was unplugged.
    DeviceLost,
    /// The microphone exists but its stream would not open or start.
    StreamFailed,
    /// A recording could not be written to disk.
    WriteFailed,
    /// The data from before the rename could not be moved to the new folder.
    /// It is still whole in the old one, and the app asks again on retry.
    MigrationFailed,
}

impl ErrorKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InvalidInput => "invalid_input",
            Self::NotFound => "not_found",
            Self::InvalidBackup => "invalid_backup",
            Self::Database => "database",
            Self::Io => "io",
            Self::DeviceLost => "device_lost",
            Self::StreamFailed => "stream_failed",
            Self::WriteFailed => "write_failed",
            Self::MigrationFailed => "migration_failed",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppError {
    kind: ErrorKind,
    message: String,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::InvalidInput, message)
    }

    pub fn invalid_backup(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::InvalidBackup, message)
    }

    #[cfg(test)]
    pub fn kind(&self) -> ErrorKind {
        self.kind
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.kind.as_str(), self.message)
    }
}

impl std::error::Error for AppError {}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("kind", self.kind.as_str())?;
        state.serialize_field("message", &self.message)?;
        state.end()
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        let kind = if e.kind() == std::io::ErrorKind::NotFound {
            ErrorKind::NotFound
        } else {
            ErrorKind::Io
        };
        Self::new(kind, e.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        Self::new(ErrorKind::Database, e.to_string())
    }
}

impl From<zip::result::ZipError> for AppError {
    fn from(e: zip::result::ZipError) -> Self {
        Self::invalid_backup(format!("not a readable zip: {e}"))
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        Self::invalid_backup(format!("bad data: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_to_kind_and_message() {
        let err = AppError::invalid("name has a slash");
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "invalid_input", "message": "name has a slash" })
        );
    }

    #[test]
    fn kinds_use_the_names_the_ui_branches_on() {
        for (kind, name) in [
            (ErrorKind::DeviceLost, "device_lost"),
            (ErrorKind::StreamFailed, "stream_failed"),
            (ErrorKind::WriteFailed, "write_failed"),
            (ErrorKind::MigrationFailed, "migration_failed"),
        ] {
            let json = serde_json::to_value(AppError::new(kind, "x")).unwrap();
            assert_eq!(json["kind"], name);
        }
    }

    #[test]
    fn missing_file_maps_to_not_found() {
        let io = std::io::Error::from(std::io::ErrorKind::NotFound);
        assert_eq!(AppError::from(io).kind(), ErrorKind::NotFound);
    }
}
