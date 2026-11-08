//! Offline pitch analysis of a WAV file, for `cargo run --example analyze`.
//!
//! It runs the same framing and the same analyser as the live stream, so a
//! recording of a real voice can be checked against a tuner. It only reads
//! the file it is given; it never touches the app's data folder.

use std::fmt::Write as _;
use std::path::Path;

use crate::audio::pitch_stream::Pipeline;
use crate::dsp;
use crate::error::{AppError, AppResult};

/// Refuse files longer than this: the whole file is held in memory.
const MAX_SECONDS: f64 = 3600.0;

/// A second shows a pitch only with this many voiced frames (about 100 ms),
/// so the edge of a phrase does not count as a second of voice.
const MIN_VOICED_FRAMES_PER_SECOND: usize = 5;

/// What a file's pitch looks like.
#[derive(Debug, Clone, PartialEq)]
pub struct Summary {
    pub sample_rate: u32,
    pub seconds: f64,
    pub frames: usize,
    pub voiced_frames: usize,
    /// Median f0 of the voiced frames, in Hz.
    pub median_f0: Option<f32>,
    /// Median f0 of the voiced frames in each second, `None` for a second
    /// with no voice.
    pub per_second: Vec<Option<f32>>,
}

impl Summary {
    pub fn voiced_share(&self) -> f64 {
        if self.frames == 0 {
            0.0
        } else {
            self.voiced_frames as f64 / self.frames as f64
        }
    }
}

fn median(values: &mut [f32]) -> Option<f32> {
    values.sort_by(f32::total_cmp);
    let mid = values.len() / 2;
    match values.len() {
        0 => None,
        n if n % 2 == 1 => Some(values[mid]),
        _ => Some((values[mid - 1] + values[mid]) / 2.0),
    }
}

fn second_median(voiced: &mut [f32]) -> Option<f32> {
    if voiced.len() < MIN_VOICED_FRAMES_PER_SECOND {
        return None;
    }
    median(voiced)
}

/// Run mono samples through the live pipeline.
pub fn summarize(samples: &[f32], sample_rate: u32) -> Summary {
    let mut pipeline = Pipeline::new(sample_rate);
    let half_window_ms = dsp::window_len(sample_rate) as f64 * 500.0 / f64::from(sample_rate);
    let seconds = samples.len() as f64 / f64::from(sample_rate);
    let mut by_second: Vec<Vec<f32>> = vec![Vec::new(); seconds.ceil() as usize];
    let (mut frames, mut voiced) = (0, Vec::new());
    pipeline.push(samples, &mut |frame| {
        frames += 1;
        if frame.f0 > 0.0 {
            voiced.push(frame.f0);
            let centre_s = ((frame.t_ms - half_window_ms) / 1000.0).max(0.0) as usize;
            if let Some(bucket) = by_second.get_mut(centre_s) {
                bucket.push(frame.f0);
            }
        }
    });
    Summary {
        sample_rate,
        seconds,
        frames,
        voiced_frames: voiced.len(),
        median_f0: median(&mut voiced),
        per_second: by_second.iter_mut().map(|b| second_median(b)).collect(),
    }
}

/// Read a WAV of any common format as mono `f32` in -1..1.
pub fn read_wav_mono(path: &Path) -> AppResult<(Vec<f32>, u32)> {
    let bad = |e: hound::Error| AppError::invalid(format!("cannot read this WAV file: {e}"));
    let reader = hound::WavReader::open(path).map_err(bad)?;
    let spec = reader.spec();
    let channels = usize::from(spec.channels.max(1));
    if f64::from(reader.duration()) / f64::from(spec.sample_rate.max(1)) > MAX_SECONDS {
        return Err(AppError::invalid("this file is longer than an hour"));
    }
    let interleaved: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .into_samples::<f32>()
            .collect::<Result<_, _>>()
            .map_err(bad)?,
        hound::SampleFormat::Int => {
            let scale = 1.0 / (1u64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .into_samples::<i32>()
                .map(|s| s.map(|v| v as f32 * scale))
                .collect::<Result<_, _>>()
                .map_err(bad)?
        }
    };
    let mono = interleaved
        .chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect();
    Ok((mono, spec.sample_rate))
}

/// The text the example prints.
pub fn render(name: &str, summary: &Summary) -> String {
    let mut out = String::new();
    let _ = writeln!(
        out,
        "{name}: {} Hz, {:.1} s",
        summary.sample_rate, summary.seconds
    );
    let _ = writeln!(
        out,
        "frames: {}, voiced: {} ({:.0}%)",
        summary.frames,
        summary.voiced_frames,
        summary.voiced_share() * 100.0
    );
    match summary.median_f0 {
        Some(f0) => {
            let _ = writeln!(out, "median f0: {f0:.1} Hz");
        }
        None => {
            let _ = writeln!(out, "median f0: none (no voiced frames)");
        }
    }
    let _ = writeln!(out, "f0 per second:");
    for (second, f0) in summary.per_second.iter().enumerate() {
        match f0 {
            Some(f0) => {
                let _ = writeln!(out, "  {second:>4} s  {f0:.1} Hz");
            }
            None => {
                let _ = writeln!(out, "  {second:>4} s  -");
            }
        }
    }
    out
}

