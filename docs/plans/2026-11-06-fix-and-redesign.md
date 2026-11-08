# Fix and redesign plan

Goal: an app a stranger can trust. The audit was written on 2026-11-06 and is no longer in the tree; its section numbers are cited as A1 to A14.

Rules for every task:

- Start from a failing known-answer test. A test must fail if the behaviour breaks and keep passing if only internals change.
- Everything stays local: no telemetry, no outside calls, no remote fonts or images.
- Wording makes no medical promises and never claims to detect strain or damage.
- Never write the Windows user directory name, the WSL user name or an old account email anywhere.
- Never edit `.grimoire/`. No suppressions. Formatter, ESLint (complexity max 10) and strict tsconfig apply to all TS.
- Commit with explicit paths, never `git add -A`. No `Co-Authored-By`, no `--no-verify`.
- Rust lives at `~/.cargo/bin` (not on PATH). Tests never touch the real app data: storage code takes a base directory.

## Branches

`grimoire-standard` -> `fix/app` (Rust, domain logic) -> `redesign/ui` (new UI on top).

`App.tsx` gets replaced by the redesign, so the UI-side fixes (notes, calibration, warnings on the exercise screen) land there. `fix/app` is not expected to run end to end until `redesign/ui`. The full gate runs at the tip of `redesign/ui`.

## IPC contract (fixed, both sides code to this)

Rust uses `#[serde(rename_all = "camelCase")]` on everything that crosses IPC. Commands return `Result<T, AppError>`; `AppError` serializes to `{ kind: string, message: string }`. Blocking commands are async so nothing runs on the main thread.

```ts
type PitchFrame = {
  tMs: number; // time since stream start, from sample count
  f0: number; // Hz, 0 when unvoiced or below the volume gate
  rms: number; // 0..1
  peak: number; // 0..1, max abs sample in the hop
  centroid: number; // Hz, 0 when below the volume gate
};
type StreamInfo = { sampleRate: number; device: string; fellBack: boolean };
type RecordingInfo = {
  name: string; // bare file name, the only handle the webview gets
  sizeBytes: number;
  modifiedTs: number;
  durationS: number;
  note: string;
  tags: string;
};
type Profile = {
  baselineHz: number;
  baselineCentroid: number;
  baselineRms: number;
  targetMinHz: number;
  targetMaxHz: number;
  goals: string[];
  language: "en" | "es";
  theme: "dark" | "light";
  onboarded: boolean;
  pitchEngine: number; // 1 = measured by the old biased detector, 2 = fixed detector
};
type NewResult = {
  exerciseId: string;
  score: number;
  pitchMean: number;
  pitchSd: number;
  durationS: number;
  voicedS: number;
  scoringVersion: number;
};
type SavedResult = NewResult & { id: number; createdAt: number };
type RestoreSummary = { results: number; recordings: number; profile: boolean };
type AudioError = {
  source: "pitch" | "recorder";
  kind: "device_lost" | "write_failed" | "stream_failed" | "audio_lost";
  message: string;
};
```

Commands (names as invoked, args camelCase):

