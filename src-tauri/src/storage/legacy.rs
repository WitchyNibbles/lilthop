//! The first version's JSON backup (`export_backup`), read into the current shape.

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::paths::validate_recording_name;
use crate::storage::backup::{BackupData, FORMAT_VERSION};
use crate::storage::model::{BackupResult, NewResult, Profile, RecordingMeta};

/// The old detector's profile defaults for fields that did not exist yet.
const OLD_BASELINE_CENTROID: f64 = 2000.0;
const OLD_PITCH_ENGINE: i64 = 1;

#[derive(Deserialize)]
struct OldBackup {
    profile: Option<OldProfile>,
    results: Vec<OldResult>,
    recording_meta: Vec<OldMeta>,
}

#[derive(Deserialize)]
struct OldProfile {
    baseline_hz: f64,
    target_min_hz: f64,
    target_max_hz: f64,
    /// JSON text of an array, because the old UI stringified it.
    goals: String,
    language: String,
    theme: String,
    onboarded: bool,
}

#[derive(Deserialize)]
struct OldResult {
    exercise_id: String,
    score: f64,
    pitch_mean: f64,
    pitch_sd: f64,
    duration_s: f64,
    created_at: i64,
}

#[derive(Deserialize)]
struct OldMeta {
    path: String,
    note: String,
    tags: String,
}

/// Convert a parsed version-1 backup. Every field is required: the old
/// importer filled gaps with zeros and let junk through. Notes whose path does
/// not end in a valid recording name are dropped: they point at nothing the
/// app can open.
pub fn convert(value: serde_json::Value) -> AppResult<BackupData> {
    let old: OldBackup = serde_json::from_value(value)?;
    let profile = old.profile.map(convert_profile).transpose()?;
    Ok(BackupData {
        version: FORMAT_VERSION,
        profile,
        results: old.results.into_iter().map(convert_result).collect(),
        recording_meta: old
            .recording_meta
            .into_iter()
            .filter_map(convert_meta)
            .collect(),
    })
}

fn convert_profile(old: OldProfile) -> AppResult<Profile> {
    let goals = serde_json::from_str(&old.goals)
        .map_err(|_| AppError::invalid_backup("the profile goals are not a list"))?;
    Ok(Profile {
        baseline_hz: old.baseline_hz,
        baseline_centroid: OLD_BASELINE_CENTROID,
        baseline_rms: 0.0,
        target_min_hz: old.target_min_hz,
        target_max_hz: old.target_max_hz,
        goals,
        language: old.language,
        theme: old.theme,
        onboarded: old.onboarded,
        pitch_engine: OLD_PITCH_ENGINE,
    })
}

fn convert_result(old: OldResult) -> BackupResult {
    BackupResult {
        created_at: old.created_at,
        result: NewResult {
            exercise_id: old.exercise_id,
            score: Some(old.score),
            pitch_mean: old.pitch_mean,
            pitch_sd: old.pitch_sd,
            duration_s: old.duration_s,
            voiced_s: 0.0,
            scoring_version: 0,
        },
    }
}

fn convert_meta(old: OldMeta) -> Option<RecordingMeta> {
    let name = old.path.rsplit(['/', '\\']).next()?;
    validate_recording_name(name).ok()?;
    Some(RecordingMeta {
        name: name.to_owned(),
        note: old.note,
        tags: old.tags,
    })
}
