//! The live pitch stream: microphone -> ring buffer -> worker -> `pitch` events.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use cpal::traits::DeviceTrait;
use cpal::{Stream, StreamError};
use ringbuf::traits::{Consumer, Split};
use ringbuf::{HeapCons, HeapRb};
use serde::Serialize;

use super::capture::{
    Capture, Link, MonoSink, Opened, START_TIMEOUT, build_input_stream, open_input_device, play,
    spawn_capture, stream_error_handler, take_dropped,
};
use super::{AudioSource, Report, StreamInfo};
use crate::dsp::{self, Analyzer};
use crate::error::AppResult;

/// How much audio the ring holds if the worker stalls.
const RING_SECONDS: usize = 2;
/// How much unread audio the worker catches up on frame by frame. A pause this short is made
/// good in a burst, losing nothing. More than this means analysis is slower than the
/// microphone, and the display would fall ever further behind: the oldest audio is dropped.
const MAX_BACKLOG: Duration = Duration::from_millis(150);
/// How long the worker sleeps when the ring is empty; the callback wakes it.
const IDLE_WAIT: Duration = Duration::from_millis(50);
const SCRATCH_SAMPLES: usize = 4096;

/// One analysed hop, as the webview receives it in the `pitch` event.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PitchFrame {
    /// Milliseconds from the start of the stream to the end of this window,
    /// counted from samples, not from the clock.
    pub t_ms: f64,
    pub f0: f32,
    pub rms: f32,
    /// Largest absolute sample in the newest hop.
    pub peak: f32,
    pub centroid: f32,
}

/// Cuts a mono sample stream into overlapping windows and analyses each.
pub struct Pipeline {
    analyzer: Analyzer,
    sample_rate: u32,
    window: usize,
    hop: usize,
    buf: Vec<f32>,
    /// Samples since the start of the stream that are no longer in `buf`.
    consumed: u64,
}

impl Pipeline {
    pub fn new(sample_rate: u32) -> Self {
        let window = dsp::window_len(sample_rate);
        Self {
            analyzer: Analyzer::new(sample_rate),
            sample_rate,
            window,
            hop: dsp::hop_len(sample_rate),
            buf: Vec::with_capacity(window * 2),
            consumed: 0,
        }
    }

    /// Add samples; call `emit` for every window that is now complete.
    pub fn push(&mut self, samples: &[f32], emit: &mut impl FnMut(PitchFrame)) {
        self.buf.extend_from_slice(samples);
        while self.buf.len() >= self.window {
            emit(self.analyze_front());
            self.buf.drain(..self.hop);
            self.consumed += self.hop as u64;
        }
    }

    fn analyze_front(&mut self) -> PitchFrame {
        let window = &self.buf[..self.window];
        let analysis = self.analyzer.analyze(window);
        let end = self.consumed + self.window as u64;
        PitchFrame {
            t_ms: end as f64 * 1000.0 / f64::from(self.sample_rate),
            f0: analysis.f0,
            rms: analysis.rms,
            peak: peak(&window[self.window - self.hop..]),
            centroid: analysis.centroid,
        }
    }

    /// Unread samples above which the worker drops the oldest ones, see `MAX_BACKLOG`.
    fn backlog_limit(&self) -> usize {
        (f64::from(self.sample_rate) * MAX_BACKLOG.as_secs_f64()) as usize
    }

    /// The callback had to drop `lost` samples. Windows spanning the gap
    /// would be garbage, so start fresh after it and keep the clock honest.
    pub fn skip(&mut self, lost: u64) {
        self.consumed += self.buf.len() as u64 + lost;
        self.buf.clear();
    }
}

fn peak(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0, |m, s| m.max(s.abs()))
}

/// Move what is waiting in the ring through the pipeline. Returns how many
/// samples were read.
pub fn drain_once<C: Consumer<Item = f32>>(
    ring: &mut C,
    scratch: &mut [f32],
    dropped: &AtomicU64,
    pipeline: &mut Pipeline,
    emit: &mut impl FnMut(PitchFrame),
) -> usize {
    if ring.occupied_len() > pipeline.backlog_limit() {
        // Keep the newest window: its frame is the one the display is waiting for.
        let dropped_here = ring.skip(ring.occupied_len() - pipeline.window);
        pipeline.skip(dropped_here as u64);
    }
    let read = ring.pop_slice(scratch);
    if read > 0 {
        pipeline.push(&scratch[..read], emit);
    }
    let lost = take_dropped(dropped);
    if lost > 0 {
        pipeline.skip(lost);
    }
    read
}

