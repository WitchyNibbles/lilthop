//! Playing a recording back.
//!
//! rodio's `OutputStream` is not `Send`, so playback lives on its own thread
//! and takes commands over a channel. `play` returns as soon as the sound has
//! started; the thread announces when it ends.

use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use rodio::{Decoder, OutputStream, Sink, Source};

use super::capture::stream_failed;
use crate::error::{AppError, AppResult};

/// How often a playing clip is checked for its end.
const POLL: Duration = Duration::from_millis(100);
/// How long `play` waits for the thread to open the speaker.
const START_TIMEOUT: Duration = Duration::from_secs(5);

/// A clip still "playing" this long after it should have ended is not
/// playing: the output device went away and rodio does not say so.
const END_GRACE: Duration = Duration::from_secs(2);

/// True when a clip of `expected` length has been going for longer than that
/// plus a grace period. Unknown length never counts as overdue.
pub fn is_overdue(elapsed: Duration, expected: Option<Duration>) -> bool {
    expected.is_some_and(|length| elapsed > length + END_GRACE)
}

/// The speaker, as far as the playback thread cares.
pub trait Output {
    /// Start playing the file. Fails with the real reason.
    fn start(&mut self, path: &Path) -> AppResult<()>;
    /// Stop and release the speaker.
    fn stop(&mut self);
    /// True once the clip has played to its end.
    fn finished(&self) -> bool;
}

enum Command {
    Play {
        name: String,
        path: PathBuf,
        reply: Sender<AppResult<()>>,
    },
    Stop,
}

/// Handle to the playback thread. Dropping it stops playback and joins.
pub struct Player {
    commands: Option<Sender<Command>>,
    thread: Option<JoinHandle<()>>,
}

impl Player {
    /// `make` runs on the new thread. `on_ended` is called with the name of a
    /// clip when it ends, is stopped, or is replaced by another.
    pub fn spawn<O: Output>(
        make: impl FnOnce() -> O + Send + 'static,
        on_ended: impl Fn(&str) + Send + 'static,
    ) -> Self {
        let (commands, inbox) = mpsc::channel();
        let thread = thread::spawn(move || run(make(), &inbox, &on_ended));
        Self {
            commands: Some(commands),
            thread: Some(thread),
        }
    }

    /// Start playing `path`, shown to the UI as `name`. Returns once playing.
    pub fn play(&self, name: &str, path: PathBuf) -> AppResult<()> {
        let (reply, answer) = mpsc::channel();
        self.send(Command::Play {
            name: name.to_owned(),
            path,
            reply,
        })?;
        match answer.recv_timeout(START_TIMEOUT) {
            Ok(outcome) => outcome,
            Err(RecvTimeoutError::Timeout) => {
                Err(stream_failed("the speaker did not start in time"))
            }
            Err(RecvTimeoutError::Disconnected) => Err(gone()),
        }
    }

    /// Stop whatever is playing. Does nothing when idle.
    pub fn stop(&self) {
        // A dead thread has nothing left to stop.
        let _ = self.send(Command::Stop);
    }

