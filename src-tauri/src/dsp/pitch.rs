//! Pitch detection (YIN).

/// Lowest fundamental searched for.
pub const MIN_HZ: f32 = 60.0;
/// Highest fundamental searched for.
pub const MAX_HZ: f32 = 1000.0;
/// First dip of the normalised difference under this counts as the period.
const DIP_THRESHOLD: f32 = 0.15;
/// A rough voice (jitter, uneven pulses) has no dip this clear. When none is found, the
/// first dip under this is taken. White noise never gets under 0.70, breathy voice at
/// 10 dB SNR stays under 0.11, 4% jitter at 165 Hz keeps over 85% of frames under it.
const ROUGH_DIP_THRESHOLD: f32 = 0.45;
/// A dip at half the period under this beats the period found: every other glottal
/// pulse is weak and the real period is half as long. Measured near half the period:
/// clean "ee" at 130 Hz (second harmonic on the first formant) 0.21 or more, the other
/// clean table signals 0.35 or more, "ah" at 165 Hz with alternate pulses at 0.6 under
/// 0.19. Nothing between them can be told apart; weaker alternation stays an octave low.
const HALF_PERIOD_THRESHOLD: f32 = 0.20;
/// Sample rates above this are reduced before the search; pitch lives far below.
const WORKING_RATE: u32 = 48_000;

/// Fundamental frequency of `buffer` in Hz, or 0.0 when no clear period is found.
///
/// Searches 60 to 1000 Hz at any sample rate. Returns 0.0 for silence, noise, tones
/// above 1000 Hz and buffers too short to hold two periods of the lowest pitch.
pub fn yin(buffer: &[f32], sample_rate: u32) -> f32 {
    let factor = sample_rate.div_ceil(WORKING_RATE).max(1);
    if factor == 1 {
        return yin_at(buffer, sample_rate);
    }
    yin_at(&decimate(buffer, factor as usize), sample_rate / factor)
}

/// Mean of each run of `factor` samples: a box low-pass and a stride in one pass.
fn decimate(buffer: &[f32], factor: usize) -> Vec<f32> {
    buffer
        .chunks_exact(factor)
        .map(|run| run.iter().sum::<f32>() / factor as f32)
        .collect()
}

fn yin_at(buffer: &[f32], sample_rate: u32) -> f32 {
    let n = buffer.len();
    let rate = sample_rate as f32;
    let tau_min = ((rate / MAX_HZ) as usize).max(2);
    let tau_max = ((rate / MIN_HZ) as usize).min(n / 2);
    if tau_min + 2 >= tau_max {
        return 0.0;
    }

    let cmnd = normalised_difference(buffer, tau_max);

    let Some(mut tau) = dip_bottom(&cmnd, tau_min, tau_max, DIP_THRESHOLD, false)
        .or_else(|| dip_bottom(&cmnd, tau_min, tau_max, ROUGH_DIP_THRESHOLD, true))
    else {
        return 0.0;
    };
    // The dip may be a multiple of a period shorter than the search allows: a tone above
    // 1000 Hz has a dip at every multiple of its period, and the first one in range is
    // not its pitch.
    if repeats_faster_than_range(&cmnd, tau, tau_min) {
        return 0.0;
    }
    // A dip at half the period beats the one found: weak alternate pulses.
    while let Some(half) = dip_near_half(&cmnd, tau) {
        if half < tau_min {
            return 0.0;
        }
        tau = half;
    }

    rate / (tau as f32 + parabolic_shift(cmnd[tau - 1], cmnd[tau], cmnd[tau + 1]))
}

/// Lowest point of the first dip under `threshold` in `tau_min..tau_max`, or None.
/// The first sample under the threshold is on the way down: take the bottom of the whole
/// dip, not the first local ripple, which noise makes a few samples early.
/// With `needs_rise`, a dip that is already under the threshold at the start of the
/// range is skipped: that is a slow drift, not a period.
fn dip_bottom(
    cmnd: &[f32],
    tau_min: usize,
    tau_max: usize,
    threshold: f32,
    needs_rise: bool,
) -> Option<usize> {
    let start = (tau_min..tau_max).find(|&t| cmnd[t] < threshold)?;
    if needs_rise && cmnd[start - 1] < threshold {
        return None;
    }
    let mut bottom = start;
    let mut t = start;
    while t + 1 < tau_max && cmnd[t + 1] < threshold {
        t += 1;
        if cmnd[t] < cmnd[bottom] {
            bottom = t;
        }
    }
    Some(bottom)
}

