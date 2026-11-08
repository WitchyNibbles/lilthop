//! What the pitch stream and the recorder share: picking a device, turning
//! whatever sample format the device speaks into `f32` or `i16`, handing
//! samples from the audio callback to a worker, and running that worker.
//!
//! The audio callback must not allocate or block. It writes into a ring
//! buffer made up front; if the worker falls behind, samples are dropped and
//! counted. The worker is woken with `unpark`.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, mpsc};
use std::thread::{self, JoinHandle, Thread};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{
    BuildStreamError, FromSample, Sample, SampleFormat, SizedSample, Stream, StreamConfig,
    StreamError, SupportedStreamConfig,
};
use ringbuf::traits::Producer;

use super::{AudioErrorKind, AudioIssue, AudioSource, Report};
use crate::error::{AppError, AppResult, ErrorKind};

/// How long `start` waits for the worker to say the stream is playing.
pub const START_TIMEOUT: Duration = Duration::from_secs(5);

// ---------- sample formats ----------

/// A sample the device may hand us, readable as `f32` or `i16`.
pub trait InputSample: SizedSample + Copy + Send + 'static {
    fn to_f32(self) -> f32;
    fn to_i16(self) -> i16;
}

impl<T> InputSample for T
where
    T: SizedSample + Copy + Send + 'static,
    f32: FromSample<T>,
    i16: FromSample<T>,
{
    fn to_f32(self) -> f32 {
        f32::from_sample(self)
    }

    fn to_i16(self) -> i16 {
        i16::from_sample(self)
    }
}

/// Average the channels of each frame and push the result. Returns how many
/// frames did not fit.
pub fn push_mono<T: InputSample, P: Producer<Item = f32>>(
    ring: &mut P,
    data: &[T],
    channels: usize,
) -> usize {
    let channels = channels.max(1);
    let frames = data.len() / channels;
    let scale = 1.0 / channels as f32;
    let pushed = ring.push_iter(
        data.chunks_exact(channels)
            .map(|frame| frame.iter().map(|s| s.to_f32()).sum::<f32>() * scale),
    );
    frames - pushed
}

/// One frame as a single 16-bit sample. A mono device skips the float trip.
fn frame_to_i16<T: InputSample>(frame: &[T], scale: f32) -> i16 {
    match frame {
        [only] => only.to_i16(),
        _ => (frame.iter().map(|s| s.to_f32()).sum::<f32>() * scale).to_i16(),
    }
}

/// Mix the channels of each frame down to one 16-bit sample and push it.
/// Voice needs one channel; a multichannel interface would otherwise fill the
/// disk and the WAV size limit several times faster. Returns how many frames
/// did not fit.
pub fn push_pcm<T: InputSample, P: Producer<Item = i16>>(
    ring: &mut P,
    data: &[T],
    channels: usize,
) -> usize {
    let channels = channels.max(1);
    let frames = data.len() / channels;
    let scale = 1.0 / channels as f32;
    let pushed = ring.push_iter(
        data.chunks_exact(channels)
            .map(|frame| frame_to_i16(frame, scale)),
    );
    frames - pushed
}

// ---------- the callback side ----------

/// What the audio callback shares with its worker.
pub struct Link {
    dropped: Arc<AtomicU64>,
    wake: Thread,
}

impl Link {
    /// Returns the callback's end and the counter the worker reads.
    pub fn new(wake: Thread) -> (Self, Arc<AtomicU64>) {
        let dropped = Arc::new(AtomicU64::new(0));
        let link = Self {
            dropped: Arc::clone(&dropped),
            wake,
        };
        (link, dropped)
    }

    /// Count what did not fit and wake the worker. Cheap, never blocks.
    pub fn hand_over(&self, dropped: usize) {
        if dropped > 0 {
            self.dropped.fetch_add(dropped as u64, Ordering::Relaxed);
        }
        self.wake.unpark();
    }
}

/// Take and reset the number of samples the callback had to drop.
pub fn take_dropped(counter: &AtomicU64) -> u64 {
    counter.swap(0, Ordering::Relaxed)
}

/// The audio callback's body, for any sample format.
pub trait SampleSink: Send + 'static {
    fn push<T: InputSample>(&mut self, data: &[T]);
}

/// Mono `f32` for analysis.
pub struct MonoSink<P> {
    pub ring: P,
    pub channels: usize,
    pub link: Link,
}

