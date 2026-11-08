//! Recording to a WAV file in the recordings folder.
//!
//! The header of a WAV says how long the data is. hound only writes that at
//! the end, so a recording cut short by a crash used to read back as empty.
//! `WavRecorder` rewrites the header about once a second, so a crash loses
//! at most that last second.

use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, UNIX_EPOCH};

use cpal::{Stream, StreamError};
use ringbuf::traits::{Consumer, Split};
use ringbuf::{HeapCons, HeapRb};

use super::capture::{
    Capture, Link, Opened, PcmSink, START_TIMEOUT, build_input_stream, open_input_device, play,
    spawn_capture, stream_error_handler, take_dropped,
};
use super::{AudioErrorKind, AudioIssue, AudioSource, Report};
use crate::error::{AppError, AppResult, ErrorKind};
use crate::storage::model::RecordingInfo;

/// Seconds of audio between header rewrites.
const FLUSH_SECONDS: u64 = 1;
/// How much audio the ring holds if the writer stalls (a slow disk).
const RING_SECONDS: usize = 4;
const IDLE_WAIT: Duration = Duration::from_millis(50);
const SCRATCH_SAMPLES: usize = 8192;
/// A WAV stores its data length in 32 bits, so a file cannot pass 4 GiB. The
/// recording stops a little short of that (about 10 hours of mono at 48 kHz).
pub const MAX_DATA_BYTES: u64 = 3_500 * 1024 * 1024;
/// Tries at a free file name before giving up.
const NAME_TRIES: u128 = 1000;

fn write_failed(message: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorKind::WriteFailed, message.to_string())
}

// ---------- the file ----------

/// 16-bit WAV writer that keeps its header valid as it goes.
pub struct WavRecorder<W: Write + Seek> {
    writer: hound::WavWriter<W>,
    sample_rate: u32,
    channels: usize,
    flush_every: u64,
    since_flush: u64,
    frames: u64,
    data_bytes: u64,
    max_data_bytes: u64,
}

impl<W: Write + Seek> WavRecorder<W> {
    pub fn new(out: W, channels: u16, sample_rate: u32) -> AppResult<Self> {
        Self::with_limit(out, channels, sample_rate, MAX_DATA_BYTES)
    }