    fn send(&self, command: Command) -> AppResult<()> {
        let commands = self.commands.as_ref().ok_or_else(gone)?;
        commands.send(command).map_err(|_| gone())
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        self.commands.take();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn gone() -> AppError {
    stream_failed("the playback thread is not running")
}

/// The playback thread's loop.
fn run<O: Output>(mut output: O, inbox: &Receiver<Command>, on_ended: &impl Fn(&str)) {
    let mut current: Option<String> = None;
    loop {
        let command = if current.is_some() {
            match inbox.recv_timeout(POLL) {
                Ok(command) => Some(command),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => break,
            }
        } else {
            match inbox.recv() {
                Ok(command) => Some(command),
                Err(_) => break,
            }
        };
        match command {
            Some(Command::Play { name, path, reply }) => {
                end_current(&mut output, &mut current, on_ended);
                let started = output.start(&path);
                if started.is_ok() {
                    current = Some(name);
                }
                // The caller may have timed out and left; nothing to do then.
                let _ = reply.send(started);
            }
            Some(Command::Stop) => end_current(&mut output, &mut current, on_ended),
            None if output.finished() => end_current(&mut output, &mut current, on_ended),
            None => {}
        }
    }
    output.stop();
}

fn end_current<O: Output>(output: &mut O, current: &mut Option<String>, on_ended: &impl Fn(&str)) {
    if let Some(name) = current.take() {
        output.stop();
        on_ended(&name);
    }
}

// ---------- the real speaker ----------

struct Live {
    _stream: OutputStream,
    sink: Sink,
    started: Instant,
    expected: Option<Duration>,
}

/// Plays through the default output device. Opens it per clip and lets go of
/// it afterwards, so an idle app holds no audio device.
#[derive(Default)]
pub struct SpeakerOutput {
    live: Option<Live>,
}

impl Output for SpeakerOutput {
    fn start(&mut self, path: &Path) -> AppResult<()> {
        let file = File::open(path)?;
        let source = Decoder::new(BufReader::new(file))
            .map_err(|e| AppError::invalid(format!("that recording could not be read: {e}")))?;
        let expected = source.total_duration();
        let (stream, handle) =
            OutputStream::try_default().map_err(|e| stream_failed(e.to_string()))?;
        let sink = Sink::try_new(&handle).map_err(|e| stream_failed(e.to_string()))?;
        sink.append(source);
        self.live = Some(Live {
            _stream: stream,
            sink,
            started: Instant::now(),
            expected,
        });
        Ok(())
    }

    fn stop(&mut self) {
        if let Some(live) = self.live.take() {
            live.sink.stop();
        }
    }

    fn finished(&self) -> bool {
        self.live
            .as_ref()
            .is_none_or(|l| l.sink.empty() || is_overdue(l.started.elapsed(), l.expected))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::ErrorKind;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};

    const WAIT: Duration = Duration::from_secs(2);

    /// A speaker that records what it was asked to do.
    #[derive(Clone, Default)]
    struct Fake {
        log: Arc<Mutex<Vec<String>>>,
        done: Arc<AtomicBool>,
        refuse: bool,
    }

    impl Output for Fake {
        fn start(&mut self, path: &Path) -> AppResult<()> {
            if self.refuse {
                return Err(stream_failed("no speaker"));
            }
            self.done.store(false, Ordering::SeqCst);
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            self.log.lock().unwrap().push(format!("start {name}"));
            Ok(())
        }

        fn stop(&mut self) {
            self.log.lock().unwrap().push("stop".into());
        }

        fn finished(&self) -> bool {
            self.done.load(Ordering::SeqCst)
        }
    }

    type Ended = Arc<Mutex<Vec<String>>>;

    fn player(fake: &Fake) -> (Player, mpsc::Receiver<String>, Ended) {
        let (tx, rx) = mpsc::channel();
        let ended: Ended = Arc::default();
        let record = Arc::clone(&ended);
        let fake = fake.clone();
        let player = Player::spawn(
            move || fake,
            move |name| {
                record.lock().unwrap().push(name.to_owned());
                let _ = tx.send(name.to_owned());
            },
        );
        (player, rx, ended)
    }

    #[test]
    fn a_clip_is_overdue_only_well_after_its_length() {
        let three = Some(Duration::from_secs(3));

        assert!(!is_overdue(Duration::from_secs(2), three));
        assert!(
            !is_overdue(Duration::from_secs(4), three),
            "within the grace"
        );
        assert!(is_overdue(Duration::from_secs(6), three));
        assert!(
            !is_overdue(Duration::from_secs(3600), None),
            "length unknown"
        );
    }

    #[test]
    fn play_returns_at_once_and_the_end_is_announced_later() {
        let fake = Fake::default();
        let (player, ended_rx, _) = player(&fake);

        player.play("rec_1.wav", "/x/rec_1.wav".into()).unwrap();

        assert!(ended_rx.try_recv().is_err(), "still playing");
        fake.done.store(true, Ordering::SeqCst);
        assert_eq!(ended_rx.recv_timeout(WAIT).unwrap(), "rec_1.wav");
    }

    #[test]
    fn stop_ends_playback_and_says_so() {
        let fake = Fake::default();
        let (player, ended_rx, _) = player(&fake);
        player.play("rec_1.wav", "/x/rec_1.wav".into()).unwrap();

        player.stop();

        assert_eq!(ended_rx.recv_timeout(WAIT).unwrap(), "rec_1.wav");
        assert_eq!(fake.log.lock().unwrap().last().unwrap(), "stop");
    }

    #[test]
    fn stop_while_idle_says_nothing() {
        let fake = Fake::default();
        let (player, _, ended) = player(&fake);

        player.stop();
        drop(player);

        assert!(ended.lock().unwrap().is_empty());
    }

    #[test]
    fn a_speaker_that_cannot_start_gives_the_real_error_and_no_end_event() {
        let fake = Fake {
            refuse: true,
            ..Fake::default()
        };
        let (player, _, ended) = player(&fake);

        let err = player.play("rec_1.wav", "/x/rec_1.wav".into()).unwrap_err();
        drop(player);

        assert_eq!(err.kind(), ErrorKind::StreamFailed);
        assert!(err.message().contains("no speaker"));
        assert!(ended.lock().unwrap().is_empty());
    }

    #[test]
    fn playing_a_second_clip_ends_the_first() {
        let fake = Fake::default();
        let (player, ended_rx, _) = player(&fake);
        player.play("rec_1.wav", "/x/rec_1.wav".into()).unwrap();

        player.play("rec_2.wav", "/x/rec_2.wav".into()).unwrap();

        assert_eq!(ended_rx.recv_timeout(WAIT).unwrap(), "rec_1.wav");
        let log = fake.log.lock().unwrap().clone();
        assert_eq!(log, ["start rec_1.wav", "stop", "start rec_2.wav"]);
    }

    #[test]
    fn dropping_the_player_releases_the_speaker() {
        let fake = Fake::default();
        let (player, _, _) = player(&fake);
        player.play("rec_1.wav", "/x/rec_1.wav".into()).unwrap();

        drop(player);

        assert_eq!(fake.log.lock().unwrap().last().unwrap(), "stop");
    }
}
