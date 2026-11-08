# Contributing

Thanks for wanting to help. This is a small project, so keep changes small and say what they're for.

## Build and run

You need Node 22.22.2 or newer on 22, 24.15 or newer on 24, or 26 and up (the `engines` field in `package.json`), Rust stable, and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your system.

```sh
npm ci
npm run tauri dev
```

## Run the checks

The check script needs Python 3.11 or newer, and the full check also needs [uv](https://docs.astral.sh/uv/).

While you work, run the fast check on the tests that cover your change:

```sh
python3 .grimoire/check.py fast src/home/HomeScreen.test.tsx
```

Before you open a pull request, run the full one:

```sh
python3 .grimoire/check.py full --base "$(git merge-base HEAD main)"
```

It should end with `exit=0` and `dirty=no`. For Rust, from `src-tauri`:

```sh
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Write the test first, and make sure it fails before you fix the thing. The tests use synthetic signals, so a change to pitch or brightness code also needs a note on what you tried on a real voice.

If you change a dependency, run `npm run notices` and commit the new `THIRD-PARTY-NOTICES.md`. It stops if a dependency's licence doesn't fit GPL-3.0-or-later.

## English and Spanish

Every word the app shows exists in English and Spanish, in `src/i18n`. Change both in the same pull request. The tests check that both have the same keys and the same placeholders. If your Spanish isn't good, say so in the pull request and we'll sort it out together. Please don't paste in machine translation without saying.

## Safety wording

The app hears sound. It can't feel a throat. So:

- No medical promises. Don't say it treats, fixes, prevents or heals anything.
- No claims that a clinician or voice therapist made or checked something. Nobody has reviewed the safety text yet, and the README says so.
- Don't say the app can tell you're straining, tired or hurt. It can't.
- Real-voice testing so far is one person's voice. Don't write as if it's been tested on many.
- If it hurts, stop. Keep that line.

Sources for the safety text are in `docs/research/voice-safety.md`.

## Privacy

Nothing leaves the computer. No network calls, no telemetry, no accounts, no remote fonts or images. A change that breaks that won't be merged. Please don't put real recordings, paths from your machine or personal details in code, tests or issues.

## Licence

Your contributions are under GPL-3.0-or-later, like the rest of the project. Be kind to each other, see `CODE_OF_CONDUCT.md`.