    /// Like `new`, but refuses to write more than `max_data_bytes` of audio.
    pub fn with_limit(
        out: W,
        channels: u16,
        sample_rate: u32,
        max_data_bytes: u64,
    ) -> AppResult<Self> {
        let spec = hound::WavSpec {
            channels,
            sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let writer = hound::WavWriter::new(out, spec).map_err(write_failed)?;
        Ok(Self {
            writer,
            sample_rate,
            channels: usize::from(channels.max(1)),
            flush_every: u64::from(sample_rate) * u64::from(channels) * FLUSH_SECONDS,
            since_flush: 0,
            frames: 0,
            data_bytes: 0,
            max_data_bytes,
        })
    }

    /// Append interleaved samples (whole frames).
    pub fn write(&mut self, samples: &[i16]) -> AppResult<()> {
        let bytes = samples.len() as u64 * 2;
        if self.data_bytes + bytes > self.max_data_bytes {
            return Err(write_failed(
                "the recording reached the size limit of a WAV file and was stopped; \
                 everything recorded until then is saved",
            ));
        }
        self.data_bytes += bytes;
        for &sample in samples {
            self.writer.write_sample(sample).map_err(write_failed)?;
        }
        self.frames += (samples.len() / self.channels) as u64;
        self.since_flush += samples.len() as u64;
        if self.since_flush >= self.flush_every {
            self.since_flush = 0;
            self.writer.flush().map_err(write_failed)?;
        }
        Ok(())
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn frames(&self) -> u64 {
        self.frames
    }

    /// Write the final header and close. Returns the number of frames.
    pub fn finish(self) -> AppResult<u64> {
        let frames = self.frames;
        self.writer.finalize().map_err(write_failed)?;
        Ok(frames)
    }
}

// ---------- names ----------

pub fn recording_name(unix_ms: u128) -> String {
    format!("rec_{unix_ms}.wav")
}

/// Create a new recording file. Never overwrites: if the millisecond is
/// taken, the next free one is used.
pub fn create_unique(dir: &Path, unix_ms: u128) -> AppResult<(String, File)> {
    for ms in unix_ms..unix_ms + NAME_TRIES {
        let name = recording_name(ms);
        match OpenOptions::new()
            .write(true)
            .read(true)
            .create_new(true)
            .open(dir.join(&name))
        {
            Ok(file) => return Ok((name, file)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(write_failed(e)),
        }
    }
    Err(write_failed("no free recording name"))
}

// ---------- the worker ----------

/// What the writer thread needs once the stream is playing.
pub struct Job<W: Write + Seek> {
    ring: HeapCons<i16>,
    dropped: Arc<AtomicU64>,
    recorder: WavRecorder<W>,
    report: Report,
    /// The file, so it can be removed if the start is abandoned.
    path: PathBuf,
}

/// How a recording ended.
#[derive(Debug)]
pub struct Finished {
    pub frames: u64,
    pub sample_rate: u32,
    /// Set when writing failed and the recording stopped early.
    pub failure: Option<AppError>,
}

fn tell(report: &Report, kind: AudioErrorKind, message: impl Into<String>) {
    report(AudioIssue::new(AudioSource::Recorder, kind, message));
}

/// Move what is waiting in the ring into the file. Returns samples written.
fn drain_once<W: Write + Seek>(
    ring: &mut HeapCons<i16>,
    scratch: &mut [i16],
    recorder: &mut WavRecorder<W>,
) -> AppResult<usize> {
    let read = ring.pop_slice(scratch);
    if read > 0 {
        recorder.write(&scratch[..read])?;
    }
    Ok(read)
}

/// Keep writing until told to stop, then write what is left and close.
fn record<W: Write + Seek>(job: Job<W>, running: &AtomicBool) -> Finished {
    let Job {
        mut ring,
        dropped,
        mut recorder,
        report,
        path: _,
    } = job;
    let mut scratch = vec![0i16; SCRATCH_SAMPLES];
    let mut lost_reported = false;
    let mut failure = None;
    loop {
        let stopping = !running.load(Ordering::SeqCst);
        match drain_once(&mut ring, &mut scratch, &mut recorder) {
            Ok(0) if stopping => break,
            Ok(0) => thread::park_timeout(IDLE_WAIT),
            Ok(_) => {}
            Err(e) => {
                tell(&report, AudioErrorKind::WriteFailed, e.message());
                failure = Some(e);
                break;
            }
        }
        if take_dropped(&dropped) > 0 && !lost_reported {
            lost_reported = true;
            tell(
                &report,
                AudioErrorKind::AudioLost,
                "the recording fell behind and some audio was lost",
            );
        }
    }
    close(recorder, &report, failure)
}

/// Write the final header. A failure here counts only if nothing failed
/// before it.
fn close<W: Write + Seek>(
    recorder: WavRecorder<W>,
    report: &Report,
    mut failure: Option<AppError>,
) -> Finished {
    let (frames, sample_rate) = (recorder.frames(), recorder.sample_rate());
    if let (Err(e), None) = (recorder.finish(), &failure) {
        tell(report, AudioErrorKind::WriteFailed, e.message());
        failure = Some(e);
    }
    Finished {
        frames,
        sample_rate,
        failure,
    }
}

// ---------- the session ----------

/// What `start` learns once the stream plays.
struct Started {
    name: String,
}

/// A running recording.
pub struct RecorderSession {
    capture: Capture<Finished>,
    name: String,
    path: PathBuf,
}

impl RecorderSession {
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Stop, close the file and describe it. If writing failed along the
    /// way the error comes back here too; what was flushed before stays on
    /// disk and shows up in the recordings list.
    pub fn stop(self) -> AppResult<RecordingInfo> {
        let finished = self.capture.stop()?;
        if let Some(failure) = finished.failure {
            return Err(failure);
        }
        recording_info(&self.path, self.name, &finished)
    }
}

/// The file as the recordings list will show it, without a note yet.
fn recording_info(path: &Path, name: String, finished: &Finished) -> AppResult<RecordingInfo> {
    let meta = fs::metadata(path)?;
    let duration_s = if finished.sample_rate == 0 {
        0.0
    } else {
        finished.frames as f64 / f64::from(finished.sample_rate)
    };
    Ok(RecordingInfo {
        name,
        size_bytes: meta.len(),
        modified_ts: meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_secs()),
        duration_s,
        note: String::new(),
        tags: String::new(),
    })
}

/// Create the file, open the microphone and have it playing.
fn open(
    dir: &Path,
    unix_ms: u128,
    requested: Option<&str>,
    report: Report,
) -> AppResult<Opened<Stream, Started, Job<BufWriter<File>>>> {
    let input = open_input_device(requested)?;
    let (name, file) = create_unique(dir, unix_ms)?;
    let path = dir.join(&name);
    let result = open_stream(input, file, report, name, path.clone());
    if result.is_err() {
        // Nothing was recorded: do not leave an empty file behind.
        let _ = fs::remove_file(&path);
    }
    result
}

/// Nothing here stops the writer: the webview ends the take on this report,
/// which keeps what was written.
fn stream_errors(report: Report) -> impl FnMut(StreamError) + Send + 'static {
    stream_error_handler(report, Arc::default(), AudioSource::Recorder)
}

fn open_stream(
    input: super::capture::InputDevice,
    file: File,
    report: Report,
    name: String,
    path: PathBuf,
) -> AppResult<Opened<Stream, Started, Job<BufWriter<File>>>> {
    let sample_rate = input.config.sample_rate().0;
    // The device may have many channels; the recording is mono.
    let recorder = WavRecorder::new(BufWriter::new(file), 1, sample_rate)?;
    let ring_len = sample_rate as usize * RING_SECONDS;
    let (producer, consumer) = HeapRb::<i16>::new(ring_len).split();
    let (link, dropped) = Link::new(thread::current());
    let sink = PcmSink {
        ring: producer,
        channels: usize::from(input.config.channels()),
        link,
    };
    let stream = build_input_stream(
        &input.device,
        &input.config,
        sink,
        stream_errors(Arc::clone(&report)),
    )?;
    play(&stream)?;
    Ok(Opened {
        guard: stream,
        info: Started { name },
        job: Job {
            ring: consumer,
            dropped,
            recorder,
            report,
            path,
        },
    })
}

/// Start recording into `dir`. Returns once the stream is playing.
pub fn start(
    dir: PathBuf,
    unix_ms: u128,
    requested: Option<String>,
    report: Report,
) -> AppResult<RecorderSession> {
    let path_dir = dir.clone();
    start_with(
        dir,
        move || open(&path_dir, unix_ms, requested.as_deref(), report),
        START_TIMEOUT,
    )
}

/// The start gave up before the device opened: close the file and remove it.
fn discard_unused<W: Write + Seek>(job: Job<W>) {
    let path = job.path.clone();
    drop(job); // closes the file first; Windows cannot remove an open one
    let _ = fs::remove_file(path);
}

fn start_with<G: 'static, W: Write + Seek + Send + 'static>(
    dir: PathBuf,
    open: impl FnOnce() -> AppResult<Opened<G, Started, Job<W>>> + Send + 'static,
    timeout: Duration,
) -> AppResult<RecorderSession> {
    let (capture, started) = spawn_capture(open, record, discard_unused, timeout)?;
    Ok(RecorderSession {
        capture,
        path: dir.join(&started.name),
        name: started.name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use ringbuf::traits::Producer;
    use std::io::{Cursor, SeekFrom};
    use std::sync::Mutex;
    use tempfile::tempdir;

    use crate::paths::validate_recording_name;

    const SR: u32 = 48_000;

    fn ramp(n: usize) -> Vec<i16> {
        (0..n).map(|i| (i % 200) as i16 - 100).collect()
    }

    fn read_back(path: &Path) -> (hound::WavSpec, Vec<i16>) {
        let mut reader = hound::WavReader::open(path).unwrap();
        let samples = reader.samples::<i16>().map(Result::unwrap).collect();
        (reader.spec(), samples)
    }

    // ----- the crash case -----

    #[test]
    fn a_recording_killed_without_finalize_still_reads_back_what_was_flushed() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("rec_1.wav");
        let file = File::create(&path).unwrap();
        let mut recorder = WavRecorder::new(BufWriter::new(file), 1, SR).unwrap();

        // 1.5 seconds, then the process dies: no finish, no Drop.
        recorder.write(&ramp(SR as usize)).unwrap();
        recorder.write(&ramp(SR as usize / 2)).unwrap();
        std::mem::forget(recorder);

        let reader = hound::WavReader::open(&path).unwrap();
        assert_eq!(reader.duration(), SR, "the first second survived");
    }

    #[test]
    fn stereo_flushes_on_the_second_too() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("rec_1.wav");
        let file = File::create(&path).unwrap();
        let mut recorder = WavRecorder::new(BufWriter::new(file), 2, SR).unwrap();

        recorder.write(&ramp(SR as usize * 2)).unwrap(); // 1 s of stereo
        std::mem::forget(recorder);

        let reader = hound::WavReader::open(&path).unwrap();
        assert_eq!((reader.spec().channels, reader.duration()), (2, SR));
    }

    #[test]
    fn finishing_gives_every_sample_back_in_order() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("rec_1.wav");
        let mut recorder =
            WavRecorder::new(BufWriter::new(File::create(&path).unwrap()), 2, 8000).unwrap();
        let samples = ramp(30_000);

        recorder.write(&samples[..12_345 / 2 * 2]).unwrap();
        recorder.write(&samples[12_345 / 2 * 2..]).unwrap();
        let frames = recorder.finish().unwrap();

        let (spec, back) = read_back(&path);
        assert_eq!(
            (frames, spec.sample_rate, spec.bits_per_sample),
            (15_000, 8000, 16)
        );
        assert_eq!(back, samples);
    }

