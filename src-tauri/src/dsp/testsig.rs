//! Test-only signal generators with a known fundamental.
use std::f64::consts::PI;

/// Formants as (centre Hz, bandwidth Hz, gain).
pub type Formants = &'static [(f64, f64, f64)];

pub const AH: Formants = &[
    (730.0, 90.0, 1.0),
    (1090.0, 110.0, 0.5),
    (2440.0, 170.0, 0.25),
];
pub const EE: Formants = &[
    (270.0, 60.0, 1.0),
    (2290.0, 100.0, 0.4),
    (3010.0, 150.0, 0.2),
];
pub const OO: Formants = &[(300.0, 60.0, 1.0), (870.0, 80.0, 0.4), (2240.0, 150.0, 0.1)];

pub fn cents(measured: f32, expected: f32) -> f32 {
    1200.0 * (measured / expected).log2()
}

pub fn sine(hz: f64, sr: u32, len: usize, amp: f64, phase: f64) -> Vec<f32> {
    (0..len)
        .map(|i| (amp * (2.0 * PI * hz * i as f64 / f64::from(sr) + phase).sin()) as f32)
        .collect()
}

/// Twelve harmonics falling at 1/k^2.
pub fn harmonic(hz: f64, sr: u32, len: usize, phase: f64) -> Vec<f32> {
    (0..len)
        .map(|i| {
            let t = i as f64 / f64::from(sr);
            let sum: f64 = (1..=12)
                .map(|k| {
                    let k = f64::from(k);
                    (2.0 * PI * k * hz * t + phase * k).sin() / (k * k)
                })
                .sum();
            (0.2 * sum) as f32
        })
        .collect()
}

/// One glottal pulse: position in samples (fractional) and strength.
type Pulse = (f64, f64);

/// Pulses through a one-pole low-pass and the formant resonators, then the last `len`
/// samples scaled to a peak of 0.3. Pulse positions are split between the two nearest
/// samples so high pitches at low sample rates carry no rounding jitter.
fn render_vowel(
    pulses: &[Pulse],
    total: usize,
    sr: u32,
    formants: Formants,
    len: usize,
) -> Vec<f32> {
    let srf = f64::from(sr);
    let mut src = vec![0.0f64; total + 1];
    for &(pos, amp) in pulses {
        let (i, frac) = (pos as usize, pos.fract());
        if i < total {
            src[i] += amp * (1.0 - frac);
            src[i + 1] += amp * frac;
        }
    }
    let mut lowpass = 0.0;
    for v in &mut src {
        lowpass = 0.95 * lowpass + *v;
        *v = lowpass;
    }
    let mut out = vec![0.0f64; total + 1];
    for &(centre, bandwidth, gain) in formants {
        let r = (-PI * bandwidth / srf).exp();
        let a1 = 2.0 * r * (2.0 * PI * centre / srf).cos();
        let a2 = -r * r;
        let (mut y1, mut y2) = (0.0, 0.0);
        for (o, s) in out.iter_mut().zip(&src) {
            let y = s + a1 * y1 + a2 * y2;
            y2 = y1;
            y1 = y;
            *o += gain * y;
        }
    }
    let window = &out[total - len..total];
    let peak = window.iter().fold(0.0f64, |m, v| m.max(v.abs()));
    window.iter().map(|v| (0.3 * v / peak) as f32).collect()
}

/// Settling time before the window starts, in samples.
fn lead_in(sr: u32) -> usize {
    sr as usize / 5
}

/// Impulse train through formant resonators: a synthetic vowel with no jitter.
/// `offset` slides the window along the signal so the glottal pulses land differently.
pub fn vowel(hz: f64, sr: u32, len: usize, formants: Formants, offset: usize) -> Vec<f32> {
    let total = len + lead_in(sr) + offset;
    let period = f64::from(sr) / hz;
    let pulses: Vec<Pulse> = (0..)
        .map(|k| (f64::from(k) * period, 1.0))
        .take_while(|&(pos, _)| pos < total as f64)
        .collect();
    render_vowel(&pulses, total, sr, formants, len)
}

