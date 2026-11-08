//! Spectral centroid.
use std::f32::consts::PI;
use std::sync::Arc;

use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};

/// Only bins from this frequency up count: below it is hum and rumble.
const BAND_LOW_HZ: f32 = 100.0;
/// Only bins up to this frequency count: above it is hiss.
const BAND_HIGH_HZ: f32 = 5000.0;

/// Spectral centroid of fixed-length frames. Plans the FFT once and reuses its buffers.
pub struct Centroid {
    len: usize,
    fft: Arc<dyn Fft<f32>>,
    hann: Vec<f32>,
    work: Vec<Complex<f32>>,
    scratch: Vec<Complex<f32>>,
}

impl Centroid {
    pub fn new(len: usize) -> Self {
        let fft = FftPlanner::new().plan_fft_forward(len.max(1));
        let hann = (0..len)
            .map(|i| 0.5 - 0.5 * (2.0 * PI * i as f32 / len as f32).cos())
            .collect();
        Self {
            len,
            hann,
            work: vec![Complex::new(0.0, 0.0); len],
            scratch: vec![Complex::new(0.0, 0.0); fft.get_inplace_scratch_len()],
            fft,
        }
    }

    /// Magnitude-weighted mean frequency in Hz over 100 to 5000 Hz, after removing
    /// the DC offset and applying a Hann window. 0.0 when the band has no energy
    /// or `frame` is not the length this was planned for.
    pub fn compute(&mut self, frame: &[f32], sample_rate: u32) -> f32 {
        if self.len == 0 || frame.len() != self.len {
            return 0.0;
        }
        let mean = frame.iter().sum::<f32>() / self.len as f32;
        for ((out, &x), &w) in self.work.iter_mut().zip(frame).zip(&self.hann) {
            *out = Complex::new((x - mean) * w, 0.0);
        }
        self.fft
            .process_with_scratch(&mut self.work, &mut self.scratch);

        let bin_hz = sample_rate as f32 / self.len as f32;
        let first = (BAND_LOW_HZ / bin_hz).ceil() as usize;
        let last = ((BAND_HIGH_HZ / bin_hz) as usize).min(self.len / 2);
        let (mut weighted, mut total) = (0.0f32, 0.0f32);
        for (bin, c) in self.work.iter().enumerate().take(last + 1).skip(first) {
            let mag = c.norm();
            weighted += bin as f32 * bin_hz * mag;
            total += mag;
        }
        if total > 0.0 { weighted / total } else { 0.0 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::testsig;

    const N: usize = 2048;

    #[test]
    fn pure_1khz_tone_reads_within_2_percent() {
        for sr in [44_100, 48_000, 96_000] {
            let n = crate::dsp::window_len(sr);
            let tone = testsig::sine(1000.0, sr, n, 0.3, 0.0);
            let c = Centroid::new(n).compute(&tone, sr);
            assert!((c - 1000.0).abs() <= 20.0, "{sr}: centroid {c}");
        }
    }

    #[test]
    fn dc_offset_does_not_pull_it_down() {
        let tone: Vec<f32> = testsig::sine(1000.0, 48_000, N, 0.3, 0.0)
            .iter()
            .map(|x| x + 0.2)
            .collect();
        let c = Centroid::new(N).compute(&tone, 48_000);
        assert!((c - 1000.0).abs() <= 20.0, "centroid {c}");
    }

    #[test]
    fn rumble_below_100_hz_is_ignored() {
        let tone = testsig::sine(1000.0, 48_000, N, 0.3, 0.0);
        let rumble = testsig::sine(50.0, 48_000, N, 0.3, 0.0);
        let mixed: Vec<f32> = tone.iter().zip(&rumble).map(|(a, b)| a + b).collect();
        let c = Centroid::new(N).compute(&mixed, 48_000);
        assert!((c - 1000.0).abs() <= 20.0, "centroid {c}");
    }

    #[test]
    fn silence_and_wrong_length_read_zero() {
        let mut centroid = Centroid::new(N);
        assert_eq!(centroid.compute(&vec![0.0; N], 48_000), 0.0);
        assert_eq!(centroid.compute(&[0.1; 100], 48_000), 0.0);
        assert_eq!(Centroid::new(0).compute(&[], 48_000), 0.0);
    }
}
