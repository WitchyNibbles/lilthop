//! Pure signal processing. No Tauri, no I/O.

pub mod pitch;
pub mod spectrum;
#[cfg(test)]
pub(crate) mod testsig;

/// Frames quieter than this (about -50 dBFS) are treated as silence.
pub const VOLUME_GATE: f32 = 0.003;

/// Analysis window: the next power of two at or above 40 ms of samples.
pub fn window_len(sample_rate: u32) -> usize {
    ((f64::from(sample_rate) * 0.04).ceil() as usize).next_power_of_two()
}

/// Samples between the starts of two consecutive windows.
pub fn hop_len(sample_rate: u32) -> usize {
    window_len(sample_rate) / 2
}

/// Root mean square of a frame, 0.0 when empty or when any sample is NaN or infinite.
pub fn rms(frame: &[f32]) -> f32 {
    if frame.is_empty() {
        return 0.0;
    }
    let value = (frame.iter().map(|x| x * x).sum::<f32>() / frame.len() as f32).sqrt();
    if value.is_finite() { value } else { 0.0 }
}

/// What one window of audio says.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Analysis {
    /// Hz, 0.0 when unvoiced or below the volume gate.
    pub f0: f32,
    /// Hz, 0.0 when below the volume gate.
    pub centroid: f32,
    pub rms: f32,
}

/// Runs pitch and spectrum analysis on windows of `window_len(sample_rate)` samples.
pub struct Analyzer {
    sample_rate: u32,
    centroid: spectrum::Centroid,
}

impl Analyzer {
    pub fn new(sample_rate: u32) -> Self {
        Self {
            sample_rate,
            centroid: spectrum::Centroid::new(window_len(sample_rate)),
        }
    }

    pub fn analyze(&mut self, window: &[f32]) -> Analysis {
        let rms = rms(window);
        if rms < VOLUME_GATE {
            return Analysis {
                f0: 0.0,
                centroid: 0.0,
                rms,
            };
        }
        Analysis {
            f0: pitch::yin(window, self.sample_rate),
            centroid: self.centroid.compute(window, self.sample_rate),
            rms,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_is_40ms_rounded_up_to_a_power_of_two() {
        assert_eq!(window_len(44_100), 2048);
        assert_eq!(window_len(48_000), 2048);
        assert_eq!(window_len(96_000), 4096);
        assert_eq!(hop_len(48_000), 1024);
    }

    #[test]
    fn quiet_hum_under_the_gate_reads_zero() {
        let mut analyzer = Analyzer::new(48_000);
        let hum = testsig::sine(60.0, 48_000, window_len(48_000), 0.0005, 0.0);
        let got = analyzer.analyze(&hum);
        assert_eq!((got.f0, got.centroid), (0.0, 0.0));
        assert!(got.rms > 0.0);
    }

    #[test]
    fn the_gate_is_what_silences_a_quiet_tone() {
        let n = window_len(48_000);
        let quiet = testsig::sine(80.0, 48_000, n, 0.0005, 0.0);
        assert!(
            pitch::yin(&quiet, 48_000) > 0.0,
            "tone must be findable without the gate"
        );
        assert_eq!(Analyzer::new(48_000).analyze(&quiet).f0, 0.0);
    }

    #[test]
    fn a_voice_level_tone_passes_the_gate() {
        let tone = testsig::sine(165.0, 48_000, window_len(48_000), 0.05, 0.0);
        let got = Analyzer::new(48_000).analyze(&tone);
        assert!((got.f0 - 165.0).abs() < 1.0, "f0 {}", got.f0);
        assert!(got.centroid > 100.0);
        assert!((got.rms - 0.05 / 2f32.sqrt()).abs() < 0.001);
    }

    #[test]
    fn rms_of_empty_frame_is_zero() {
        assert_eq!(rms(&[]), 0.0);
    }

    #[test]
    fn rms_of_non_finite_input_is_zero_not_nan() {
        assert_eq!(rms(&[0.1, f32::NAN, 0.1]), 0.0);
        assert_eq!(rms(&[f32::INFINITY, 0.1]), 0.0);
        assert_eq!(rms(&[f32::NEG_INFINITY; 4]), 0.0);
    }

    #[test]
    fn a_window_with_nan_reads_as_silence() {
        let mut tone = testsig::sine(165.0, 48_000, window_len(48_000), 0.3, 0.0);
        tone[100] = f32::NAN;
        let got = Analyzer::new(48_000).analyze(&tone);
        assert_eq!(
            got,
            Analysis {
                f0: 0.0,
                centroid: 0.0,
                rms: 0.0
            }
        );
    }
}