impl<P: Producer<Item = f32> + Send + 'static> SampleSink for MonoSink<P> {
    fn push<T: InputSample>(&mut self, data: &[T]) {
        let dropped = push_mono(&mut self.ring, data, self.channels);
        self.link.hand_over(dropped);
    }
}

/// Mono 16-bit for the WAV file.
pub struct PcmSink<P> {
    pub ring: P,
    pub channels: usize,
    pub link: Link,
}

impl<P: Producer<Item = i16> + Send + 'static> SampleSink for PcmSink<P> {
    fn push<T: InputSample>(&mut self, data: &[T]) {
        let dropped = push_pcm(&mut self.ring, data, self.channels);
        self.link.hand_over(dropped);
    }
}

// ---------- errors ----------

pub fn device_lost(message: impl Into<String>) -> AppError {
    AppError::new(ErrorKind::DeviceLost, message)
}

pub fn stream_failed(message: impl Into<String>) -> AppError {
    AppError::new(ErrorKind::StreamFailed, message)
}

/// What to tell the person when the running stream reports an error.
pub fn issue_from_stream_error(error: &StreamError, source: AudioSource) -> AudioIssue {
    match error {
        StreamError::DeviceNotAvailable => AudioIssue::new(
            source,
            AudioErrorKind::DeviceLost,
            "the microphone is no longer available",
        ),
        other => AudioIssue::new(source, AudioErrorKind::StreamFailed, other.to_string()),
    }
}

/// cpal's error callback can fire again and again once a device is gone;
/// report the first one only. Every error sets `failed`, so a later start
/// can tell this stream is dead.
pub fn stream_error_handler(
    report: Report,
    failed: Arc<AtomicBool>,
    source: AudioSource,
) -> impl FnMut(StreamError) + Send + 'static {
    let mut reported = false;
    move |error| {
        failed.store(true, Ordering::SeqCst);
        if !reported {
            reported = true;
            report(issue_from_stream_error(&error, source));
        }
    }
}

fn error_from_build(error: &BuildStreamError) -> AppError {
    match error {
        BuildStreamError::DeviceNotAvailable => device_lost("the microphone is not available"),
        other => stream_failed(other.to_string()),
    }
}

// ---------- picking a device ----------

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceChoice {
    pub name: String,
    pub fell_back: bool,
}

/// Which device to open, from names only. The requested one if it is there;
/// otherwise the system default, then any device, with `fell_back` set.
/// `None` when there is no device at all.
pub fn choose_device(
    requested: Option<&str>,
    available: &[String],
    default: Option<&str>,
) -> Option<DeviceChoice> {
    let requested = requested.filter(|r| !r.is_empty());
    if let Some(name) = requested.filter(|r| available.iter().any(|a| a == r)) {
        return Some(DeviceChoice {
            name: name.to_owned(),
            fell_back: false,
        });
    }
    let fallback = default.or_else(|| available.first().map(String::as_str))?;
    Some(DeviceChoice {
        name: fallback.to_owned(),
        fell_back: requested.is_some(),
    })
}

pub struct InputDevice {
    pub device: cpal::Device,
    pub config: SupportedStreamConfig,
    pub choice: DeviceChoice,
}