/// What the worker needs once the stream is playing.
pub struct Job {
    ring: HeapCons<f32>,
    dropped: Arc<AtomicU64>,
    pipeline: Pipeline,
}

fn run(job: Job, running: &AtomicBool, mut emit: impl FnMut(PitchFrame)) {
    let Job {
        mut ring,
        dropped,
        mut pipeline,
    } = job;
    let mut scratch = vec![0.0; SCRATCH_SAMPLES];
    while running.load(Ordering::SeqCst) {
        if drain_once(&mut ring, &mut scratch, &dropped, &mut pipeline, &mut emit) == 0 {
            thread::park_timeout(IDLE_WAIT);
        }
    }
}

fn stream_errors(
    report: Report,
    failed: Arc<AtomicBool>,
) -> impl FnMut(StreamError) + Send + 'static {
    stream_error_handler(report, failed, AudioSource::Pitch)
}

/// Open the microphone and have it playing.
fn open(
    requested: Option<&str>,
    report: Report,
    failed: Arc<AtomicBool>,
) -> AppResult<Opened<Stream, StreamInfo, Job>> {
    let input = open_input_device(requested)?;
    let sample_rate = input.config.sample_rate().0;
    let channels = usize::from(input.config.channels());
    let ring_len = sample_rate as usize * RING_SECONDS;
    let (producer, consumer) = HeapRb::<f32>::new(ring_len).split();
    let (link, dropped) = Link::new(thread::current());
    let sink = MonoSink {
        ring: producer,
        channels,
        link,
    };
    let stream = build_input_stream(
        &input.device,
        &input.config,
        sink,
        stream_errors(report, failed),
    )?;
    play(&stream)?;
    Ok(Opened {
        guard: stream,
        info: StreamInfo {
            sample_rate,
            device: input.device.name().unwrap_or(input.choice.name),
            fell_back: input.choice.fell_back,
        },
        job: Job {
            ring: consumer,
            dropped,
            pipeline: Pipeline::new(sample_rate),
        },
    })
}

/// Can a running stream serve this request? Only if its thread is still
/// there, no stream error was seen, and it was opened for the same device
/// (`None` and an empty name both mean the default).
pub fn can_reuse(
    opened_for: Option<&str>,
    requested: Option<&str>,
    finished: bool,
    failed: bool,
) -> bool {
    fn named(name: Option<&str>) -> Option<&str> {
        name.filter(|n| !n.is_empty())
    }
    !finished && !failed && named(opened_for) == named(requested)
}

/// A running pitch stream.
pub struct PitchSession {
    capture: Capture<()>,
    info: StreamInfo,
    opened_for: Option<String>,
    failed: Arc<AtomicBool>,
}

impl PitchSession {
    pub fn info(&self) -> &StreamInfo {
        &self.info
    }

    /// Whether this session can answer a `start_pitch` for `requested`
    /// instead of opening a new stream.
    pub fn can_serve(&self, requested: Option<&str>) -> bool {
        can_reuse(
            self.opened_for.as_deref(),
            requested,
            self.capture.is_finished(),
            self.failed.load(Ordering::SeqCst),
        )
    }

    pub fn stop(self) {
        // The worker returns nothing; a failed join only means it was
        // already gone.
        let _ = self.capture.stop();
    }
}

/// Start the stream. Returns once it is playing, or with the real error.
pub fn start(
    requested: Option<String>,
    emit: impl FnMut(PitchFrame) + Send + 'static,
    report: Report,
) -> AppResult<PitchSession> {
    let failed = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&failed);
    let device = requested.clone();
    start_with(
        requested,
        failed,
        move || open(device.as_deref(), report, flag),
        emit,
        START_TIMEOUT,
    )
}

