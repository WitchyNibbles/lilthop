//! Export of the results table for a spreadsheet or another tool.

use std::io::Write;
use std::path::Path;

use rusqlite::Connection;
use serde::Deserialize;

use crate::error::AppResult;
use crate::paths::write_atomic;
use crate::storage::db;
use crate::storage::model::SavedResult;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Json,
    Csv,
}

impl ExportFormat {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Csv => "csv",
        }
    }
}

const CSV_HEADER: &str =
    "id,createdAt,date,exerciseId,score,pitchMean,pitchSd,durationS,voicedS,scoringVersion";

/// Results as text, oldest first so a spreadsheet reads like a diary.
pub fn render(conn: &Connection, format: ExportFormat) -> AppResult<String> {
    let mut rows = db::list_results(conn)?;
    rows.reverse();
    match format {
        ExportFormat::Json => Ok(serde_json::to_string_pretty(&rows)?),
        ExportFormat::Csv => Ok(render_csv(&rows)),
    }
}

pub fn export_to(conn: &Connection, dest: &Path, format: ExportFormat) -> AppResult<()> {
    let text = render(conn, format)?;
    write_atomic(dest, |file| Ok(file.write_all(text.as_bytes())?))
}

fn render_csv(rows: &[SavedResult]) -> String {
    let mut out = format!("{CSV_HEADER}\r\n");
    for r in rows {
        let x = &r.result;
        let line = format!(
            "{},{},{},{},{},{},{},{},{},{}\r\n",
            r.id,
            r.created_at,
            utc_iso(r.created_at),
            csv_text(&x.exercise_id),
            x.score.map(|s| s.to_string()).unwrap_or_default(),
            x.pitch_mean,
            x.pitch_sd,
            x.duration_s,
            x.voiced_s,
            x.scoring_version,
        );
        out.push_str(&line);
    }
    out
}

/// A text cell. A leading `= + - @` or control character would make a
/// spreadsheet run it as a formula, so it gets a visible `'` in front.
fn csv_text(text: &str) -> String {
    let formula_start = text.starts_with(['=', '+', '-', '@', '\t', '\r']);
    let cell = if formula_start {
        format!("'{text}")
    } else {
        text.to_owned()
    };
    if cell.contains([',', '"', '\r', '\n']) {
        format!("\"{}\"", cell.replace('"', "\"\""))
    } else {
        cell
    }
}

/// `2024-10-27T03:33:20Z` for a Unix time in seconds.
pub fn utc_iso(ts: i64) -> String {
    let days = ts.div_euclid(86_400);
    let secs = ts.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        secs / 3600,
        secs % 3600 / 60,
        secs % 60
    )
}

