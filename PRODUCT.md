# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(A Tauri 2 desktop window: Windows first, Linux and macOS too. 800x600 default, resizable. The webview is local and no remote asset ever loads.)

## Users

Trans women and transfeminine people practising alone toward a higher, more feminine voice, most of them beginners with no coach. The owner chose this audience on 2026-11-08: voice feminization only, made for her own use and shared open source with other trans women. Pitch raising stays and there is no pitch lowering. Inferred from the owner's words and the spec: they practise in short sessions, often in a quiet room in the evening, often worried about being overheard, and often anxious about how they sound.

## Product Purpose

Give honest, private feedback on pitch and a simple daily routine, so someone can practise on their own without guessing. Success is that a stranger trusts what the app tells them and comes back the next day.

## Positioning

Free, open source, and fully local. Recordings and practice data never leave the machine. No account, no telemetry. (Licence and publishing are not decided yet.)

## Operating Context

A desktop or laptop with a mic, often headphones. A session is a few minutes per exercise. During an exercise the person is producing sound and glancing at the screen, not reading it, so the live state must be legible at a glance from arm's length.

## Capabilities and Constraints

- Live pitch from the mic (Rust, YIN), 13 exercises, scoring per exercise, calibration, target band, daily plan, progress, recordings with notes and tags, export, backup and restore, English and Spanish.
- Measures pitch, volume and a rough brightness. It cannot hear strain, damage or how a voice is perceived, and must never claim to.
- No network, no remote fonts or images, strict CSP.

## Brand Commitments

- From the owner: calm, dark by default with a light mode, a small witchy bunny mascot, English and Spanish.
- From the owner, 2026-11-06: the vibe of the witchyterm Claude theme, Moonlit Candle. Gold is the main accent, lavender second, hot pink only for moments that need attention.
- Voice: warm, plain, casual. No medical promises. Never gendered about the person. Never shaming: a low score is information, not a verdict.

## Evidence on Hand

No testimonials, users or clinical review exist yet. Do not invent them. Pitch accuracy is tested on synthetic signals only so far.

## Product Principles

1. Tell the truth: never show a number the app does not have grounds for.
2. Safety text shows when it matters, in plain words, and never pretends to diagnose.
3. Privacy is a feature you can see: nothing leaves the machine.
4. Calm under the eye: live feedback must be steady enough to practise against.
5. Kind to a nervous beginner.

## Accessibility & Inclusion

WCAG AA contrast (4.5:1 text, 3:1 for graphics), full keyboard use, screen reader labels, visible focus, no colour-only meaning, reduced motion respected, text that survives 200% zoom. Status changes announced politely, the live pitch itself is not.