fn start_with<G: 'static>(
    opened_for: Option<String>,
    failed: Arc<AtomicBool>,
    open: impl FnOnce() -> AppResult<Opened<G, StreamInfo, Job>> + Send + 'static,
    emit: impl FnMut(PitchFrame) + Send + 'static,
    timeout: Duration,
) -> AppResult<PitchSession> {
    let (capture, info) = spawn_capture(
        open,
        move |job, running| run(job, running, emit),
        |_| (),
        timeout,
    )?;
    Ok(PitchSession {
        capture,
        info,
        opened_for,
        failed,
    })
}

/// A session whose worker is stuck in `emit` until `release` is set, like a
/// driver call that does not return. For tests of the callers.
#[cfg(test)]
pub(super) fn stuck_session(release: Arc<AtomicBool>) -> PitchSession {
    use ringbuf::traits::Producer;
    let (mut tx, rx) = HeapRb::<f32>::new(8192).split();
    tx.push_slice(&[0.0; 4096]);
    let job = Job {
        ring: rx,
        dropped: Arc::default(),
        pipeline: Pipeline::new(48_000),
    };
    let info = StreamInfo {
        sample_rate: 48_000,
        device: "stuck".into(),
        fell_back: false,
    };
    let stuck = move |_| {
        while !release.load(Ordering::SeqCst) {
            thread::sleep(Duration::from_millis(5));
        }
    };
    let opened = Opened {
        guard: (),
        info,
        job,
    };
    match start_with(
        None,
        Arc::default(),
        move || Ok(opened),
        stuck,
        START_TIMEOUT,
    ) {
        Ok(session) => session,
        Err(e) => panic!("fake session did not start: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::{AudioErrorKind, AudioIssue};
    use crate::dsp::testsig::{cents, sine};
    use ringbuf::HeapRb;
    use ringbuf::traits::{Observer, Producer, Split};
    use std::sync::atomic::Ordering;

    const SR: u32 = 48_000;

    fn frames_of(pipeline: &mut Pipeline, signal: &[f32], chunk: usize) -> Vec<PitchFrame> {
        let mut out = Vec::new();
        for part in signal.chunks(chunk) {
            pipeline.push(part, &mut |f| out.push(f));
        }
        out
    }

    #[test]
    fn a_stream_that_dies_says_it_came_from_the_pitch_stream() {
        let seen = Arc::new(std::sync::Mutex::new(Vec::<AudioIssue>::new()));
        let sink = Arc::clone(&seen);
        let report: Report = Arc::new(move |issue| sink.lock().unwrap().push(issue));
        let mut on_error = stream_errors(report, Arc::default());

        on_error(cpal::StreamError::DeviceNotAvailable);

        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].source, AudioSource::Pitch);
        assert_eq!(seen[0].kind, AudioErrorKind::DeviceLost);
    }

    #[test]
    fn one_second_gives_the_expected_hop_count_and_times_from_samples() {
        let signal = sine(220.0, SR, SR as usize, 0.5, 0.0);
        let mut pipeline = Pipeline::new(SR);

        let frames = frames_of(&mut pipeline, &signal, 1000);

        // window 2048, hop 1024: (48000 - 2048) / 1024 = 44.9 -> 45 frames
        assert_eq!(frames.len(), 45);
        let hop_ms = 1024.0 * 1000.0 / f64::from(SR);
        assert!((frames[0].t_ms - 2048.0 * 1000.0 / f64::from(SR)).abs() < 1e-9);
        for pair in frames.windows(2) {
            assert!((pair[1].t_ms - pair[0].t_ms - hop_ms).abs() < 1e-9);
        }
    }

    #[test]
    fn frames_carry_the_pitch_and_do_not_depend_on_chunk_size() {
        let signal = sine(220.0, SR, 20_000, 0.5, 0.0);

        let whole = frames_of(&mut Pipeline::new(SR), &signal, signal.len());
        let pieces = frames_of(&mut Pipeline::new(SR), &signal, 333);

        assert_eq!(whole, pieces);
        assert!(cents(whole[3].f0, 220.0).abs() < 5.0, "{}", whole[3].f0);
        assert!(whole[3].centroid > 0.0);
        assert!((whole[3].rms - 0.5 / 2f32.sqrt()).abs() < 0.01);
    }

    #[test]
    fn hop_counts_follow_the_device_rate() {
        let at_96k = frames_of(&mut Pipeline::new(96_000), &vec![0.0; 96_000], 4096);
        let at_44k = frames_of(&mut Pipeline::new(44_100), &vec![0.0; 44_100], 4096);

        // window 4096 / hop 2048 at 96 kHz; 2048 / 1024 at 44.1 kHz
        assert_eq!(at_96k.len(), (96_000 - 4096) / 2048 + 1);
        assert_eq!(at_44k.len(), (44_100 - 2048) / 1024 + 1);
    }

    #[test]
    fn peak_is_from_the_newest_hop_only() {
        let mut signal = vec![0.0f32; 2048];
        signal[100] = 0.9; // old half of the window
        signal[1500] = 0.4; // newest hop

        let frames = frames_of(&mut Pipeline::new(SR), &signal, 2048);

        assert_eq!(frames.len(), 1);
        assert!((frames[0].peak - 0.4).abs() < 1e-6);
    }

    #[test]
    fn silence_is_zero_everywhere() {
        let frames = frames_of(&mut Pipeline::new(SR), &vec![0.0; 4096], 4096);

        assert!(frames.iter().all(|f| f.f0 == 0.0 && f.centroid == 0.0));
        assert!(frames.iter().all(|f| f.rms == 0.0 && f.peak == 0.0));
    }

    #[test]
    fn a_gap_moves_the_clock_by_what_was_lost() {
        let mut pipeline = Pipeline::new(SR);
        let first = frames_of(&mut pipeline, &vec![0.0; 2048], 2048);
        assert_eq!(first.len(), 1);

        // 1024 samples were still waiting for the next window, 500 were lost.
        pipeline.skip(500);
        let next = frames_of(&mut pipeline, &vec![0.0; 2048], 2048);

        let expected = (1024 + 1024 + 500 + 2048) as f64 * 1000.0 / f64::from(SR);
        assert_eq!(next.len(), 1);
        assert!((next[0].t_ms - expected).abs() < 1e-9, "{}", next[0].t_ms);
    }

    fn ring(capacity: usize) -> (ringbuf::HeapProd<f32>, ringbuf::HeapCons<f32>) {
        HeapRb::<f32>::new(capacity).split()
    }

    #[test]
    fn drain_once_reads_the_ring_and_emits_frames() {
        let (mut tx, mut rx) = ring(8192);
        tx.push_slice(&sine(220.0, SR, 4096, 0.5, 0.0));
        let dropped = AtomicU64::new(0);
        let mut scratch = vec![0.0; 1024];
        let mut pipeline = Pipeline::new(SR);
        let mut out = Vec::new();

        let mut read = 0;
        loop {
            let n = drain_once(&mut rx, &mut scratch, &dropped, &mut pipeline, &mut |f| {
                out.push(f)
            });
            if n == 0 {
                break;
            }
            read += n;
        }

        assert_eq!(read, 4096);
        assert_eq!(out.len(), 3);
    }

    #[test]
    fn samples_the_callback_dropped_show_up_in_the_clock() {
        let (mut tx, mut rx) = ring(64);
        let dropped = AtomicU64::new(0);
        // The callback tried to push 100 samples into a ring that holds 64.
        let pushed = tx.push_slice(&vec![0.1; 100]);
        dropped.fetch_add((100 - pushed) as u64, Ordering::Relaxed);
        assert_eq!(pushed, 64);
        let mut scratch = vec![0.0; 256];
        let mut pipeline = Pipeline::new(SR);

        drain_once(&mut rx, &mut scratch, &dropped, &mut pipeline, &mut |_| {});
        let mut out = Vec::new();
        pipeline.push(&vec![0.0; 2048], &mut |f| out.push(f));

        // 64 read, then the gap of 36, then a full window
        let expected = (64 + 36 + 2048) as f64 * 1000.0 / f64::from(SR);
        assert!((out[0].t_ms - expected).abs() < 1e-9, "{}", out[0].t_ms);
        assert_eq!(dropped.load(Ordering::Relaxed), 0, "counter was taken");
    }

    #[test]
    fn a_second_of_audio_is_analysed_in_well_under_a_second_even_in_a_dev_build() {
        // `tauri dev` builds without release optimisation. Analysis that needs most of a hop
        // there leaves no room for a slower laptop, and the trace trails the voice.
        let signal = sine(220.0, SR, SR as usize, 0.5, 0.0);
        let mut pipeline = Pipeline::new(SR);
        let started = std::time::Instant::now();

        let frames = frames_of(&mut pipeline, &signal, 480).len();

        let took = started.elapsed();
        assert_eq!(frames, 45);
        assert!(
            took < Duration::from_millis(300),
            "{took:?} for 1 s of audio"
        );
    }

    // ----- the worker keeps up with a microphone that never waits -----

    const CHUNK_MS: f64 = 10.0;

    /// Feeds `seconds` of a tone at the microphone's pace in 10 ms callbacks, through the real
    /// `drain_once`, on a virtual clock. Every emitted frame costs the worker `cost_ms`.
    /// Returns (end of window in the stream, ms until the frame was emitted) for each frame.
    fn feed_at_real_time(cost_ms: f64, seconds: f64) -> Vec<(f64, f64)> {
        let chunk = (f64::from(SR) * CHUNK_MS / 1000.0) as usize;
        let chunks = (seconds * 1000.0 / CHUNK_MS) as usize;
        let tone = sine(220.0, SR, chunk, 0.5, 0.0);
        let (mut tx, mut rx) = ring(SR as usize * RING_SECONDS);
        let dropped = AtomicU64::new(0);
        let mut scratch = vec![0.0; SCRATCH_SAMPLES];
        let mut pipeline = Pipeline::new(SR);
        let mut lags = Vec::new();
        let mut arrived = 0;
        let mut now = 0.0;
        while arrived < chunks || !rx.is_empty() {
            while arrived < chunks && (arrived + 1) as f64 * CHUNK_MS <= now {
                let lost = chunk - tx.push_slice(&tone);
                dropped.fetch_add(lost as u64, Ordering::Relaxed);
                arrived += 1;
            }
            if rx.is_empty() {
                now = (arrived + 1) as f64 * CHUNK_MS;
                continue;
            }
            drain_once(&mut rx, &mut scratch, &dropped, &mut pipeline, &mut |f| {
                now += cost_ms;
                lags.push((f.t_ms, now - f.t_ms));
            });
        }
        lags
    }

    fn worst_lag_after(frames: &[(f64, f64)], from_ms: f64) -> f64 {
        frames
            .iter()
            .filter(|(t, _)| *t >= from_ms)
            .fold(0.0, |worst, (_, lag)| f64::max(worst, *lag))
    }

    #[test]
    fn a_worker_that_keeps_up_shows_each_frame_within_one_callback_of_its_last_sample() {
        let frames = feed_at_real_time(5.0, 2.0);

        // 5 ms of work per 21 ms hop, plus up to one 10 ms callback of waiting for the sample.
        assert!(worst_lag_after(&frames, 0.0) <= 20.0);
        assert_eq!(frames.len(), (2 * SR as usize - 2048) / 1024 + 1);
    }

    #[test]
    fn a_worker_slower_than_the_microphone_stays_close_behind_instead_of_falling_further() {
        // 30 ms of work for every 21 ms hop: 140% load, like analysis in an unoptimised build.
        let frames = feed_at_real_time(30.0, 5.0);

        let late = worst_lag_after(&frames, 2_000.0);
        assert!(
            late <= 250.0,
            "after 2 s the display was {late:.0} ms behind"
        );
    }

    #[test]
    fn a_pause_of_the_worker_is_caught_up_without_losing_audio() {
        let (mut tx, mut rx) = ring(SR as usize * RING_SECONDS);
        let dropped = AtomicU64::new(0);
        let mut scratch = vec![0.0; SCRATCH_SAMPLES];
        let mut pipeline = Pipeline::new(SR);
        let mut out = Vec::new();
        // The worker was not scheduled for 100 ms: 4800 samples wait.
        tx.push_slice(&sine(220.0, SR, 4800, 0.5, 0.0));

        while drain_once(&mut rx, &mut scratch, &dropped, &mut pipeline, &mut |f| {
            out.push(f)
        }) > 0
        {}

        assert_eq!(out.len(), (4800 - 2048) / 1024 + 1);
        let hop_ms = 1024.0 * 1000.0 / f64::from(SR);
        for pair in out.windows(2) {
            assert!((pair[1].t_ms - pair[0].t_ms - hop_ms).abs() < 1e-9, "a gap");
        }
    }

    struct FakeStream(Arc<AtomicBool>);

    impl Drop for FakeStream {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    #[test]
    fn a_started_session_streams_frames_and_stop_releases_the_stream() {
        let (mut tx, rx) = ring(SR as usize * 2);
        tx.push_slice(&sine(220.0, SR, SR as usize, 0.5, 0.0));
        let released = Arc::new(AtomicBool::new(false));
        let guard = FakeStream(Arc::clone(&released));
        let info = StreamInfo {
            sample_rate: SR,
            device: "fake".into(),
            fell_back: true,
        };
        let (frames_tx, frames_rx) = std::sync::mpsc::channel();
        let job = Job {
            ring: rx,
            dropped: Arc::new(AtomicU64::new(0)),
            pipeline: Pipeline::new(SR),
        };

        let session = start_with(
            None,
            Arc::default(),
            move || Ok(Opened { guard, info, job }),
            move |f| {
                let _ = frames_tx.send(f);
            },
            Duration::from_secs(2),
        )
        .unwrap();

        assert_eq!(session.info().device, "fake");
        assert!(session.info().fell_back);
        let first = frames_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(cents(first.f0, 220.0).abs() < 5.0);
        session.stop();
        assert!(released.load(Ordering::SeqCst));
    }

    // ----- when a running stream may be reused -----

    #[test]
    fn a_healthy_stream_for_the_same_device_is_reused() {
        assert!(can_reuse(None, None, false, false));
        assert!(can_reuse(Some("USB Mic"), Some("USB Mic"), false, false));
        assert!(
            can_reuse(None, Some(""), false, false),
            "empty means default"
        );
    }

    #[test]
    fn a_dead_failed_or_mismatched_stream_is_not_reused() {
        assert!(!can_reuse(None, None, true, false), "thread ended");
        assert!(!can_reuse(None, None, false, true), "stream error seen");
        assert!(
            !can_reuse(Some("A"), Some("B"), false, false),
            "other device"
        );
        assert!(
            !can_reuse(None, Some("B"), false, false),
            "default -> named"
        );
        assert!(
            !can_reuse(Some("A"), None, false, false),
            "named -> default"
        );
    }

    fn fake_job(frames: usize) -> Job {
        let (mut tx, rx) = ring(frames);
        tx.push_slice(&vec![0.0; frames]);
        Job {
            ring: rx,
            dropped: Arc::new(AtomicU64::new(0)),
            pipeline: Pipeline::new(SR),
        }
    }

    fn info() -> StreamInfo {
        StreamInfo {
            sample_rate: SR,
            device: "fake".into(),
            fell_back: false,
        }
    }

    #[test]
    fn a_session_knows_when_its_worker_has_died() {
        let job = fake_job(8192);
        let session = start_with(
            None,
            Arc::default(),
            move || {
                Ok(Opened {
                    guard: (),
                    info: info(),
                    job,
                })
            },
            |_| panic!("emit blew up"),
            Duration::from_secs(2),
        )
        .unwrap();

        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while session.can_serve(None) && std::time::Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }

        assert!(!session.can_serve(None));
    }

    #[test]
    fn a_session_whose_stream_reported_an_error_is_not_served_again() {
        let failed = Arc::new(AtomicBool::new(false));
        let session = start_with(
            Some("USB Mic".into()),
            Arc::clone(&failed),
            move || {
                Ok(Opened {
                    guard: (),
                    info: info(),
                    job: fake_job(16),
                })
            },
            |_| (),
            Duration::from_secs(2),
        )
        .unwrap();
        assert!(session.can_serve(Some("USB Mic")));
        assert!(!session.can_serve(None));

        failed.store(true, Ordering::SeqCst);

        assert!(!session.can_serve(Some("USB Mic")));
    }
}