/// Names of all input devices, for the settings list.
pub fn input_device_names() -> Vec<String> {
    let host = cpal::default_host();
    host.input_devices()
        .map(|devices| devices.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default()
}

/// Find the device (or fall back, see `choose_device`) and read its config.
pub fn open_input_device(requested: Option<&str>) -> AppResult<InputDevice> {
    let host = cpal::default_host();
    let named: Vec<(String, cpal::Device)> = host
        .input_devices()
        .map_err(|e| stream_failed(e.to_string()))?
        .filter_map(|d| d.name().ok().map(|n| (n, d)))
        .collect();
    let names: Vec<String> = named.iter().map(|(n, _)| n.clone()).collect();
    let default = host.default_input_device();
    let default_name = default.as_ref().and_then(|d| d.name().ok());
    let choice = choose_device(requested, &names, default_name.as_deref())
        .ok_or_else(|| device_lost("no microphone was found"))?;
    let device = named
        .into_iter()
        .find_map(|(n, d)| (n == choice.name).then_some(d))
        .or(default)
        .ok_or_else(|| device_lost("no microphone was found"))?;
    let config = device
        .default_input_config()
        .map_err(|e| stream_failed(e.to_string()))?;
    Ok(InputDevice {
        device,
        config,
        choice,
    })
}

// ---------- building the stream ----------

fn build<T: InputSample, S: SampleSink>(
    device: &cpal::Device,
    config: &StreamConfig,
    mut sink: S,
    on_error: impl FnMut(StreamError) + Send + 'static,
) -> Result<Stream, BuildStreamError> {
    device.build_input_stream(config, move |data: &[T], _| sink.push(data), on_error, None)
}

/// One builder for every sample format the device may use. The stream is
/// built, not started.
pub fn build_input_stream<S: SampleSink>(
    device: &cpal::Device,
    config: &SupportedStreamConfig,
    sink: S,
    on_error: impl FnMut(StreamError) + Send + 'static,
) -> AppResult<Stream> {
    let cfg = config.config();
    let built = match config.sample_format() {
        SampleFormat::F32 => build::<f32, S>(device, &cfg, sink, on_error),
        SampleFormat::F64 => build::<f64, S>(device, &cfg, sink, on_error),
        SampleFormat::I16 => build::<i16, S>(device, &cfg, sink, on_error),
        SampleFormat::I32 => build::<i32, S>(device, &cfg, sink, on_error),
        SampleFormat::I8 => build::<i8, S>(device, &cfg, sink, on_error),
        SampleFormat::U16 => build::<u16, S>(device, &cfg, sink, on_error),
        SampleFormat::U32 => build::<u32, S>(device, &cfg, sink, on_error),
        SampleFormat::U8 => build::<u8, S>(device, &cfg, sink, on_error),
        other => {
            return Err(stream_failed(format!(
                "the microphone uses a sample format this app cannot read ({other})"
            )));
        }
    };
    built.map_err(|e| error_from_build(&e))
}

/// Start the stream, or say why not.
pub fn play(stream: &Stream) -> AppResult<()> {
    stream.play().map_err(|e| stream_failed(e.to_string()))
}

// ---------- the worker thread ----------

/// What a worker's `open` step hands back once the stream is playing.
pub struct Opened<G, I, J> {
    /// The live stream. Kept on the worker thread and dropped when it ends.
    pub guard: G,
    /// What the caller of `spawn_capture` gets back.
    pub info: I,
    /// What the work loop needs.
    pub job: J,
}

/// How long stopping waits for the worker before leaving it behind. A driver
/// call that never returns must not stop the app from closing.
pub const STOP_TIMEOUT: Duration = Duration::from_secs(3);
const JOIN_POLL: Duration = Duration::from_millis(5);

/// Join a thread, but give up at the deadline. The thread is left running
/// (detached) if it has not finished by then.
pub fn join_within<T>(handle: JoinHandle<T>, deadline: Duration) -> Option<thread::Result<T>> {
    let give_up = Instant::now() + deadline;
    while !handle.is_finished() {
        if Instant::now() >= give_up {
            return None;
        }
        thread::sleep(JOIN_POLL);
    }
    Some(handle.join())
}

/// A running worker. Dropping it stops the thread and waits a bounded time.
pub struct Capture<R> {
    running: Arc<AtomicBool>,
    thread: Option<JoinHandle<Option<R>>>,
}

impl<R> Capture<R> {
    fn signal_stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(thread) = &self.thread {
            thread.thread().unpark();
        }
    }

    /// True once the worker thread has ended, by itself or by a panic.
    pub fn is_finished(&self) -> bool {
        self.thread.as_ref().is_none_or(JoinHandle::is_finished)
    }

    /// Stop the worker, wait for it, and return what its loop returned.
    pub fn stop(self) -> AppResult<R> {
        self.stop_within(STOP_TIMEOUT)
    }

    pub fn stop_within(mut self, deadline: Duration) -> AppResult<R> {
        self.signal_stop();
        let thread = self
            .thread
            .take()
            .ok_or_else(|| stream_failed("the audio thread was already stopped"))?;
        match join_within(thread, deadline) {
            Some(Ok(Some(result))) => Ok(result),
            Some(Ok(None)) => Err(stream_failed("the audio thread never started")),
            Some(Err(_)) => Err(stream_failed("the audio thread stopped unexpectedly")),
            None => Err(stream_failed("the audio thread did not stop in time")),
        }
    }

    /// Tell the worker to end but do not wait: for a start that timed out,
    /// where the thread may still be stuck opening the device.
    fn abandon(mut self) {
        self.signal_stop();
        self.thread.take();
    }
}

