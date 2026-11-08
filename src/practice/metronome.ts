const MIN_BPM = 30;
const MAX_BPM = 240;
/** How far ahead clicks are booked on the audio clock, and how often it looks. */
const LOOKAHEAD_S = 0.12;
const SCHEDULER_MS = 30;
const CLICK_HZ = 880;
const CLICK_LENGTH_S = 0.05;
const CLICK_GAIN = 0.06;
const SILENT_GAIN = 0.0001;

export function clampTempo(bpm: number): number {
  if (!Number.isFinite(bpm)) return MIN_BPM;
  return Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)));
}

function click(audio: AudioContext, at: number): void {
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.connect(gain);
  gain.connect(audio.destination);
  oscillator.frequency.value = CLICK_HZ;
  gain.gain.setValueAtTime(CLICK_GAIN, at);
  gain.gain.exponentialRampToValueAtTime(SILENT_GAIN, at + CLICK_LENGTH_S);
  oscillator.start(at);
  oscillator.stop(at + CLICK_LENGTH_S);
}

/** Clicks are booked on the audio clock, so a busy page cannot make the beat wobble. */
export function startMetronome(bpm: number): () => void {
  const audio = new AudioContext();
  const beatS = 60 / clampTempo(bpm);
  let nextBeatS = audio.currentTime;
  const book = () => {
    while (nextBeatS < audio.currentTime + LOOKAHEAD_S) {
      click(audio, nextBeatS);
      nextBeatS += beatS;
    }
  };
  book();
  const timer = setInterval(book, SCHEDULER_MS);
  return () => {
    clearInterval(timer);
    audio.close().catch((error: unknown) => {
      console.error("could not close the metronome audio", error);
    });
  };
}
