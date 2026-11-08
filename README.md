# Lilthop

A free desktop app for practicing your voice on your own. It shows your pitch live against a range you pick, walks you through short exercises, and keeps your recordings and progress on your computer.

Made for trans women and transfeminine people working toward a higher, more feminine voice. It's in English and Spanish.

Installers for Windows, Linux and macOS are on the [releases page](https://github.com/WitchyNibbles/lilthop/releases). They are unsigned, so your system warns you the first time; the release notes say how to open them. Problems go to [issues](https://github.com/WitchyNibbles/lilthop/issues). The automated tests use synthetic signals. Real-voice testing so far is the owner's own voice only.

## Licence

GPL-3.0-or-later, see `LICENSE`. Third-party licences are in `THIRD-PARTY-NOTICES.md`; `npm run notices` rebuilds it.

## Private by design

Nothing leaves your computer. No account, no telemetry, no network calls, no remote fonts or images. The content security policy blocks outside connections, and the webview never sees a file path. Settings has backup, export and a real delete-everything button.

Your data lives in the app's data folder: `%APPDATA%\com.witchynibbles.lilthop` on Windows, `$XDG_DATA_HOME/com.witchynibbles.lilthop` on Linux, `~/Library/Application Support/com.witchynibbles.lilthop` on macOS. The app used to be called Voice Trainer (`com.voice.trainer`). On first start, Lilthop copies that folder's database and recordings over, checks the copy, and leaves the old folder as it was. If the copy fails, the app says so and offers a retry instead of starting empty. Lilthop only reads that folder if its database really is this app's. "Delete all data" removes the app's own files from the old folders too, and leaves anything else that is in them.

## What it can't do

The app hears sound. It can't feel your throat. It measures pitch, level and a rough brightness, and it can't tell if you're straining, tired or hurt. There's no support behind it: no voice therapist or doctor made or checked it, and no one is on hand to help. It doesn't replace a voice therapist. The sources we read recommend a professional check before practicing on your own. If you can get one, do. If it hurts, stop.

**En español.** La app oye el sonido, pero no siente tu garganta. Mide el tono, el volumen y un brillo aproximado, y no puede saber si estás forzando, si tienes la voz cansada o si te haces daño. No tiene ningún apoyo detrás: no la hizo ni la revisó nadie de terapia de voz ni de medicina, y no hay nadie para ayudarte. No sustituye a la terapia de voz. Las fuentes que leímos recomiendan una revisión profesional antes de practicar por tu cuenta. Si puedes, hazla. Si te duele, detente.

See `docs/research/voice-safety.md` for what the app's safety text rests on. No clinician has reviewed it yet. (Mira `docs/research/voice-safety.md` para saber en qué se apoya el texto de seguridad de la app. Ninguna persona profesional lo ha revisado todavía.)

## Run it

You need Node 22.22.2 or newer on 22, 24.15 or newer on 24, or 26 and up (the `engines` field in `package.json`; the test tools ask for exactly that), Rust stable, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your system.

```sh
npm ci
npm run tauri dev
```

Build a release:

```sh
npm run tauri build
```

## Check it

The check script needs Python 3.11 or newer, and the full check also needs [uv](https://docs.astral.sh/uv/) (it runs `diff-cover` through `uvx`).

```sh
python3 .grimoire/check.py full --base "$(git merge-base HEAD main)"
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

See how far behind the mic the pitch trace runs (dev builds): in the webview console run `localStorage["lilthop-timing"] = "1"` and reload. The console then prints a timing line.

Compare the pitch reading on a real recording with a tuner:

```sh
cd src-tauri && cargo run --example analyze path/to/file.wav
```

## Contribute

See `CONTRIBUTING.md` for how to build, run the checks and keep both languages in step, and `CODE_OF_CONDUCT.md` for how we treat each other.

## How it's put together

- `src-tauri/src/dsp`: pitch (YIN) and brightness, pure functions with known-answer tests.
- `src-tauri/src/audio`: capture, recorder, playback, each on its own thread.
- `src-tauri/src/storage`: SQLite, backup and restore, export.
- `src/domain`: what the numbers mean. Pitch smoothing for display, sessions, scoring, safety notices, stats. No React.
- `src/live`, `src/practice`, `src/home` and friends: the UI.
- `docs/plans/2026-11-06-fix-and-redesign.md`: the IPC contract and the plan.
- `docs/going-public.md`: what's left before this goes public.