impl<R> Drop for Capture<R> {
    fn drop(&mut self) {
        self.signal_stop();
        if let Some(thread) = self.thread.take() {
            let _ = join_within(thread, STOP_TIMEOUT);
        }
    }
}

fn run_worker<G, I, J, R>(
    open: impl FnOnce() -> AppResult<Opened<G, I, J>>,
    work: impl FnOnce(J, &AtomicBool) -> R,
    discard: impl FnOnce(J),
    running: &AtomicBool,
    ready: &mpsc::Sender<AppResult<I>>,
) -> Option<R> {
    let Opened { guard, info, job } = match open() {
        Ok(opened) => opened,
        Err(e) => {
            let _ = ready.send(Err(e));
            return None;
        }
    };
    if ready.send(Ok(info)).is_err() {
        // Nobody is waiting any more (the start timed out): let go of the
        // device and clean up whatever `open` made.
        drop(guard);
        discard(job);
        return None;
    }
    let result = work(job, running);
    drop(guard);
    Some(result)
}

fn await_ready<I>(ready: &mpsc::Receiver<AppResult<I>>, timeout: Duration) -> AppResult<I> {
    match ready.recv_timeout(timeout) {
        Ok(outcome) => outcome,
        Err(mpsc::RecvTimeoutError::Timeout) => {
            Err(stream_failed("the microphone did not start in time"))
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(stream_failed(
            "the audio thread stopped before the microphone opened",
        )),
    }
}

/// Run a stream on its own thread (cpal streams are not `Send`). `open` runs
/// there and must have the stream playing when it returns; this function
/// returns only after that, with `open`'s info or its real error. `work` then
/// loops while the flag is set, and the stream is dropped when it returns.
/// If `open` finishes after this function gave up, `discard` gets the job
/// instead, to remove what `open` created.
pub fn spawn_capture<G, I, J, R>(
    open: impl FnOnce() -> AppResult<Opened<G, I, J>> + Send + 'static,
    work: impl FnOnce(J, &AtomicBool) -> R + Send + 'static,
    discard: impl FnOnce(J) + Send + 'static,
    timeout: Duration,
) -> AppResult<(Capture<R>, I)>
where
    I: Send + 'static,
    R: Send + 'static,
{
    let running = Arc::new(AtomicBool::new(true));
    let (ready_tx, ready_rx) = mpsc::channel();
    let flag = Arc::clone(&running);
    let thread = thread::spawn(move || run_worker(open, work, discard, &flag, &ready_tx));
    let capture = Capture {
        running,
        thread: Some(thread),
    };
    match await_ready(&ready_rx, timeout) {
        Ok(info) => Ok((capture, info)),
        Err(e) => {
            capture.abandon();
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ringbuf::traits::{Consumer, Observer, Split};
    use ringbuf::{HeapCons, HeapProd, HeapRb};
    use std::sync::Mutex;

    fn ring<T: Copy>(capacity: usize) -> (HeapProd<T>, HeapCons<T>) {
        HeapRb::<T>::new(capacity).split()
    }

    fn drained<T: Copy + Default>(mut rx: HeapCons<T>) -> Vec<T> {
        let mut out = vec![T::default(); rx.occupied_len()];
        let n = rx.pop_slice(&mut out);
        out.truncate(n);
        out
    }

    // ----- sample formats and downmix -----

    #[test]
    fn stereo_is_averaged_to_mono_whatever_the_format() {
        let (mut tx, rx) = ring::<f32>(16);
        assert_eq!(push_mono(&mut tx, &[0.5f32, -0.1, 0.2, 0.4], 2), 0);
        assert_eq!(push_mono(&mut tx, &[16384i16, 0, -32768, -32768], 2), 0);
        assert_eq!(push_mono(&mut tx, &[32768u16, 32768], 2), 0);

        let got = drained(rx);

        let want = [0.2, 0.3, 0.25, -1.0, 0.0];
        assert_eq!(got.len(), want.len());
        for (g, w) in got.iter().zip(want) {
            assert!((g - w).abs() < 1e-3, "{g} vs {w}");
        }
    }

    #[test]
    fn a_trailing_half_frame_is_ignored() {
        let (mut tx, rx) = ring::<f32>(16);

        let dropped = push_mono(&mut tx, &[0.2f32, 0.4, 0.9], 2);

        assert_eq!(dropped, 0);
        assert_eq!(drained(rx).len(), 1);
    }

    #[test]
    fn mono_overflow_keeps_what_fits_and_counts_the_rest() {
        let (mut tx, rx) = ring::<f32>(3);

        let dropped = push_mono(&mut tx, &[0.1f32, 0.2, 0.3, 0.4, 0.5], 1);

        assert_eq!(dropped, 2);
        assert_eq!(drained(rx), vec![0.1, 0.2, 0.3]);
    }

    #[test]
    fn pcm_converts_to_16_bit_and_clips() {
        let (mut tx, rx) = ring::<i16>(16);
        push_pcm(&mut tx, &[0.0f32, 0.5, 1.0, 3.0, -3.0], 1);
        push_pcm(&mut tx, &[1234i16, -77], 1);
        push_pcm(&mut tx, &[0.0f64], 1);

        let got = drained(rx);

        assert_eq!(got[0], 0);
        assert!((i32::from(got[1]) - 16384).abs() <= 1, "{}", got[1]);
        assert_eq!(got[2], i16::MAX);
        assert_eq!(got[3], i16::MAX);
        assert_eq!(got[4], i16::MIN);
        assert_eq!(&got[5..], &[1234, -77, 0]);
    }

    #[test]
    fn pcm_stereo_is_mixed_down_to_one_channel() {
        let (mut tx, rx) = ring::<i16>(16);

        let dropped = push_pcm(&mut tx, &[1000i16, 3000, -2000, 2000, 400, 0], 2);

        assert_eq!(dropped, 0);
        assert_eq!(drained(rx), vec![2000, 0, 200]);
    }

    #[test]
    fn pcm_mixdown_works_for_many_channels_and_other_formats() {
        let (mut tx, rx) = ring::<i16>(16);
        // 4 channels of f32: (0.5 + 0.5 + 0.0 + 0.0) / 4 = 0.25
        push_pcm(&mut tx, &[0.5f32, 0.5, 0.0, 0.0], 4);

        let got = drained(rx);

        assert!((i32::from(got[0]) - 8192).abs() <= 1, "{}", got[0]);
    }

    #[test]
    fn pcm_overflow_counts_frames_not_samples() {
        let (mut tx, rx) = ring::<i16>(2);

        let dropped = push_pcm(&mut tx, &[1i16, 1, 2, 2, 3, 3, 4, 4], 2);

        assert_eq!(dropped, 2);
        assert_eq!(drained(rx), vec![1, 2]);
    }

    #[test]
    fn pcm_ignores_a_trailing_half_frame() {
        let (mut tx, rx) = ring::<i16>(16);

        let dropped = push_pcm(&mut tx, &[1000i16, 3000, 7], 2);

        assert_eq!(dropped, 0);
        assert_eq!(drained(rx), vec![2000]);
    }

    #[test]
    fn hand_over_counts_drops_and_the_worker_takes_them() {
        let (link, counter) = Link::new(thread::current());

        link.hand_over(0);
        link.hand_over(7);
        link.hand_over(5);

        assert_eq!(take_dropped(&counter), 12);
        assert_eq!(take_dropped(&counter), 0);
    }

    // ----- picking a device -----

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_owned()).collect()
    }

    fn pick(
        requested: Option<&str>,
        available: &[&str],
        default: Option<&str>,
    ) -> Option<(String, bool)> {
        choose_device(requested, &names(available), default).map(|c| (c.name, c.fell_back))
    }

    #[test]
    fn the_requested_device_wins_when_it_exists() {
        let got = pick(Some("USB Mic"), &["Built-in", "USB Mic"], Some("Built-in"));

        assert_eq!(got, Some(("USB Mic".into(), false)));
    }

    #[test]
    fn no_request_means_the_default_without_a_fallback_flag() {
        assert_eq!(
            pick(None, &["Built-in", "USB Mic"], Some("Built-in")),
            Some(("Built-in".into(), false))
        );
        assert_eq!(
            pick(Some(""), &["Built-in"], Some("Built-in")),
            Some(("Built-in".into(), false))
        );
    }

    #[test]
    fn a_missing_device_falls_back_to_the_default_and_says_so() {
        let got = pick(Some("Unplugged"), &["Built-in"], Some("Built-in"));

        assert_eq!(got, Some(("Built-in".into(), true)));
    }

    #[test]
    fn without_a_default_any_device_is_better_than_none() {
        assert_eq!(pick(None, &["A", "B"], None), Some(("A".into(), false)));
        assert_eq!(pick(Some("C"), &["A", "B"], None), Some(("A".into(), true)));
    }

    #[test]
    fn no_devices_at_all_is_none() {
        assert_eq!(pick(Some("A"), &[], None), None);
        assert_eq!(pick(None, &[], None), None);
    }

    // ----- errors -----

    fn collecting_report() -> (Report, Arc<Mutex<Vec<AudioIssue>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        let report: Report = Arc::new(move |issue| sink.lock().unwrap().push(issue));
        (report, seen)
    }

    #[test]
    fn an_unplugged_microphone_is_reported_once_as_device_lost() {
        let (report, seen) = collecting_report();
        let mut on_error = stream_error_handler(report, Arc::default(), AudioSource::Pitch);

        on_error(StreamError::DeviceNotAvailable);
        on_error(StreamError::DeviceNotAvailable);

        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].kind, AudioErrorKind::DeviceLost);
    }

    #[test]
    fn other_stream_errors_keep_the_real_message() {
        let (report, seen) = collecting_report();
        let mut on_error = stream_error_handler(report, Arc::default(), AudioSource::Pitch);

        on_error(StreamError::BackendSpecific {
            err: cpal::BackendSpecificError {
                description: "xrun on hw:1".into(),
            },
        });

        let seen = seen.lock().unwrap();
        assert_eq!(seen[0].kind, AudioErrorKind::StreamFailed);
        assert!(seen[0].message.contains("xrun on hw:1"));
    }

    // ----- the worker thread -----

    /// Stands in for a cpal stream: records when it is dropped.
    struct FakeStream(Arc<AtomicBool>);

    impl Drop for FakeStream {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    const WAIT: Duration = Duration::from_secs(2);

    #[test]
    fn start_returns_the_info_and_stop_drops_the_stream_and_returns_the_result() {
        let dropped = Arc::new(AtomicBool::new(false));
        let guard = FakeStream(Arc::clone(&dropped));

        let (capture, info) = spawn_capture(
            move || {
                Ok(Opened {
                    guard,
                    info: "ready",
                    job: 41,
                })
            },
            |job, running| {
                while running.load(Ordering::SeqCst) {
                    thread::park_timeout(Duration::from_millis(5));
                }
                job + 1
            },
            |_| (),
            WAIT,
        )
        .unwrap();
        assert_eq!(info, "ready");
        assert!(
            !dropped.load(Ordering::SeqCst),
            "stream lives while running"
        );

        let result = capture.stop().unwrap();

        assert_eq!(result, 42);
        assert!(dropped.load(Ordering::SeqCst), "stream dropped on stop");
    }

    #[test]
    fn start_fails_with_the_real_error_when_opening_fails() {
        let outcome = spawn_capture(
            || -> AppResult<Opened<(), (), ()>> { Err(device_lost("no microphone was found")) },
            |(), _| (),
            |_| (),
            WAIT,
        );

        let err = outcome.err().unwrap();
        assert_eq!(err.kind(), ErrorKind::DeviceLost);
        assert!(err.message().contains("no microphone"));
    }

    #[test]
    fn start_gives_up_when_the_device_never_answers() {
        let release = Arc::new(AtomicBool::new(false));
        let gate = Arc::clone(&release);

        let outcome = spawn_capture(
            move || -> AppResult<Opened<(), (), ()>> {
                while !gate.load(Ordering::SeqCst) {
                    thread::sleep(Duration::from_millis(5));
                }
                Ok(Opened {
                    guard: (),
                    info: (),
                    job: (),
                })
            },
            |(), _| (),
            |_| (),
            Duration::from_millis(50),
        );
        release.store(true, Ordering::SeqCst);

        let err = outcome.err().unwrap();
        assert_eq!(err.kind(), ErrorKind::StreamFailed);
        assert!(err.message().contains("in time"));
    }

    #[test]
    fn start_reports_a_worker_that_died_while_opening() {
        let outcome = spawn_capture(
            || -> AppResult<Opened<(), (), ()>> { panic!("driver blew up") },
            |(), _| (),
            |_| (),
            WAIT,
        );

        assert_eq!(outcome.err().unwrap().kind(), ErrorKind::StreamFailed);
    }

    #[test]
    fn dropping_a_capture_stops_the_worker_and_drops_the_stream() {
        let dropped = Arc::new(AtomicBool::new(false));
        let guard = FakeStream(Arc::clone(&dropped));
        let (capture, ()) = spawn_capture(
            move || {
                Ok(Opened {
                    guard,
                    info: (),
                    job: (),
                })
            },
            |(), running| {
                while running.load(Ordering::SeqCst) {
                    thread::park_timeout(Duration::from_millis(5));
                }
            },
            |_| (),
            WAIT,
        )
        .unwrap();

        drop(capture);

        assert!(dropped.load(Ordering::SeqCst));
    }

    // ----- health, bounded joins, late opens -----

    #[test]
    fn any_stream_error_marks_the_stream_failed() {
        let (report, _) = collecting_report();
        let failed = Arc::new(AtomicBool::new(false));
        let mut on_error = stream_error_handler(report, Arc::clone(&failed), AudioSource::Pitch);
        assert!(!failed.load(Ordering::SeqCst));

        on_error(StreamError::DeviceNotAvailable);
        on_error(StreamError::DeviceNotAvailable);

        assert!(failed.load(Ordering::SeqCst));
    }

    #[test]
    fn joining_a_finished_thread_gives_its_result() {
        let handle = thread::spawn(|| 7);

        let joined = join_within(handle, Duration::from_secs(2));

        assert_eq!(joined.unwrap().unwrap(), 7);
    }

    #[test]
    fn joining_a_hung_thread_gives_up_at_the_deadline() {
        let release = Arc::new(AtomicBool::new(false));
        let gate = Arc::clone(&release);
        let handle = thread::spawn(move || {
            while !gate.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(5));
            }
        });
        let started = std::time::Instant::now();

        let joined = join_within(handle, Duration::from_millis(50));
        release.store(true, Ordering::SeqCst);

        assert!(joined.is_none());
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn stopping_a_worker_that_hangs_returns_an_error_instead_of_hanging() {
        let release = Arc::new(AtomicBool::new(false));
        let gate = Arc::clone(&release);
        let (capture, ()) = spawn_capture(
            move || {
                Ok(Opened {
                    guard: (),
                    info: (),
                    job: (),
                })
            },
            move |(), _| {
                // a driver call that never comes back
                while !gate.load(Ordering::SeqCst) {
                    thread::sleep(Duration::from_millis(5));
                }
            },
            |()| (),
            WAIT,
        )
        .unwrap();
        let started = std::time::Instant::now();

        let outcome = capture.stop_within(Duration::from_millis(100));
        release.store(true, Ordering::SeqCst);

        let err = outcome.unwrap_err();
        assert_eq!(err.kind(), ErrorKind::StreamFailed);
        assert!(err.message().contains("in time"), "{}", err.message());
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn a_worker_that_panicked_shows_as_finished() {
        let (capture, ()) = spawn_capture(
            || {
                Ok(Opened {
                    guard: (),
                    info: (),
                    job: (),
                })
            },
            |(), _| -> () { panic!("callback blew up") },
            |()| (),
            WAIT,
        )
        .unwrap();

        let deadline = std::time::Instant::now() + WAIT;
        while !capture.is_finished() && std::time::Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }

        assert!(capture.is_finished());
    }

    #[test]
    fn a_device_that_opens_after_the_start_gave_up_hands_its_job_back_to_be_cleaned_up() {
        let release = Arc::new(AtomicBool::new(false));
        let gate = Arc::clone(&release);
        let (discarded_tx, discarded_rx) = mpsc::channel();

        let outcome = spawn_capture(
            move || {
                while !gate.load(Ordering::SeqCst) {
                    thread::sleep(Duration::from_millis(5));
                }
                Ok(Opened {
                    guard: (),
                    info: (),
                    job: "rec_9.wav",
                })
            },
            |_, _| (),
            move |job| {
                let _ = discarded_tx.send(job);
            },
            Duration::from_millis(50),
        );
        assert!(outcome.is_err());
        release.store(true, Ordering::SeqCst);

        assert_eq!(discarded_rx.recv_timeout(WAIT).unwrap(), "rec_9.wav");
    }
}