| Command                 | Args                         | Returns                                                                                                                                                                                                                                                              |
| ----------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_input_devices`    |                              | `string[]`                                                                                                                                                                                                                                                           |
| `start_pitch`           | `deviceName: string \| null` | `StreamInfo`, only after the stream really opened                                                                                                                                                                                                                    |
| `stop_pitch`            |                              | `void`                                                                                                                                                                                                                                                               |
| `start_recording`       | `deviceName: string \| null` | `{ name: string }`                                                                                                                                                                                                                                                   |
| `stop_recording`        |                              | `RecordingInfo`                                                                                                                                                                                                                                                      |
| `play_recording`        | `name`                       | `void`, returns at once                                                                                                                                                                                                                                              |
| `stop_playback`         |                              | `void`                                                                                                                                                                                                                                                               |
| `list_recordings`       |                              | `RecordingInfo[]`                                                                                                                                                                                                                                                    |
| `delete_recording`      | `name`                       | `void`, also deletes its meta                                                                                                                                                                                                                                        |
| `set_recording_meta`    | `name, note, tags`           | `void`                                                                                                                                                                                                                                                               |
| `get_profile`           |                              | `Profile \| null`                                                                                                                                                                                                                                                    |
| `set_profile`           | `profile`                    | `void`                                                                                                                                                                                                                                                               |
| `save_result`           | `result: NewResult`          | `number` (id)                                                                                                                                                                                                                                                        |
| `get_results`           |                              | `SavedResult[]`, all rows, newest first                                                                                                                                                                                                                              |
| `export_data`           | `format: "json" \| "csv"`    | `string \| null` file name, null if the dialog was cancelled                                                                                                                                                                                                         |
| `backup_create`         |                              | `string \| null` file name                                                                                                                                                                                                                                           |
| `backup_restore`        |                              | `RestoreSummary \| null`                                                                                                                                                                                                                                             |
| `delete_all_data`       |                              | `DeleteReport` `{ oldFolderRemoved, previousFolderRemoved, couldNotCheck }`, `couldNotCheck` when an older folder's database could not be read and the folder was left in place                                                                                      |
| `start_fresh`           |                              | `void`, skips the earlier-data move for good, opens an empty db, never touches the old folders                                                                                                                                                                       |
| `can_move_earlier_data` |                              | `boolean`, true when Start fresh skipped a move and nothing was saved since                                                                                                                                                                                          |
| `move_earlier_data`     |                              | `void`, the way back from `start_fresh`: drops the empty db and moves again, forgetting the skip only when that worked; `invalid_input` once anything was saved or after Delete all, `migration_failed` if the move fails again (the Start fresh choice then stands) |

Events: `pitch` (`PitchFrame`), `audio-error` (`AudioError`), `playback-ended` (`{ name: string }`).

The webview never sends a path. File dialogs open on the Rust side with `tauri-plugin-dialog`. `name` is validated: bare file name, `.wav`, no separators, must exist in the recordings folder.

## Task R1: pitch and spectrum (A1, A2 volume gate, A10, small: 96 kHz, 60 Hz hum)

New `src-tauri/src/dsp/{mod,pitch,spectrum}.rs`, pure functions, no Tauri. `lib.rs` calls them.

- `pitch.rs`: YIN with the proven fix: first dip under 0.15, descend to the local minimum, parabolic interpolation with the correct sign. The working version is `yin_whatif` in `audit_probes.rs`.
- Search range 60 to 1000 Hz at any sample rate. `window = next_pow2(sr * 0.04)`, `hop = window / 2`, shared helper.
- Volume gate: rms under 0.003 (about -50 dBFS) gives f0 0 and centroid 0.
- `spectrum.rs`: centroid with a cached FFT plan, Hann window, DC removed, limited to 100-5000 Hz.
- Known-answer tests: sine, harmonic stack and "oo"/"ah"/"ee" source-filter vowels at 100, 130, 165, 200, 255, 400 Hz, at 44.1, 48 and 96 kHz: within 5 cents. White noise gives 0. Quiet 60 Hz hum under the gate gives 0. Centroid of a pure 1 kHz tone within 2%.
- Move the generators out of `audit_probes.rs`; delete each probe once a real test covers it. Delete the file and its hook at the end of R3.

## Task R2: storage, backup, paths, errors (A5 crash half, A6, A7 limit, A11, A12)

New `error.rs` (hand-written `AppError`), `paths.rs`, `storage/{mod,db,backup}.rs`.

- `app_data_dir()` from Tauri for everything. One-time copy from the old `%APPDATA%\voice-trainer` when the new folder has no DB, with a marker; never change the old folder. The `recording_meta` keys go from full path to file name.
- `PRAGMA user_version` migrations. Add `voiced_s`, `scoring_version` (old rows 0), `baseline_centroid`, `baseline_rms`, `pitch_engine` (old profile 1). Queries take `&Connection`.
- No 200 limit. Unique key on `(exercise_id, created_at, score)` plus insert-or-ignore so a restore never duplicates.
- One backup format: zip holding `data.json` and `recordings/*.wav`, written to a temp file and renamed. Restore: read, validate every row (known exercise id shape, score 0-100, finite numbers, sane timestamps), then apply profile, results and meta in one transaction, then copy recordings. Reject zip-slip: entries must be `data.json` or `recordings/<bare>.wav`. Cap entry sizes. A bad file changes nothing and returns a real error.
- Also read old JSON backups (the `export_backup` format) so nobody's backup goes dead.
- `export_data` JSON and CSV (A: spec). CSV escapes formula-leading cells.
- `delete_all_data`.
- Known-answer tests: profile restored; restoring twice keeps the count; junk rows rejected with nothing changed; zip round trip; zip-slip rejected; delete refuses `../x.wav`; migration from an old DB fixture keeps rows; backup into the recordings folder cannot zero a file.

## Task R3: audio and commands (A5 crash half, A8, A9, A14)

New `audio/{mod,capture,pitch_stream,recorder,playback}.rs`, `commands.rs`. `lib.rs` is only the builder.

- One generic stream builder over sample formats replaces the 8 copies. Two input streams (pitch and recorder) stay as they are today.
- The audio callback does not allocate per call and never blocks: bounded queue with `try_send`, or the `ringbuf` already declared; drop and count on overflow. If `ringbuf` stays unused, remove it.
- `start_pitch` waits for the worker to report `stream.play()` success or the real error. cpal's error callback emits `audio-error`. Requested device missing: fall back to default and say `fellBack: true`.
- Recorder: flush the WAV header about every second, surface write errors with `audio-error` as `write_failed`, which ends the take, send audio dropped because the writer fell behind as `audio_lost`, which does not, finalize on stop. Every report carries `source: "recorder"`. A `device_lost` or `stream_failed` with that source ends the take like `write_failed` does; the same kinds with `source: "pitch"` leave the take alone, ms-precision file names. Drop `panic = "abort"` so `Drop` can finalize.
- Playback on its own thread, stop command, `playback-ended` event.
- Remove the opener plugin (Rust, npm, capability). Add `tauri-plugin-dialog`. Permissions minimal.
- CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src ipc: http://ipc.localhost`, with `devCsp` for Vite. `style-src` keeps inline only if React `style` props need it; the redesign sets gauge position with inline style.
- macOS mic text (`Info.plist`), Cargo description and authors placeholder cleaned, window title, `examples/analyze.rs` (`cargo run --example analyze file.wav`) printing median f0 so a real voice can be checked against a tuner.
- `.github/workflows/ci.yml`: windows and ubuntu, fmt, clippy `-D warnings`, tests, npm check. Cannot run here.
- Testable parts stay pure: sample conversion, framing (hop count, `tMs` from samples), WAV survives without `finalize` after a flush, name validation.

## Task T1: domain logic (A2, A3, A4, A7)

Pure TS, no React, in `src/domain/` and `src/i18n/`, plus `src/lib/tauri.ts` (typed wrappers for the contract). Old `scoring.ts` and `utils.ts` go when replaced. Convert the audit's probe cases into real tests that assert the right behaviour.

- `exercises.ts`: the 12 exercises from `App.tsx` moved over, with text in `i18n`. `measure` gets the kinds below.
- `pitchTracker.ts`: display value from raw frames. Median of the last 5 voiced frames, then EMA in log-frequency. Reset on 150 ms unvoiced. A jump over 3 semitones needs 3 agreeing frames, so slips vanish and real moves land (110 to 230 Hz must arrive within 100 ms, the audit's stuck-forever case). During gaps it holds the last value, flagged `held`, for 300 ms, then `null`.
- `session.ts`: accumulates frames. Voiced frames only feed pitch stats; time comes from `tMs`, never a frame-length guess; no 2000 cap; sound time (rms over gate) kept for Breath.
- `scoring.ts`, `SCORING_VERSION = 2`. Returns `{ status: "scored", score, detail } | { status: "not_enough_voice", voicedS }`. Minimum voiced coverage 30% of elapsed and 3 s, else not enough voice, and nothing is saved.

| measure                | score                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| `steady` (warm-up hum) | stability in cents only                                                                            |
| `sustained`            | in-band share x stability                                                                          |
| `range`                | in-band share                                                                                      |
| `raise`                | share in upper half of band and not over `targetMax`                                               |
| `glide`                | p5-p95 span in semitones plus smooth movement, several sweeps; one glitch scores low               |
| `mixed`                | as glide plus few breaks                                                                           |
| `intonation`           | pitch variation per phrase in a natural range; textbook rise and fall scores high, flat scores low |
| `breath`               | sound time and steadiness of rms, needs no pitch                                                   |
| `resonance`            | voiced frames over `baselineCentroid * 1.05`, labelled as a rough brightness                       |
| `articulation`         | pitch steadiness, labelled so                                                                      |

Known-answer cases must include every row in A3's table with the right result, plus A2's 1 s of voice + 8.5 s of silence.

- `stats.ts`: trend (first half vs second half, chronological, version-2 results only), streak, totals from all rows.
- `plan.ts`: daily plan, recommended list.
- `i18n/{en,es}.ts`: typed keys, parity test, all strings including tabs and errors.
- Mutation-style check: each scoring test must fail if its rule is removed.

## Task T2: safety and honest framing (A4), from `docs/research/voice-safety.md`

Use the research's ready text S1 to S14 word for word, in `i18n`. Spanish there still needs a native read.

`src/domain/safety.ts`: frames in, active notices out, with hysteresis (minimum display about 3 s, no flicker). Nothing here may claim to detect strain, damage or tiredness.

- Clipping from `peak >= 0.99`: a mic issue, not a voice one.
- Louder than you started: rms over 2x (6 dB) the median of this session's first 10 voiced seconds, sustained 2 s. Same mic, same session only: there is no sourced loudness limit, so it never reads as a safety level. Text builds on S13.
- Above your range: over `targetMax` for 5 s, neutral text.
- Voice break: S7 after 15 minutes of practice in one sitting. A reminder, never a "safe limit".
- Sudden pitch jump: neutral, never fires on silence.
- S4 (stop signs) is always visible on the exercise screen. S1, S3, S5, S6, S9 in onboarding and a Safety page. S8 on Home. S11 next to the band, S13 next to level, S14 next to brightness.

Scoring and stats changes from the research:

- `resonance` gets no score. Status `practice_only`, nothing that rewards a higher centroid: it could reward pushing (research section 5). Brightness shows as information with S14.
- `breath` scores steadiness only, never length. No contest to run out of air. Pitch readout off.
- `sustained` instructions: stop well before the end of the breath.
- Remove streaks and daily quotas. `stats.ts` reports days practised for the moon strip; a gap is not a loss.
- Wording pass: "your range", no "feminine/male" labels, no "passing", no "correct", no "feminization", no pass/fail colours. Intonation never teaches one pattern as the right one. Forward hum never claims it changed resonance.
- Default band: no direction assumed. Onboarding starts around the measured baseline and the person sets it.

## Task U: redesign, on `redesign/ui`

Direction from the user: the Moonlit Candle vibe. `DESIGN.md` records the design system as shipped, and `.impeccable/surfaces/src-app-tsx.md` holds the direction contract.

## Before going public

See `docs/going-public.md`.