/// True when `tau / k` for some k in 2 to 8 falls below `tau_min` and is a clear dip.
fn repeats_faster_than_range(cmnd: &[f32], tau: usize, tau_min: usize) -> bool {
    (2..=8).any(|k| {
        let centre = tau / k;
        if centre < 2 || centre >= tau_min {
            return false;
        }
        (centre - 1..=centre + 1).any(|t| cmnd[t] < DIP_THRESHOLD)
    })
}

/// Lag of a dip under `HALF_PERIOD_THRESHOLD` close to `tau / 2`, if there is one.
fn dip_near_half(cmnd: &[f32], tau: usize) -> Option<usize> {
    let centre = tau / 2;
    let reach = 2;
    let low = centre.saturating_sub(reach).max(1);
    let high = (centre + reach).min(tau - 1);
    let mut best = (low..=high).min_by(|&a, &b| cmnd[a].total_cmp(&cmnd[b]))?;
    if cmnd[best] >= HALF_PERIOD_THRESHOLD {
        return None;
    }
    // slide to the true bottom if the window cut the dip
    while best > 1 && cmnd[best - 1] < cmnd[best] {
        best -= 1;
    }
    while best + 1 < tau && cmnd[best + 1] < cmnd[best] {
        best += 1;
    }
    Some(best)
}

/// Offset in samples of the parabola vertex through three neighbouring points.
fn parabolic_shift(prev: f32, cur: f32, next: f32) -> f32 {
    let curvature = prev - 2.0 * cur + next;
    if curvature.abs() > 1e-9 {
        (0.5 * (prev - next) / curvature).clamp(-1.0, 1.0)
    } else {
        0.0
    }
}