/// Analyse one file and return the report.
pub fn analyze_file(path: &Path) -> AppResult<String> {
    let (samples, sample_rate) = read_wav_mono(path)?;
    let name = path
        .file_name()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
    Ok(render(&name, &summarize(&samples, sample_rate)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::testsig::{cents, sine};
    use crate::error::ErrorKind;
    use tempfile::tempdir;

    fn write_wav(path: &Path, spec: hound::WavSpec, samples: &[f32]) {
        let mut w = hound::WavWriter::create(path, spec).unwrap();
        for &s in samples {
            for _ in 0..spec.channels {
                match spec.sample_format {
                    hound::SampleFormat::Float => w.write_sample(s).unwrap(),
                    hound::SampleFormat::Int => {
                        let max = (1i64 << (spec.bits_per_sample - 1)) - 1;
                        w.write_sample((f64::from(s) * max as f64) as i32).unwrap();
                    }
                }
            }
        }
        w.finalize().unwrap();
    }

    fn spec(channels: u16, rate: u32, bits: u16, format: hound::SampleFormat) -> hound::WavSpec {
        hound::WavSpec {
            channels,
            sample_rate: rate,
            bits_per_sample: bits,
            sample_format: format,
        }
    }

    #[test]
    fn a_generated_tone_reads_back_its_pitch_every_second() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("tone.wav");
        let tone = sine(220.0, 48_000, 48_000 * 3, 0.5, 0.0);
        write_wav(&path, spec(1, 48_000, 16, hound::SampleFormat::Int), &tone);

        let (samples, rate) = read_wav_mono(&path).unwrap();
        let summary = summarize(&samples, rate);

        assert_eq!(rate, 48_000);
        assert!(cents(summary.median_f0.unwrap(), 220.0).abs() < 5.0);
        assert!(summary.voiced_share() > 0.95, "{}", summary.voiced_share());
        assert_eq!(summary.per_second.len(), 3);
        for f0 in &summary.per_second {
            assert!(cents(f0.unwrap(), 220.0).abs() < 5.0);
        }
    }

    #[test]
    fn silence_then_voice_shows_in_the_per_second_list_and_the_share() {
        let mut signal = vec![0.0f32; 44_100 * 2];
        signal.extend(sine(150.0, 44_100, 44_100 * 2, 0.4, 0.0));
        let dir = tempdir().unwrap();
        let path = dir.path().join("half.wav");
        write_wav(
            &path,
            spec(2, 44_100, 32, hound::SampleFormat::Float),
            &signal,
        );

        let (samples, rate) = read_wav_mono(&path).unwrap();
        let summary = summarize(&samples, rate);

        // second 1 holds the switch, so only the clear seconds are checked
        assert_eq!(summary.per_second[0], None);
        assert!(cents(summary.per_second[3].unwrap(), 150.0).abs() < 5.0);
        let share = summary.voiced_share();
        assert!((0.4..0.6).contains(&share), "{share}");
    }

    #[test]
    fn a_sliver_of_voice_at_the_edge_does_not_make_a_second_voiced() {
        let mut signal = vec![0.0f32; 48_000 * 2];
        signal.extend(sine(200.0, 48_000, 1_440, 0.4, 0.0)); // 30 ms
        signal.extend(vec![0.0f32; 48_000 / 2]);

        let summary = summarize(&signal, 48_000);

        assert_eq!(summary.per_second, vec![None, None, None]);
    }

    #[test]
    fn a_24_bit_file_is_read_at_the_right_level() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("deep.wav");
        let tone = sine(300.0, 48_000, 48_000, 0.25, 0.0);
        write_wav(&path, spec(1, 48_000, 24, hound::SampleFormat::Int), &tone);

        let (samples, _) = read_wav_mono(&path).unwrap();

        let peak = samples.iter().fold(0.0f32, |m, s| m.max(s.abs()));
        assert!((peak - 0.25).abs() < 0.001, "{peak}");
    }

    #[test]
    fn the_report_has_the_median_the_share_and_each_second() {
        let summary = Summary {
            sample_rate: 48_000,
            seconds: 2.0,
            frames: 10,
            voiced_frames: 5,
            median_f0: Some(180.25),
            per_second: vec![Some(180.0), None],
        };

        let text = render("me.wav", &summary);

        assert!(text.contains("me.wav: 48000 Hz, 2.0 s"), "{text}");
        assert!(text.contains("voiced: 5 (50%)"), "{text}");
        assert!(text.contains("median f0: 180.2 Hz") || text.contains("median f0: 180.3 Hz"));
        assert!(text.contains("   0 s  180.0 Hz"), "{text}");
        assert!(text.contains("   1 s  -"), "{text}");
    }

    #[test]
    fn a_missing_or_broken_file_is_an_error_not_a_crash() {
        let dir = tempdir().unwrap();
        let broken = dir.path().join("broken.wav");
        std::fs::write(&broken, b"this is not a wav file at all").unwrap();

        let missing = analyze_file(&dir.path().join("nope.wav")).unwrap_err();
        let garbage = analyze_file(&broken).unwrap_err();

        assert_eq!(missing.kind(), ErrorKind::InvalidInput);
        assert_eq!(garbage.kind(), ErrorKind::InvalidInput);
    }

    #[test]
    fn an_empty_recording_has_no_pitch_and_no_division_by_zero() {
        let summary = summarize(&[], 48_000);

        assert_eq!(summary.median_f0, None);
        assert_eq!(summary.voiced_share(), 0.0);
        assert!(summary.per_second.is_empty());
    }
}
