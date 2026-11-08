//! Audio in and out: the pitch stream, the recorder and playback.
//!
//! Each piece keeps its logic in plain functions that tests can call; only
//! the thin parts that open a device or a speaker touch the system.

pub mod capture;
pub mod pitch_stream;
pub mod playback;
pub mod recorder;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::storage::model::RecordingInfo;
use pitch_stream::{PitchFrame, PitchSession};
use playback::{Player, SpeakerOutput};
use recorder::RecorderSession;

/// What the webview branches on in the `audio-error` event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioErrorKind {
    DeviceLost,
    WriteFailed,
    StreamFailed,
    /// Some audio never reached the recording, but the take is still going.
    AudioLost,
}

/// Which running stream a problem came from. The two are separate streams on
/// the same device: one dying says nothing certain about the other.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioSource {
    Pitch,
    Recorder,
}

/// Payload of the `audio-error` event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AudioIssue {
    pub source: AudioSource,
    pub kind: AudioErrorKind,
    pub message: String,
}

impl AudioIssue {
    pub fn new(source: AudioSource, kind: AudioErrorKind, message: impl Into<String>) -> Self {
        Self {
            source,
            kind,
            message: message.into(),
        }
    }
}

/// How workers tell the app something went wrong while running. The app
/// turns it into an event; tests collect it.
pub type Report = Arc<dyn Fn(AudioIssue) + Send + Sync>;

/// Answer to `start_pitch`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamInfo {
    pub sample_rate: u32,
    pub device: String,
    pub fell_back: bool,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // A panic on an audio thread must not lock the app out of its mic.
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The live audio sessions. Cheap to clone: commands move a clone onto a
/// blocking thread.
#[derive(Clone)]
pub struct AudioState {
    inner: Arc<Inner>,
}

struct Inner {
    pitch: Mutex<Option<PitchSession>>,
    recorder: Mutex<Option<RecorderSession>>,
    player: Player,
}

impl AudioState {
    /// `on_playback_ended` gets the name of each clip that stops playing.
    pub fn new(on_playback_ended: impl Fn(&str) + Send + 'static) -> Self {
        Self {
            inner: Arc::new(Inner {
                pitch: Mutex::new(None),
                recorder: Mutex::new(None),
                player: Player::spawn(SpeakerOutput::default, on_playback_ended),
            }),
        }
    }

    /// Start the pitch stream, or return the running one's info.
    pub fn start_pitch(
        &self,
        device: Option<String>,
        emit: impl FnMut(PitchFrame) + Send + 'static,
        report: Report,
    ) -> AppResult<StreamInfo> {
        let mut slot = lock(&self.inner.pitch);
        if let Some(running) = slot.as_ref().filter(|r| r.can_serve(device.as_deref())) {
            return Ok(running.info().clone());
        }
        // A dead, failed or differently-aimed stream: let it go first.
        if let Some(stale) = slot.take() {
            stale.stop();
        }
        let session = pitch_stream::start(device, emit, report)?;
        let info = session.info().clone();
        *slot = Some(session);
        Ok(info)
    }

    pub fn stop_pitch(&self) {
        // Take it out first: the lock must not be held while the worker is
        // joined (in a `if let` the guard would live through the body).
        let session = lock(&self.inner.pitch).take();
        if let Some(session) = session {
            session.stop();
        }
    }

    /// Start recording into `dir`. Returns the new file's name.
    pub fn start_recording(
        &self,
        dir: PathBuf,
        unix_ms: u128,
        device: Option<String>,
        report: Report,
    ) -> AppResult<String> {
        let mut slot = lock(&self.inner.recorder);
        if slot.is_some() {
            return Err(AppError::invalid("a recording is already in progress"));
        }
        let session = recorder::start(dir, unix_ms, device, report)?;
        let name = session.name().to_owned();
        *slot = Some(session);
        Ok(name)
    }