/// Days since 1970-01-01 to (year, month, day), proleptic Gregorian.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::model::fixtures::{new_result, unscored_result};
    use tempfile::tempdir;

    const T0: i64 = 1_730_000_000;

    fn conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        conn
    }

    fn two_results(conn: &Connection) {
        db::insert_result(conn, &new_result("sustained_tone", 82.5), T0 + 600).unwrap();
        db::insert_result(conn, &new_result("glides", 70.0), T0).unwrap();
    }

    #[test]
    fn utc_iso_known_answers() {
        assert_eq!(utc_iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(utc_iso(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(utc_iso(T0), "2024-10-27T03:33:20Z");
        assert_eq!(utc_iso(-1), "1969-12-31T23:59:59Z");
    }

    #[test]
    fn csv_has_a_header_and_one_row_per_result_oldest_first() {
        let c = conn();
        two_results(&c);
        let csv = render(&c, ExportFormat::Csv).unwrap();
        assert_eq!(
            csv,
            "id,createdAt,date,exerciseId,score,pitchMean,pitchSd,durationS,voicedS,scoringVersion\r\n\
             2,1730000000,2024-10-27T03:33:20Z,glides,70,180,4.5,60,41.5,2\r\n\
             1,1730000600,2024-10-27T03:43:20Z,sustained_tone,82.5,180,4.5,60,41.5,2\r\n"
        );
    }

    #[test]
    fn an_unscored_session_has_an_empty_csv_cell_and_a_null_in_json() {
        let c = conn();
        db::insert_result(&c, &unscored_result("resonance"), T0).unwrap();

        let csv = render(&c, ExportFormat::Csv).unwrap();
        assert!(csv.contains(",resonance,,180,4.5,60,41.5,2\r\n"), "{csv:?}");

        let json = render(&c, ExportFormat::Json).unwrap();
        let back: Vec<SavedResult> = serde_json::from_str(&json).unwrap();
        assert_eq!(back[0].result.score, None);
        assert!(json.contains("\"score\": null"), "{json}");
    }

    #[test]
    fn csv_of_nothing_is_just_the_header() {
        let csv = render(&conn(), ExportFormat::Csv).unwrap();
        assert_eq!(csv, format!("{CSV_HEADER}\r\n"));
    }

    #[test]
    fn csv_text_that_a_spreadsheet_would_run_as_a_formula_is_defused() {
        let c = conn();
        let evil = [
            "=HYPERLINK(\"http://x\")",
            "+1",
            "-2",
            "@SUM(A1)",
            "\tx",
            "\rx",
        ];
        for (i, id) in evil.iter().enumerate() {
            // Straight into the table: old rows were never checked.
            c.execute(
                "INSERT INTO exercise_result (exercise_id, score, pitch_mean, pitch_sd, duration_s, created_at)
                 VALUES (?1, 1, 1, 1, 1, ?2)",
                rusqlite::params![id, T0 + i as i64],
            )
            .unwrap();
        }

        let csv = render(&c, ExportFormat::Csv).unwrap();

        for defused in [
            ",\"'=HYPERLINK(\"\"http://x\"\")\",",
            ",'+1,",
            ",'-2,",
            ",'@SUM(A1),",
            ",'\tx,",
            ",\"'\rx\",",
        ] {
            assert!(csv.contains(defused), "{defused:?} not in {csv:?}");
        }
        for raw in [",=", ",+", ",-", ",@", ",\"=", ",\t", ",\r"] {
            assert!(!csv.contains(raw), "{raw:?} in {csv:?}");
        }
    }

    #[test]
    fn csv_quotes_commas_and_quotes() {
        let c = conn();
        c.execute(
            "INSERT INTO exercise_result (exercise_id, score, pitch_mean, pitch_sd, duration_s, created_at)
             VALUES ('a,\"b', 1, 1, 1, 1, ?1)",
            [T0],
        )
        .unwrap();
        let csv = render(&c, ExportFormat::Csv).unwrap();
        assert!(csv.contains(",\"a,\"\"b\","), "{csv}");
    }

    #[test]
    fn json_round_trips_through_the_saved_result_shape() {
        let c = conn();
        two_results(&c);
        let json = render(&c, ExportFormat::Json).unwrap();
        let back: Vec<SavedResult> = serde_json::from_str(&json).unwrap();
        let mut expected = db::list_results(&c).unwrap();
        expected.reverse();
        assert_eq!(back, expected);
        assert!(json.contains("\"exerciseId\""));
    }

    #[test]
    fn export_to_writes_the_file_and_fails_cleanly_when_it_cannot() {
        let c = conn();
        two_results(&c);
        let dir = tempdir().unwrap();
        let dest = dir.path().join("out.csv");
        export_to(&c, &dest, ExportFormat::Csv).unwrap();
        assert_eq!(
            std::fs::read_to_string(&dest).unwrap(),
            render(&c, ExportFormat::Csv).unwrap()
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);

        let missing = dir.path().join("no-such-folder/out.csv");
        assert!(export_to(&c, &missing, ExportFormat::Csv).is_err());
    }
}
