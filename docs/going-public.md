# Before going public

Nothing has been pushed. The GitHub repo exists but is empty. What's left is the owner's call.

## Done

- [x] Licence: GPL-3.0-or-later. `LICENSE` is the GPL-3 text; Cargo, `package.json` and the Tauri bundle say the same.
- [x] Cargo `authors`, `package.json` fields, and the bundle identifier (`com.witchynibbles.lilthop`; the move from `com.voice.trainer` copies the data over on first start).
- [x] Real README: what it is, what it is not, install, build, privacy, safety.
- [x] Privacy note: nothing leaves the machine, where data lives, how to delete it (README).
- [x] Safety note and sources (README, `docs/research/voice-safety.md`).
- [x] Icon: the witchy bunny, source in `src-tauri/icons/source/lilthop.svg`, all sizes generated with `tauri icon`.
- [x] Third-party licences: `THIRD-PARTY-NOTICES.md` (Rust crates, npm packages, the OFL text for the fonts), rebuilt with `npm run notices`. It ships with the app next to `LICENSE`.
- [x] Contribution notes and a code of conduct.
- [x] What stays in the repo: `.grimoire/`, `.impeccable/`, `docs/plans/`, `docs/research/`, `DESIGN.md`, `PRODUCT.md`, `.vscode/`. The old archive and audit are gone from the tree.
- [x] CI actions are pinned to commit SHAs.
- [x] No personal paths or old account details in the tree.
- [x] `repository` is set in `src-tauri/Cargo.toml` and `package.json` (https://github.com/WitchyNibbles/lilthop, created, still empty).

## History

Don't rewrite the history. Start a fresh repo from a clean tree. The old history stays on this machine only. See the first commit steps below.

## First commit steps

Use an empty folder that is not this repo.

```
git -C <this repo> archive --format=tar HEAD | tar -x -C <new empty folder>
cd <new empty folder>
git init -b main
git config user.name WitchyNibbles
git config user.email <public email>
git add .
git commit -m "Lilthop 0.1.0"
```

Fill in `<public email>` yourself. The folder holds no `.git`, no `node_modules`, no `target` and no `dist`.

## Still to do

- [ ] Pick the project name for good and check "Lilthop" doesn't collide with something.
- [ ] Make the first commit in a fresh repo, push, and tag `v0.1.0` (the release workflow runs on that tag).
- [ ] Run CI and the release workflow once on a real remote. Neither has run yet. CI has Windows and Linux jobs, no macOS job; the release workflow builds all three.
- [ ] Have a speech-language pathologist who works with trans voice read the safety text and the exercises. The README says nobody has.
- [ ] Have a native Spanish speaker read the whole Spanish text, safety text first.
- [ ] Test on real voices, not only synthetic signals: several people, phone tuner next to the app. So far it's one person's voice.
- [ ] Windows code signing. Releases are unsigned for now; the release notes explain SmartScreen.
- [ ] macOS notarization. Releases are unsigned for now; the release notes explain Gatekeeper. The mic permission text is in place but untested.
- [ ] `cargo audit` is not installed here, so it hasn't been run.
- [ ] `npm audit`: the only advisory is in a dev-only package (minimatch, GHSA-g3hv-75wg-m249). `npm audit --omit=dev` found 0. Run both again before release.

## Open questions for the owner

- The project name.
