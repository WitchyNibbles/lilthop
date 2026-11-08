//! The data that crosses IPC and goes into backups, with its validation.
//!
//! Validation lives here because it is the same for the UI, for old data and
//! for a backup file from an unknown source.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

pub const MAX_EXERCISE_ID_LEN: usize = 64;
const MAX_HZ: f64 = 2000.0;
const MAX_CENTROID_HZ: f64 = 20_000.0;
const MAX_SECONDS: f64 = 86_400.0;
const MAX_NOTE_CHARS: usize = 4000;
const MAX_TAGS_CHARS: usize = 500;
const MAX_GOALS: usize = 32;
/// 2000-01-01 UTC: nothing from this app is older.
pub const MIN_CREATED_AT: i64 = 946_684_800;
/// Clocks drift; a result stamped up to a day ahead is accepted.
pub const FUTURE_SLACK_S: i64 = 86_400;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub baseline_hz: f64,
    pub baseline_centroid: f64,
    pub baseline_rms: f64,
    pub target_min_hz: f64,
    pub target_max_hz: f64,
    pub goals: Vec<String>,
    pub language: String,
    pub theme: String,
    pub onboarded: bool,
    /// 1 = measured by the old biased detector, 2 = fixed detector.
    pub pitch_engine: i64,
}