/// YIN steps 2 and 3: squared difference per lag, then cumulative mean normalised.
/// Index 0 and lags with no energy stay at 1.0 (no evidence of a period).
fn normalised_difference(buffer: &[f32], tau_max: usize) -> Vec<f32> {
    let n = buffer.len();
    let mut cmnd = vec![1.0f32; tau_max + 1];
    let mut running = 0.0f32;
    for tau in 1..=tau_max {
        let diff: f32 = (0..n - tau)
            .map(|i| (buffer[i] - buffer[i + tau]).powi(2))
            .sum();
        running += diff;
        if running > 0.0 {
            cmnd[tau] = diff * tau as f32 / running;
        }
    }
    cmnd
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsp::testsig::{self, AH, EE, OO};
    use crate::dsp::window_len;

    const RATES: [u32; 5] = [8_000, 44_100, 48_000, 96_000, 192_000];
    const PITCHES: [f64; 6] = [100.0, 130.0, 165.0, 200.0, 255.0, 400.0];
    const PHASES: usize = 4;

    /// Worst error in cents over every pitch, sample rate and phase.
    fn worst_cents(make: impl Fn(f64, u32, usize, usize) -> Vec<f32>) -> f32 {
        let mut worst = 0.0f32;
        for sr in RATES {
            for hz in PITCHES {
                for phase in 0..PHASES {
                    let frame = make(hz, sr, window_len(sr), phase);
                    let f0 = yin(&frame, sr);
                    assert!(
                        f0 > 0.0,
                        "no pitch found at {hz} Hz, {sr} Hz rate, phase {phase}"
                    );
                    let err = testsig::cents(f0, hz as f32).abs();
                    assert!(err <= 5.0, "{hz} Hz at {sr}: read {f0}, {err:.1} cents off");
                    worst = worst.max(err);
                }
            }
        }
        worst
    }

    fn phase_of(phase: usize) -> f64 {
        phase as f64 * std::f64::consts::PI / PHASES as f64
    }

    #[test]
    fn silence_returns_zero() {
        assert_eq!(yin(&vec![0.0f32; 2048], 44_100), 0.0);
    }

    #[test]
    fn sine_is_within_5_cents() {
        worst_cents(|hz, sr, n, p| testsig::sine(hz, sr, n, 0.3, phase_of(p)));
    }

    #[test]
    fn harmonic_stack_is_within_5_cents() {
        worst_cents(|hz, sr, n, p| testsig::harmonic(hz, sr, n, phase_of(p)));
    }

    #[test]
    fn vowel_oo_is_within_5_cents() {
        worst_cents(|hz, sr, n, p| testsig::vowel(hz, sr, n, OO, p * 37));
    }

    #[test]
    fn vowel_ah_is_within_5_cents() {
        worst_cents(|hz, sr, n, p| testsig::vowel(hz, sr, n, AH, p * 37));
    }

    #[test]
    fn vowel_ee_is_within_5_cents() {
        worst_cents(|hz, sr, n, p| testsig::vowel(hz, sr, n, EE, p * 37));
    }

    #[test]
    fn white_noise_has_no_pitch() {
        for sr in RATES {
            let noise = testsig::white_noise(window_len(sr), 0.3);
            assert_eq!(yin(&noise, sr), 0.0, "noise read as a pitch at {sr}");
        }
    }

    #[test]
    fn range_is_60_to_1000_hz_at_any_rate() {
        for sr in RATES {
            let n = window_len(sr);
            for hz in [70.0, 900.0] {
                let f0 = yin(&testsig::sine(hz, sr, n, 0.3, 0.0), sr);
                // 900 Hz is nine samples per period at 8 kHz
                let allowed = if sr < 16_000 { 15.0 } else { 5.0 };
                assert!(
                    testsig::cents(f0, hz as f32).abs() <= allowed,
                    "{hz} Hz at {sr}: {f0}"
                );
            }
        }
    }

    /// Voiced share and worst error in cents over sliding frames of breathy vowels
    /// ("ah" and "oo", 165/200/255 Hz, steady and with a 30 cent vibrato at 5 Hz).
    /// Truth for a frame is the mean f0 inside it.
    fn breathy_run(snr_db: f32) -> (f32, f32) {
        let (mut frames, mut voiced, mut worst) = (0usize, 0usize, 0.0f32);
        for sr in [44_100, 48_000, 96_000] {
            let (n, hop) = (window_len(sr), crate::dsp::hop_len(sr));
            for formants in [AH, OO] {
                for hz in [165.0, 200.0, 255.0] {
                    for vibrato in [0.0, 30.0] {
                        let len = sr as usize * 2 / 5;
                        let (clean, truth) =
                            testsig::vowel_track(hz, sr, len, formants, vibrato, (n, hop));
                        let noisy = testsig::with_noise(&clean, snr_db, 7);
                        for (k, expect) in truth.iter().enumerate() {
                            frames += 1;
                            let f0 = yin(&noisy[k * hop..k * hop + n], sr);
                            if f0 > 0.0 {
                                voiced += 1;
                                worst = worst.max(testsig::cents(f0, *expect as f32).abs());
                            }
                        }
                    }
                }
            }
        }
        (voiced as f32 / frames as f32, worst)
    }

    #[test]
    fn breathy_voice_at_20_db_stays_voiced_and_accurate() {
        let (share, worst) = breathy_run(20.0);
        assert!(share >= 0.9, "voiced share {share}");
        assert!(worst <= 15.0, "worst {worst} cents");
    }

    #[test]
    fn breathy_voice_at_15_db_stays_voiced_and_accurate() {
        let (share, worst) = breathy_run(15.0);
        assert!(share >= 0.9, "voiced share {share}");
        assert!(worst <= 15.0, "worst {worst} cents");
    }

    #[test]
    fn white_noise_has_no_pitch_for_any_seed() {
        for sr in RATES {
            for seed in 1..=20 {
                let noise = testsig::white_noise_seeded(window_len(sr), 0.3, seed);
                assert_eq!(yin(&noise, sr), 0.0, "seed {seed} read as a pitch at {sr}");
            }
        }
    }

    fn read_frames(signal: &[f32], sr: u32) -> Vec<f32> {
        let (n, hop) = (window_len(sr), crate::dsp::hop_len(sr));
        (0..=(signal.len() - n) / hop)
            .map(|k| yin(&signal[k * hop..k * hop + n], sr))
            .collect()
    }

    fn voiced_share(reads: &[f32]) -> f32 {
        reads.iter().filter(|&&f| f > 0.0).count() as f32 / reads.len() as f32
    }

    fn worst_cents_of(reads: &[f32], truth: f32) -> f32 {
        reads
            .iter()
            .filter(|&&f| f > 0.0)
            .map(|&f| testsig::cents(f, truth).abs())
            .fold(0.0, f32::max)
    }

    /// Every other glottal pulse weakened to 0.6: the true period is half of what a plain
    /// first-dip search finds. See `HALF_PERIOD_THRESHOLD` for why only this case is fixed.
    #[test]
    fn weak_alternate_pulses_at_0_6_read_the_true_pitch() {
        for sr in [44_100, 48_000, 96_000, 192_000] {
            let v = testsig::vowel_irregular(165.0, sr, sr as usize / 2, AH, (0.6, 0.0), 1);
            let reads = read_frames(&v, sr);
            assert_eq!(voiced_share(&reads), 1.0, "{sr}");
            let worst = worst_cents_of(&reads, 165.0);
            assert!(worst <= 10.0, "{sr}: {worst:.1} cents off, {reads:?}");
        }
    }

    /// Jitter is the mean relative difference between consecutive periods. At 4% a plain
    /// first-dip search lost about 40% of the frames. The rough-voice fallback finds most of
    /// them, but a few land on a multiple of the period: the test allows 15% of them.
    #[test]
    fn four_percent_jitter_is_mostly_voiced_and_mostly_on_pitch() {
        let sr = 48_000;
        for (name, formants) in [("ah", AH), ("oo", OO), ("ee", EE)] {
            for seed in 1..=3 {
                let v =
                    testsig::vowel_irregular(165.0, sr, sr as usize, formants, (1.0, 0.04), seed);
                let reads = read_frames(&v, sr);
                let share = voiced_share(&reads);
                assert!(share >= 0.8, "{name} seed {seed}: voiced {share}");
                let voiced: Vec<f32> = reads.iter().copied().filter(|&f| f > 0.0).collect();
                let near = voiced
                    .iter()
                    .filter(|&&f| testsig::cents(f, 165.0).abs() <= 100.0)
                    .count();
                assert!(
                    near as f32 >= 0.85 * voiced.len() as f32,
                    "{name} seed {seed}: {near} of {} within a semitone",
                    voiced.len()
                );
            }
        }
    }

    #[test]
    fn above_1000_hz_reads_zero_instead_of_folding_down() {
        for sr in RATES {
            if sr < 16_000 {
                continue;
            }
            for hz in [1100.0, 1300.0, 1500.0, 2000.0, 3000.0] {
                let n = window_len(sr);
                let f0 = yin(&testsig::sine(hz, sr, n, 0.3, 0.0), sr);
                assert_eq!(f0, 0.0, "{hz} Hz at {sr} read as {f0}");
                let f0 = yin(&testsig::harmonic(hz, sr, n, 0.0), sr);
                assert_eq!(f0, 0.0, "stack at {hz} Hz at {sr} read as {f0}");
            }
        }
    }

    #[test]
    fn parabola_shift_points_at_the_lower_neighbour_and_stays_within_one_sample() {
        assert_eq!(parabolic_shift(1.0, 0.5, 1.0), 0.0);
        assert!((parabolic_shift(0.9, 0.5, 1.0) + 0.05 / 0.9).abs() < 1e-6);
        assert!((parabolic_shift(1.0, 0.5, 0.9) - 0.05 / 0.9).abs() < 1e-6);
        // almost flat bottom: the raw vertex is 1.5 samples away
        assert_eq!(parabolic_shift(0.60, 0.5, 0.45), 1.0);
        assert_eq!(parabolic_shift(0.45, 0.5, 0.60), -1.0);
        assert_eq!(parabolic_shift(0.5, 0.5, 0.5), 0.0);
    }

    #[test]
    fn short_buffers_never_give_a_negative_or_wild_pitch() {
        for sr in [8_000, 48_000, 192_000] {
            for len in (0..300).chain([500, 700, 1000, 3000]) {
                for hz in [60.0, 100.0, 165.0, 400.0, 990.0] {
                    for f0 in [
                        yin(&testsig::sine(hz, sr, len, 0.3, 0.0), sr),
                        yin(&testsig::harmonic(hz, sr, len, 0.0), sr),
                    ] {
                        assert!(
                            f0 == 0.0 || (50.0..=1100.0).contains(&f0),
                            "{hz} Hz, {len} samples, {sr}: {f0}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn nan_and_infinite_input_read_as_no_pitch() {
        for sr in [8_000, 48_000, 192_000] {
            let n = window_len(sr);
            assert_eq!(yin(&vec![f32::NAN; n], sr), 0.0);
            assert_eq!(yin(&vec![f32::INFINITY; n], sr), 0.0);
            let mut tone = testsig::sine(165.0, sr, n, 0.3, 0.0);
            tone[n / 2] = f32::NAN;
            let f0 = yin(&tone, sr);
            assert!(f0 == 0.0 || f0.is_finite() && f0 > 0.0, "{f0}");
        }
    }

    /// One octave per second: the pitch moves 50 cents inside one 43 ms window, so the
    /// reading is judged against the mean pitch in the window.
    #[test]
    fn one_octave_per_second_glide_is_tracked() {
        for sr in [8_000, 48_000, 192_000] {
            let (n, hop) = (window_len(sr), crate::dsp::hop_len(sr));
            let len = sr as usize * 9 / 10;
            let (signal, truth) = testsig::glide(130.0, sr, len, 1.0, (n, hop));
            let reads = read_frames(&signal, sr);
            assert_eq!(reads.len(), truth.len());
            assert_eq!(voiced_share(&reads), 1.0, "{sr}");
            for (k, (f0, expect)) in reads.iter().zip(&truth).enumerate() {
                let err = testsig::cents(*f0, *expect as f32).abs();
                assert!(
                    err <= 15.0,
                    "{sr} frame {k}: read {f0}, true {expect}, {err:.1} cents"
                );
            }
        }
    }
}