    pub fn stop_recording(&self) -> AppResult<RecordingInfo> {
        let session = lock(&self.inner.recorder)
            .take()
            .ok_or_else(|| AppError::invalid("no recording is in progress"))?;
        session.stop()
    }

    pub fn play(&self, name: &str, path: &Path) -> AppResult<()> {
        self.inner.player.play(name, path.to_path_buf())
    }

    pub fn stop_playback(&self) {
        self.inner.player.stop();
    }

    /// Close everything that holds a file or a device open: before the app
    /// exits and before the recordings folder is wiped.
    pub fn release_all(&self) {
        self.stop_pitch();
        // Whatever was recorded so far is kept; there is nobody to tell.
        let _ = self.stop_recording();
        self.stop_playback();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorKind;
    use std::sync::atomic::{AtomicBool, Ordering};

    fn state() -> AudioState {
        AudioState::new(|_| {})
    }

    #[test]
    fn stopping_what_is_not_running_is_harmless() {
        let audio = state();

        audio.stop_pitch();
        audio.stop_playback();
        audio.release_all();
    }

    #[test]
    fn stopping_the_pitch_stream_does_not_hold_the_session_lock_while_it_waits() {
        let release = Arc::new(AtomicBool::new(false));
        let audio = state();
        *lock(&audio.inner.pitch) = Some(pitch_stream::stuck_session(Arc::clone(&release)));
        let stopper = {
            let audio = audio.clone();
            std::thread::spawn(move || audio.stop_pitch())
        };
        std::thread::sleep(std::time::Duration::from_millis(100));

        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(500);
        let mut free = false;
        while !free && std::time::Instant::now() < deadline {
            free = audio.inner.pitch.try_lock().is_ok();
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        release.store(true, Ordering::SeqCst);
        stopper.join().unwrap();

        assert!(free, "the lock stayed taken while the worker was joined");
    }

    #[test]
    fn stopping_a_recording_that_never_started_is_a_clear_error() {
        let err = state().stop_recording().unwrap_err();

        assert_eq!(err.kind(), ErrorKind::InvalidInput);
    }

    #[test]
    fn an_audio_issue_serializes_as_the_webview_expects() {
        let issue = AudioIssue::new(
            AudioSource::Recorder,
            AudioErrorKind::DeviceLost,
            "unplugged",
        );

        let json = serde_json::to_value(issue).unwrap();

        assert_eq!(
            json,
            serde_json::json!({
                "source": "recorder",
                "kind": "device_lost",
                "message": "unplugged",
            })
        );
        let info = StreamInfo {
            sample_rate: 48000,
            device: "Mic".into(),
            fell_back: true,
        };
        assert_eq!(
            serde_json::to_value(info).unwrap(),
            serde_json::json!({ "sampleRate": 48000, "device": "Mic", "fellBack": true })
        );
    }

    #[test]
    fn every_audio_error_kind_has_the_wire_value_the_webview_expects() {
        let wire = |kind| serde_json::to_value(kind).unwrap();

        assert_eq!(wire(AudioErrorKind::DeviceLost), "device_lost");
        assert_eq!(wire(AudioErrorKind::WriteFailed), "write_failed");
        assert_eq!(wire(AudioErrorKind::StreamFailed), "stream_failed");
        assert_eq!(wire(AudioErrorKind::AudioLost), "audio_lost");
    }

    #[test]
    fn every_audio_source_has_the_wire_value_the_webview_expects() {
        let wire = |source| serde_json::to_value(source).unwrap();

        assert_eq!(wire(AudioSource::Pitch), "pitch");
        assert_eq!(wire(AudioSource::Recorder), "recorder");
    }

    #[test]
    fn a_pitch_frame_serializes_with_the_contract_field_names() {
        let frame = PitchFrame {
            t_ms: 42.5,
            f0: 220.0,
            rms: 0.1,
            peak: 0.3,
            centroid: 900.0,
        };

        let json = serde_json::to_value(frame).unwrap();

        let mut keys: Vec<_> = json.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, ["centroid", "f0", "peak", "rms", "tMs"]);
    }
}