fn nullable_score<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<f64>, D::Error> {
    Option::<f64>::deserialize(d)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewResult {
    pub exercise_id: String,
    /// 0..100, or `None` for practice that is not scored (brightness). The
    /// field must be present in input, even when it is null.
    #[serde(deserialize_with = "nullable_score")]
    pub score: Option<f64>,
    pub pitch_mean: f64,
    pub pitch_sd: f64,
    pub duration_s: f64,
    pub voiced_s: f64,
    pub scoring_version: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedResult {
    pub id: i64,
    pub created_at: i64,
    #[serde(flatten)]
    pub result: NewResult,
}

/// A result as it is stored in a backup: no local id.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub created_at: i64,
    #[serde(flatten)]
    pub result: NewResult,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingMeta {
    pub name: String,
    pub note: String,
    pub tags: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSummary {
    pub results: usize,
    pub recordings: usize,
    pub profile: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingInfo {
    pub name: String,
    pub size_bytes: u64,
    pub modified_ts: u64,
    pub duration_s: f64,
    pub note: String,
    pub tags: String,
}

fn in_range(what: &str, value: f64, max: f64) -> AppResult<()> {
    if value.is_finite() && (0.0..=max).contains(&value) {
        Ok(())
    } else {
        Err(AppError::invalid(format!(
            "{what} must be a number from 0 to {max}"
        )))
    }
}

/// Lowercase snake_case id such as `sustained_tone`.
pub fn validate_exercise_id(id: &str) -> AppResult<()> {
    let mut chars = id.chars();
    let first_ok = chars.next().is_some_and(|c| c.is_ascii_lowercase());
    let rest_ok = chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
    if first_ok && rest_ok && id.len() <= MAX_EXERCISE_ID_LEN {
        Ok(())
    } else {
        Err(AppError::invalid(format!("not an exercise id: {id:?}")))
    }
}

impl Profile {
    pub fn validate(&self) -> AppResult<()> {
        in_range("baselineHz", self.baseline_hz, MAX_HZ)?;
        in_range("baselineCentroid", self.baseline_centroid, MAX_CENTROID_HZ)?;
        in_range("baselineRms", self.baseline_rms, 1.0)?;
        in_range("targetMinHz", self.target_min_hz, MAX_HZ)?;
        in_range("targetMaxHz", self.target_max_hz, MAX_HZ)?;
        if self.target_min_hz > self.target_max_hz {
            return Err(AppError::invalid("targetMinHz is above targetMaxHz"));
        }
        if !matches!(self.language.as_str(), "en" | "es") {
            return Err(AppError::invalid("language must be en or es"));
        }
        if !matches!(self.theme.as_str(), "dark" | "light") {
            return Err(AppError::invalid("theme must be dark or light"));
        }
        if !matches!(self.pitch_engine, 1 | 2) {
            return Err(AppError::invalid("pitchEngine must be 1 or 2"));
        }
        if self.goals.len() > MAX_GOALS {
            return Err(AppError::invalid("too many goals"));
        }
        self.goals.iter().try_for_each(|g| validate_exercise_id(g))
    }
}

impl NewResult {
    pub fn validate(&self) -> AppResult<()> {
        validate_exercise_id(&self.exercise_id)?;
        if let Some(score) = self.score {
            in_range("score", score, 100.0)?;
        }
        in_range("pitchMean", self.pitch_mean, MAX_HZ)?;
        in_range("pitchSd", self.pitch_sd, MAX_HZ)?;
        in_range("durationS", self.duration_s, MAX_SECONDS)?;
        in_range("voicedS", self.voiced_s, MAX_SECONDS)?;
        if !(0..=1000).contains(&self.scoring_version) {
            return Err(AppError::invalid("scoringVersion is out of range"));
        }
        Ok(())
    }
}

impl BackupResult {
    pub fn validate(&self, now: i64) -> AppResult<()> {
        if !(MIN_CREATED_AT..=now + FUTURE_SLACK_S).contains(&self.created_at) {
            return Err(AppError::invalid("createdAt is not a sane timestamp"));
        }
        self.result.validate()
    }
}

impl RecordingMeta {
    pub fn validate(&self) -> AppResult<()> {
        crate::paths::validate_recording_name(&self.name)?;
        validate_note_and_tags(&self.note, &self.tags)
    }
}

pub fn validate_note_and_tags(note: &str, tags: &str) -> AppResult<()> {
    if note.chars().count() > MAX_NOTE_CHARS {
        return Err(AppError::invalid("note is too long"));
    }
    if tags.chars().count() > MAX_TAGS_CHARS {
        return Err(AppError::invalid("tags are too long"));
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod fixtures {
    use super::*;

    pub fn profile() -> Profile {
        Profile {
            baseline_hz: 130.0,
            baseline_centroid: 2000.0,
            baseline_rms: 0.05,
            target_min_hz: 165.0,
            target_max_hz: 255.0,
            goals: vec!["pitch".into(), "stability".into()],
            language: "es".into(),
            theme: "light".into(),
            onboarded: true,
            pitch_engine: 2,
        }
    }

    pub fn new_result(exercise_id: &str, score: f64) -> NewResult {
        NewResult {
            score: Some(score),
            ..unscored_result(exercise_id)
        }
    }

    /// Practice that has no score, such as brightness.
    pub fn unscored_result(exercise_id: &str) -> NewResult {
        NewResult {
            exercise_id: exercise_id.into(),
            score: None,
            pitch_mean: 180.0,
            pitch_sd: 4.5,
            duration_s: 60.0,
            voiced_s: 41.5,
            scoring_version: 2,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fixtures::{new_result, profile, unscored_result};
    use super::*;

    fn keys(value: &serde_json::Value) -> Vec<String> {
        let mut keys: Vec<String> = value.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        keys
    }

    #[test]
    fn ipc_shapes_are_camel_case_exactly_as_the_contract_says() {
        let saved = SavedResult {
            id: 1,
            created_at: 5,
            result: new_result("glides", 70.0),
        };
        let info = RecordingInfo {
            name: "a.wav".into(),
            size_bytes: 1,
            modified_ts: 2,
            duration_s: 3.0,
            note: String::new(),
            tags: String::new(),
        };
        let summary = RestoreSummary {
            results: 1,
            recordings: 2,
            profile: true,
        };

        assert_eq!(
            keys(&serde_json::to_value(&saved).unwrap()),
            [
                "createdAt",
                "durationS",
                "exerciseId",
                "id",
                "pitchMean",
                "pitchSd",
                "score",
                "scoringVersion",
                "voicedS"
            ]
        );
        assert_eq!(
            keys(&serde_json::to_value(&info).unwrap()),
            [
                "durationS",
                "modifiedTs",
                "name",
                "note",
                "sizeBytes",
                "tags"
            ]
        );
        assert_eq!(
            keys(&serde_json::to_value(summary).unwrap()),
            ["profile", "recordings", "results"]
        );
        assert_eq!(
            keys(&serde_json::to_value(profile()).unwrap()),
            [
                "baselineCentroid",
                "baselineHz",
                "baselineRms",
                "goals",
                "language",
                "onboarded",
                "pitchEngine",
                "targetMaxHz",
                "targetMinHz",
                "theme"
            ]
        );
    }

    #[test]
    fn non_finite_and_out_of_range_numbers_are_refused() {
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -0.5, 100.5] {
            let mut r = new_result("glides", 70.0);
            r.score = Some(bad);
            assert!(r.validate().is_err(), "score {bad}");
        }
        assert!(unscored_result("resonance").validate().is_ok());
        let mut p = profile();
        p.baseline_rms = f64::NAN;
        assert!(p.validate().is_err());
        assert!(profile().validate().is_ok());
        assert!(new_result("glides", 100.0).validate().is_ok());
    }

    #[test]
    fn exercise_ids_must_look_like_ids() {
        for ok in ["glides", "warmup_hum", "a1"] {
            assert!(validate_exercise_id(ok).is_ok(), "{ok}");
        }
        for bad in [
            "",
            "1a",
            "Glides",
            "a b",
            "a/b",
            "../x",
            "é",
            &"a".repeat(65),
        ] {
            assert!(validate_exercise_id(bad).is_err(), "{bad:?}");
        }
    }
}
