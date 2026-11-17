Lilthop is a free app for practicing your voice on your own. It is made for trans women and transfeminine people working toward a higher, more feminine voice. You see your pitch live, do short exercises, and keep your recordings and progress.

Everything stays on your computer. No account, no telemetry, no network calls.

It is still early days, so please be gentle with it, and with your voice.

## What's new in 0.1.1

### Fixed

- If your saved data can't be read, the app now opens and says so. In 0.1.0 it could fail to start without a word.
- Large backups restore. Before, a backup with many hours of recordings could be refused by the same app that made it.
- A microphone on one input of an audio interface is heard at its real level, in the live trace and in recordings.
- The status next to the trace is no longer cut off at the default window size. This was worst in Spanish.
- A problem with a recording no longer turns the live trace off.

### Changed

- Skip on "Set your range" keeps the range the app suggested. With no range yet, Practice shows a button that takes you to Settings.
- The button that drops a running session is now called Discard, and the app says that nothing was saved.
- If the microphone you chose is missing when you record, the app tells you it is using the default one.

Your data from 0.1.0 is kept. Install this version and open the app.

## Please read this first

- There is no professional support behind Lilthop, and it does not replace a voice therapist. No clinician has reviewed the app or its exercises.
- The app hears sound. It cannot feel your throat or tell if you are straining. If it hurts, stop.
- The app has a safety step, and the README has a safety section. Both are short and worth a minute.
- So far it has only been tested on one voice. Your pitch readings may be off. A phone tuner next to the app is a good check.

## Which file to download

- Windows: the `.exe` installer, or the `.msi` if you prefer that.
- Linux: the `.AppImage` (runs anywhere), the `.deb` (Debian, Ubuntu) or the `.rpm` (Fedora, openSUSE).
- Mac: the `.dmg`. It is one universal build for Apple Silicon and Intel. You can ignore the `.app.tar.gz`.

## These builds are not signed

Signing costs money, so for now your computer will warn you the first time. The files are built by GitHub from the public code.

- Windows: SmartScreen says "Windows protected your PC". Click More info, then Run anyway.
- Mac: macOS says the app "cannot be opened" or "is damaged". Right-click the app and choose Open. Or open System Settings, then Privacy & Security, and click Open Anyway. If it still says "is damaged", this command in Terminal clears the download flag:

```sh
xattr -dr com.apple.quarantine /Applications/Lilthop.app
```

## Problems

If something breaks, please tell us: https://github.com/WitchyNibbles/lilthop/issues

Please do not attach real recordings or personal details.

## En español

Lilthop es una app gratuita para practicar tu voz por tu cuenta, pensada para mujeres trans y personas transfemeninas. Todo se queda en tu ordenador: sin cuenta, sin telemetría.

Novedades de la 0.1.1: la app se abre y te avisa si no puede leer tus datos, y las copias de seguridad grandes ya se restauran. Un micrófono en una sola entrada de una interfaz de audio se oye a su nivel real, y el texto de estado ya no se corta en la ventana por defecto.

No hay ningún apoyo profesional detrás y no sustituye a la terapia de voz. Ninguna persona profesional la ha revisado. Si te duele, detente. Por ahora solo se ha probado con una voz.

Estas versiones no están firmadas, así que Windows o macOS pueden avisarte la primera vez. Las instrucciones de arriba (en inglés) explican cómo abrirla. Si algo falla, cuéntanoslo en https://github.com/WitchyNibbles/lilthop/issues