/// Irregular voice: every other pulse scaled by `alternate` (1.0 = regular), and each
/// period varied by `jitter`, the mean relative difference between consecutive periods
/// (0.04 = 4%). Periods are uniform, so the mean period stays 1 / `hz`.
pub fn vowel_irregular(
    hz: f64,
    sr: u32,
    len: usize,
    formants: Formants,
    (alternate, jitter): (f64, f64),
    seed: u64,
) -> Vec<f32> {
    let total = len + lead_in(sr);
    let period = f64::from(sr) / hz;
    // uniform on [-a, a]: mean |difference of two draws| is 2a/3
    let spread = 1.5 * jitter;
    let draws = white_noise_seeded(total, 1.0, seed);
    let mut pulses = Vec::new();
    let (mut pos, mut k) = (0.0f64, 0usize);
    while pos < total as f64 {
        let amp = if k % 2 == 0 { 1.0 } else { alternate };
        pulses.push((pos, amp));
        pos += period * (1.0 + spread * f64::from(draws[k]));
        k += 1;
    }
    render_vowel(&pulses, total, sr, formants, len)
}

/// Deterministic white noise in [-amp, amp].
pub fn white_noise(len: usize, amp: f32) -> Vec<f32> {
    white_noise_seeded(len, amp, 0x2545_F491_4F6C_DD1D)
}

pub fn white_noise_seeded(len: usize, amp: f32, seed: u64) -> Vec<f32> {
    let mut state = seed;
    (0..len)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            amp * ((state >> 40) as f32 / (1u64 << 23) as f32 - 1.0)
        })
        .collect()
}

/// A vowel with a slow vibrato, `len` samples long. `vibrato_cents` is the peak deviation
/// at 5 Hz (0 for a steady voice). Also returns the true fundamental in Hz for each
/// `window`-sample frame hopped by `hop`: the geometric mean of the f0 inside the frame.
pub fn vowel_track(
    hz: f64,
    sr: u32,
    len: usize,
    formants: Formants,
    vibrato_cents: f64,
    (window, hop): (usize, usize),
) -> (Vec<f32>, Vec<f64>) {
    let srf = f64::from(sr);
    let f0_at = |t: f64| hz * 2f64.powf(vibrato_cents * (2.0 * PI * 5.0 * t).sin() / 1200.0);
    let lead = lead_in(sr);
    let total = len + lead;
    let mut pulses = Vec::new();
    let mut t = 0.0f64;
    while (t as usize) < total {
        pulses.push((t, 1.0));
        t += srf / f0_at((t - lead as f64) / srf);
    }
    let signal = render_vowel(&pulses, total, sr, formants, len);
    let truth = frame_truth(&f0_at, sr, len, (window, hop));
    (signal, truth)
}

/// Geometric-mean f0 of each frame, given the f0 at time `t` seconds.
fn frame_truth(
    f0_at: &dyn Fn(f64) -> f64,
    sr: u32,
    len: usize,
    (window, hop): (usize, usize),
) -> Vec<f64> {
    (0..=(len - window) / hop)
        .map(|f| {
            let start = f * hop;
            let mean_log: f64 = (start..start + window)
                .map(|i| f0_at(i as f64 / f64::from(sr)).ln())
                .sum::<f64>()
                / window as f64;
            mean_log.exp()
        })
        .collect()
}

/// Twelve-harmonic stack gliding from `hz` at `octaves_per_s`, with the true f0 per frame.
pub fn glide(
    hz: f64,
    sr: u32,
    len: usize,
    octaves_per_s: f64,
    frames: (usize, usize),
) -> (Vec<f32>, Vec<f64>) {
    let f0_at = |t: f64| hz * 2f64.powf(octaves_per_s * t);
    // phase = 2 pi * integral of f0
    let phase_at = |t: f64| {
        2.0 * PI * hz * (2f64.powf(octaves_per_s * t) - 1.0)
            / (octaves_per_s * std::f64::consts::LN_2)
    };
    let signal = (0..len)
        .map(|i| {
            let phase = phase_at(i as f64 / f64::from(sr));
            let sum: f64 = (1..=12)
                .map(|k| (f64::from(k) * phase).sin() / f64::from(k * k))
                .sum();
            (0.2 * sum) as f32
        })
        .collect();
    (signal, frame_truth(&f0_at, sr, len, frames))
}

/// `signal` plus white noise at `snr_db` below its RMS.
pub fn with_noise(signal: &[f32], snr_db: f32, seed: u64) -> Vec<f32> {
    let rms = (signal.iter().map(|x| x * x).sum::<f32>() / signal.len() as f32).sqrt();
    let noise_rms = rms / 10f32.powf(snr_db / 20.0);
    // uniform in [-a, a] has RMS a / sqrt(3)
    let noise = white_noise_seeded(signal.len(), noise_rms * 3f32.sqrt(), seed);
    signal.iter().zip(&noise).map(|(s, n)| s + n).collect()
}