    // ----- write errors -----

    /// A disk that fills up: accepts `room` more bytes, then fails.
    struct FullDisk {
        inner: Cursor<Vec<u8>>,
        room: usize,
    }

    impl Write for FullDisk {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            if buf.len() > self.room {
                return Err(std::io::Error::other("no space left on device"));
            }
            self.room -= buf.len();
            self.inner.write(buf)
        }

        fn flush(&mut self) -> std::io::Result<()> {
            self.inner.flush()
        }
    }

    impl Seek for FullDisk {
        fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
            self.inner.seek(pos)
        }
    }

    fn full_disk(room: usize) -> FullDisk {
        FullDisk {
            inner: Cursor::new(Vec::new()),
            room,
        }
    }

    #[test]
    fn a_full_disk_is_a_write_failed_error_not_silence() {
        let mut recorder = WavRecorder::new(full_disk(100), 1, SR).unwrap();

        let err = recorder.write(&ramp(1000)).unwrap_err();

        assert_eq!(err.kind(), ErrorKind::WriteFailed);
        assert!(err.message().contains("no space"), "{}", err.message());
    }

    // ----- the loop -----

    fn collecting_report() -> (Report, Arc<Mutex<Vec<AudioIssue>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        let report: Report = Arc::new(move |issue| sink.lock().unwrap().push(issue));
        (report, seen)
    }

    /// A running flag that turns itself off after a while, so a loop that
    /// should have ended on an error fails the test instead of hanging it.
    fn with_watchdog() -> Arc<AtomicBool> {
        let running = Arc::new(AtomicBool::new(true));
        let flag = Arc::clone(&running);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(2));
            flag.store(false, Ordering::SeqCst);
        });
        running
    }

    fn job_for<W: Write + Seek>(
        recorder: WavRecorder<W>,
        samples: &[i16],
        report: Report,
    ) -> (Job<W>, Arc<AtomicU64>) {
        let (mut tx, rx) = HeapRb::<i16>::new(samples.len().max(1) + 8).split();
        tx.push_slice(samples);
        let dropped = Arc::new(AtomicU64::new(0));
        let job = Job {
            ring: rx,
            dropped: Arc::clone(&dropped),
            recorder,
            report,
            path: PathBuf::new(),
        };
        (job, dropped)
    }

    fn job_with<W: Write + Seek>(
        out: W,
        channels: u16,
        samples: &[i16],
        report: Report,
    ) -> (Job<W>, Arc<AtomicU64>) {
        job_for(
            WavRecorder::new(out, channels, SR).unwrap(),
            samples,
            report,
        )
    }

    #[test]
    fn stopping_writes_everything_still_in_the_ring() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("rec_1.wav");
        let samples = ramp(20_000);
        let (report, seen) = collecting_report();
        let file = File::create(&path).unwrap();
        let (job, _) = job_with(BufWriter::new(file), 2, &samples, report);

        let finished = record(job, &AtomicBool::new(false));

        assert!(finished.failure.is_none());
        assert_eq!((finished.frames, finished.sample_rate), (10_000, SR));
        assert_eq!(read_back(&path).1, samples);
        assert!(seen.lock().unwrap().is_empty());
    }

    #[test]
    fn a_write_error_is_reported_once_and_ends_the_recording() {
        let (report, seen) = collecting_report();
        let (job, _) = job_with(full_disk(5000), 1, &ramp(20_000), report);

        let finished = record(job, &with_watchdog());

        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1, "{seen:?}");
        assert_eq!(seen[0].kind, AudioErrorKind::WriteFailed);
        assert_eq!(
            finished.failure.map(|e| e.kind()),
            Some(ErrorKind::WriteFailed)
        );
    }

    #[test]
    fn audio_dropped_because_the_writer_fell_behind_is_reported_once() {
        let (report, seen) = collecting_report();
        let (job, dropped) = job_with(Cursor::new(Vec::new()), 1, &ramp(1000), report);
        dropped.fetch_add(480, Ordering::Relaxed);

        let finished = record(job, &AtomicBool::new(false));

        assert!(finished.failure.is_none(), "the file itself is fine");
        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].kind, AudioErrorKind::AudioLost);
        assert!(seen[0].message.contains("fell behind"));
    }

    #[test]
    fn what_the_writer_reports_says_it_came_from_the_recorder() {
        let (report, seen) = collecting_report();
        let (job, dropped) = job_with(full_disk(5000), 1, &ramp(20_000), report);
        dropped.fetch_add(480, Ordering::Relaxed);

        record(job, &with_watchdog());

        let seen = seen.lock().unwrap();
        assert!(!seen.is_empty());
        assert!(seen.iter().all(|i| i.source == AudioSource::Recorder));
    }

    #[test]
    fn a_stream_that_dies_mid_take_says_it_came_from_the_recorder() {
        let (report, seen) = collecting_report();
        let mut on_error = stream_errors(report);

        on_error(StreamError::DeviceNotAvailable);

        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].source, AudioSource::Recorder);
        assert_eq!(seen[0].kind, AudioErrorKind::DeviceLost);
    }

    // ----- names and the session -----

    #[test]
    fn names_are_millisecond_stamped_and_valid() {
        let name = recording_name(1_730_000_123_456);

        assert_eq!(name, "rec_1730000123456.wav");
        validate_recording_name(&name).unwrap();
    }

    #[test]
    fn a_new_recording_never_overwrites_an_existing_one() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("rec_100.wav"), b"keep me").unwrap();

        let (name, _file) = create_unique(dir.path(), 100).unwrap();

        assert_eq!(name, "rec_101.wav");
        assert_eq!(
            fs::read(dir.path().join("rec_100.wav")).unwrap(),
            b"keep me"
        );
    }

    struct FakeStream(Arc<AtomicBool>);

    impl Drop for FakeStream {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    #[test]
    fn a_session_records_and_stop_describes_the_closed_file() {
        let dir = tempdir().unwrap();
        let (name, file) = create_unique(dir.path(), 5000).unwrap();
        let samples = ramp(SR as usize * 3 / 2);
        let (report, _) = collecting_report();
        let (job, _) = job_with(BufWriter::new(file), 1, &samples, report);
        let released = Arc::new(AtomicBool::new(false));
        let guard = FakeStream(Arc::clone(&released));
        let started = Started { name: name.clone() };

        let session = start_with(
            dir.path().to_path_buf(),
            move || {
                Ok(Opened {
                    guard,
                    info: started,
                    job,
                })
            },
            Duration::from_secs(2),
        )
        .unwrap();
        assert_eq!(session.name(), "rec_5000.wav");
        std::thread::sleep(Duration::from_millis(100));
        let info = session.stop().unwrap();

        assert!(released.load(Ordering::SeqCst), "stream released");
        assert_eq!(info.name, "rec_5000.wav");
        assert_eq!(info.size_bytes, 44 + samples.len() as u64 * 2);
        assert!((info.duration_s - 1.5).abs() < 1e-9);
        assert_eq!((info.note.as_str(), info.tags.as_str()), ("", ""));
        let (_, back) = read_back(&dir.path().join(&name));
        assert_eq!(back, samples);
    }

    #[test]
    fn a_session_whose_disk_filled_up_says_so_on_stop() {
        let dir = tempdir().unwrap();
        let (report, seen) = collecting_report();
        let (job, _) = job_with(full_disk(5000), 1, &ramp(20_000), report);
        let started = Started {
            name: "rec_1.wav".into(),
        };

        let session = start_with(
            dir.path().to_path_buf(),
            move || {
                Ok(Opened {
                    guard: (),
                    info: started,
                    job,
                })
            },
            Duration::from_secs(2),
        )
        .unwrap();
        std::thread::sleep(Duration::from_millis(100));
        let err = session.stop().unwrap_err();

        assert_eq!(err.kind(), ErrorKind::WriteFailed);
        assert_eq!(seen.lock().unwrap().len(), 1, "the event went out as well");
    }

    // ----- the 4 GiB limit of the WAV length field -----

    #[test]
    fn the_default_limit_stays_under_what_a_wav_length_can_hold() {
        const { assert!(MAX_DATA_BYTES < u32::MAX as u64 - 44) };
        const { assert!(MAX_DATA_BYTES > 3 * 1024 * 1024 * 1024) };
    }

    #[test]
    fn writing_past_the_limit_fails_with_write_failed_and_keeps_what_was_saved() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("rec_1.wav");
        let file = BufWriter::new(File::create(&path).unwrap());
        let mut recorder = WavRecorder::with_limit(file, 1, SR, 1000).unwrap();
        let samples = ramp(500); // exactly 1000 bytes

        recorder.write(&samples[..300]).unwrap();
        recorder.write(&samples[300..]).unwrap();
        let err = recorder.write(&[1, 2]).unwrap_err();
        let frames = recorder.finish().unwrap();

        assert_eq!(err.kind(), ErrorKind::WriteFailed);
        assert!(err.message().contains("size limit"), "{}", err.message());
        assert_eq!(frames, 500);
        assert_eq!(read_back(&path).1, samples);
    }

    #[test]
    fn a_chunk_that_would_cross_the_limit_is_not_written_at_all() {
        let mut recorder = WavRecorder::with_limit(Cursor::new(Vec::new()), 2, SR, 100).unwrap();

        recorder.write(&ramp(40)).unwrap(); // 80 bytes
        let err = recorder.write(&ramp(20)).unwrap_err(); // 40 more would be 120

        assert_eq!(err.kind(), ErrorKind::WriteFailed);
        assert_eq!(recorder.frames(), 20);
    }

    #[test]
    fn hitting_the_limit_in_the_loop_is_reported_once_and_ends_the_recording() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("rec_1.wav");
        let (report, seen) = collecting_report();
        let file = BufWriter::new(File::create(&path).unwrap());
        let recorder = WavRecorder::with_limit(file, 1, SR, 17_000).unwrap();
        // the first read is 8192 samples (16384 bytes), the second would cross
        let (job, _) = job_for(recorder, &ramp(10_000), report);

        let finished = record(job, &with_watchdog());

        let seen = seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].kind, AudioErrorKind::WriteFailed);
        assert!(seen[0].message.contains("size limit"));
        assert!(finished.failure.is_some());
        assert_eq!(finished.frames, 8192, "what was written before the limit");
        assert_eq!(read_back(&path).1, ramp(10_000)[..8192]);
    }

    // ----- a device that opens after the start gave up -----

    #[test]
    fn a_late_open_removes_the_file_it_created() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("rec_77.wav");
        let release = Arc::new(AtomicBool::new(false));
        let gate = Arc::clone(&release);
        let (report, _) = collecting_report();
        let made = path.clone();
        let started = Started {
            name: "rec_77.wav".into(),
        };

        let outcome = start_with(
            dir.path().to_path_buf(),
            move || {
                let file = File::create(&made).unwrap();
                while !gate.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(5));
                }
                let (mut job, _) = job_with(BufWriter::new(file), 1, &[], report);
                job.path = made;
                Ok(Opened {
                    guard: (),
                    info: started,
                    job,
                })
            },
            Duration::from_millis(50),
        );
        assert!(outcome.is_err());
        assert!(path.exists(), "created while the open was still pending");
        release.store(true, Ordering::SeqCst);

        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while path.exists() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(!path.exists(), "the empty recording was left behind");
    }
}
