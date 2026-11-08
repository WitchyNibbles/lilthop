---
name: Lilthop
description: A quiet night window where the voice draws a gold thread against a band of candlelight.
colors:
  surface-stage: "#0d0916"
  surface-rail: "#140d21"
  surface-raised: "#1d1230"
  surface-hover: "#271a3d"
  surface-window: "#08050f"
  rule: "#38234d"
  rule-strong: "#8a76a0"
  text: "#f3eaf7"
  text-muted: "#a99ab9"
  gold: "#ffd477"
  lavender: "#b99aff"
  pink: "#ff67b7"
  on-action: "#0d0916"
  action: "#ffd477"
  action-hover: "#ffe3a3"
  action-edge: "#ffd477"
  focus: "#b99aff"
  selection: "#633b79"
  moon-full: "#ffd477"
  moon-crater: "#ffe3a3"
  moon-new: "#1d1230"
  moon-rim: "#8a76a0"
  trace-line: "#ffd477"
  trace-tip: "#fff1c9"
  trace-glow: "#ffd47799"
  trace-band: "#ffd4773d"
  trace-band-edge: "#a8843f"
  trace-grid: "#38234d"
  trace-label: "#a99ab9"
  chart-line: "#9676ff"
  chart-old: "#6f5e84"
  chart-grid: "#38234d"
typography:
  display:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, Segoe UI, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 650
    lineHeight: "2.25rem"
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, Segoe UI, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 650
    lineHeight: "1.75rem"
    letterSpacing: "-0.01em"
  lead:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, Segoe UI, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: "1.625rem"
  body:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, Segoe UI, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: "1.375rem"
  label:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, Segoe UI, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.125rem"
  readout:
    fontFamily: "Atkinson Hyperlegible Mono Variable, ui-monospace, monospace"
    fontSize: "clamp(2.75rem, 9vmin, 4.5rem)"
    fontWeight: 400
    lineHeight: 1
    fontFeature: "tnum"
  measure:
    fontFamily: "Atkinson Hyperlegible Mono Variable, ui-monospace, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.125rem"
    fontFeature: "tnum"
rounded:
  check: "0.25rem"
  radius: "0.5rem"
  round: "50%"
spacing:
  space-1: "0.25rem"
  space-2: "0.5rem"
  space-3: "0.75rem"
  space-4: "1rem"
  space-5: "1.25rem"
  space-6: "1.75rem"
  control-height: "2.375rem"
  rail-width: "12.5rem"
  live-column-width: "clamp(10.5rem, 20vw, 16rem)"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    rounded: "{rounded.radius}"
    padding: "0 1rem"
    height: "{spacing.control-height}"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
    textColor: "{colors.on-action}"
  button-primary-disabled:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-muted}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.radius}"
    padding: "0 1rem"
    height: "{spacing.control-height}"
  button-secondary-hover:
    backgroundColor: "{colors.surface-hover}"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.radius}"
    size: "{spacing.control-height}"
  input:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.radius}"
    padding: "0 0.75rem"
    height: "{spacing.control-height}"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.radius}"
    padding: "0 0.5rem"
    height: "2.125rem"
  nav-item-hover:
    backgroundColor: "{colors.surface-hover}"
    textColor: "{colors.text}"
  nav-item-current:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.lavender}"
  trace-frame:
    backgroundColor: "{colors.surface-window}"
    rounded: "{rounded.radius}"
  window-sill:
    backgroundColor: "{colors.surface-rail}"
  notice-card:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    padding: "0.25rem 0.75rem"
  alert:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.radius}"
    padding: "0.5rem 0.75rem"
  readout-value:
    textColor: "{colors.gold}"
    typography: "{typography.readout}"
---

# Design System: Lilthop

## Overview

**Creative North Star: "Moonlit Candle"**

The app is a dark window at night. The voice draws a gold thread across it, and a band of candlelight shows where the person chose to aim. The past stays still and only the tip moves. It is built for someone alone in a quiet room, glancing at the screen while making sound, so it stays calm, steady and readable from arm's length.

The screen is a stage and a rail: compact and dense, with thin rules and tonal layers. It has no card grid, no gauge and no needle. A small bunny in a witch hat and a row of moons carry the character. Showing up is marked by a moon filling, never by a streak.

The only continuous motion is the trace. Everything else eases in once and stops.

**Key Characteristics:**

- Aubergine night, gold for what is live and primary, lavender second, pink rare.
- A permanent stage: trace frame, readout gutter and a strip under the canvas.
- Nothing moves when sound comes and goes.
- Meaning is always carried by shape and words as well as colour.
- Fully local: two bundled fonts, inline SVG, a canvas trace.

## Colors

Warm candle tones on a deep aubergine night, with one hot accent kept for attention.

### Primary

- **Candle Gold** (#ffd477): The thread, the primary action, the live pitch number, a checked box, a pressed toggle, the mic-on state, today's weekday and full moons.

### Secondary

- **Moon Lavender** (#b99aff): The current nav item, hovered routine rows, the focus ring, the bunny's hat and the welcome sparks. Charts use a deeper violet (#9676ff) for the line.

### Tertiary

- **Hot Pink** (#ff67b7): Only the rest-break notice icon and the icon on the stop heading.

### Neutral

- **Aubergine Night** (#0d0916): The stage.
- **Rail Dusk** (#140d21): The rail and the strip under the trace.
- **Raised Plum** (#1d1230): Fields, filled notices, alerts, dialogs and the current nav item.
- **Hover Plum** (#271a3d): Hover fills.
- **Window Black** (#08050f): The trace window and other night scenes.
- **Thin Rule** (#38234d): Dividers and grid lines. Decorative only.
- **Strong Rule** (#8a76a0): Control borders and moon rims. Holds 3:1.
- **Moon White** (#f3eaf7) and **Dusk Text** (#a99ab9): Main and secondary text.

Light mode keeps every token name (a test holds the two lists equal) and moves to pale lilac paper. Gold darkens to #7a5200 for text and #8a5f00 for the thread, lavender to #5a3db0 and pink to #b0126a. The primary action stays candle gold (#ffd477) with a dark edge (#8a5f00). The full set lives in `src/styles/tokens.css`.

### Named Rules

**The Rare Pink Rule.** Pink marks a moment that needs attention, and only as a small icon: the rest break and the stop heading. It never fills a surface, colours running text, or decorates. The permanent safety line under the controls stays muted, so pink keeps its meaning.

**The Own Range Rule.** The only reading whose colour changes is live pitch, and it changes against the person's own range: gold in the band, plain text above or below it. Brightness is always plain text, so it can never read as praise. Other gold numbers hold one colour at every value, so gold on a number never grades it.

**The One File Rule.** Every colour lives in `tokens.css`. Components name a token and never a raw hex. Text holds 4.5:1 and graphics 3:1 on every surface, in both themes.

## Typography

**Body Font:** Atkinson Hyperlegible Next (with system-ui, Segoe UI, sans-serif)
**Label/Mono Font:** Atkinson Hyperlegible Mono (with ui-monospace, monospace)

**Character:** One legible humanist voice for words and its mono twin for anything measured. Friendly and plain, chosen to be read at a glance.

### Hierarchy

- **Display** (650, 1.75rem, 2.25rem line): The Home greeting only.
- **Title** (650, 1.375rem, 1.75rem line): Screen titles, the safety headings and the live status words.
- **Lead** (400, 1.125rem, 1.625rem line): Safety text and the calibration passage. In the onboarding safety step it drops to body so the step fits one screen.
- **Body** (400, 0.9375rem, 1.375rem line): Default text. Long text stops at 60ch.
- **Label** (400 or 650, 0.8125rem, 1.125rem line): Reading labels, notices, notes and small section headings, in sentence case.
- **Readout** (400, mono, clamp(2.75rem, 9vmin, 4.5rem), line height 1): The live reading and the result score.
- **Measure** (400, mono, 0.8125rem): Units, the target range and calibration time.

### Named Rules

**The Mono Measurement Rule.** Live readings, scores and the target range are mono with tabular digits. Timers and recording lengths keep tabular digits in the sans. Readouts always hold four characters, so a number can never change width.

**The Two Atkinson Rule.** Only the two Atkinson families are used, and both are bundled with the app. No font ever loads from a network.

## Layout

The window is a rail and a stage. The rail (12.5rem) sits on the left and holds the bunny, five nav items, today's routine and the mic panel pinned to the bottom. The stage fills the rest and scrolls on its own.

On Practice, the stage stacks a title with its one-line instruction, the trace frame, the control row and the safety line. The instruction keeps a fixed two lines and the safety line keeps two. Inside the trace frame, the canvas takes the free height (at least 13rem) with the strip under it, and the readout gutter runs the full height beside both.

Spacing runs on a tight 0.25rem to 1.75rem scale. Controls are 2.375rem tall. Pages keep to 44rem to 68rem. Home widens to 60rem at 64rem by 44rem and up, where the 14 moons rise in an arc over a horizon.

At 40rem wide and below, the layout stacks into one scrolling column. The rail wraps across the top and drops the routine. The canvas is a fixed 16rem, then the strip, then the gutter as a row below. The native window stops at 800x600, so people reach this layout through zoom: 200% zoom gives 400x300, the smallest size it is built for.

### Named Rules

**The Clear Window Rule.** Nothing covers the band or the thread. Notices, alerts and a session's notes live in the strip. The result takes the readings' place in the gutter, so the thread just drawn stays in view.

**The One Voice Rule.** The strip says one thing at a time: clipping, louder and the rest reminder first, then an alert, then the neutral notices, then a finished session's notes. A rest reminder that has waited 30 seconds takes the strip for its ten seconds, then the others come back. Away from Practice it uses the alert row. With nothing to say the strip shows a quiet strip of night sky.

**The Reserved Slot Rule.** Everything on the practice stage that can change has its size kept in advance: the strip, the status (three lines), the instruction, the safety line and the readout. A notice arriving moves nothing, and the zone only changes once the new zone has lasted, so the status never flickers. A long result scrolls inside the gutter.

**The Small Window Rule.** At 800x600 the instruction and safety line stay fully readable in English and Spanish, and the onboarding safety step fits one screen, in Spanish too. Tests cap instructions at 150 characters and strip text at 190. New copy keeps inside those limits.

## Elevation & Depth

Depth comes from tonal layers and thin rules: the window is darkest, then the stage, rail and raised plum. Soft shadows are used only for things that float. No glass and no blur. The only light in the system is on the canvas: the band's soft ellipse and a small glow on the tip while it is in the band.

### Shadow Vocabulary

- **Small** (`box-shadow: 0 2px 6px #00000040`): The primary button and the chart tooltip.
- **Floating** (`box-shadow: 0 8px 24px #00000059`): Dialogs and alerts above a page. An alert in the strip drops it and sits flat.

### Named Rules

**The Candle Light Rule.** Glow belongs to the trace. It marks the voice being in the band and appears nowhere else.

## Shapes

One gentle radius (0.5rem) for buttons, fields, frames and dialogs, with 0.25rem for checkboxes. Circles are for moons, routine marks and chart marks. Lines are 1px rules. Icons and the bunny share one drawn language: round caps and joins on a light stroke (1.75 for icons, 2 for the bunny). Regions are separated by neutral rules, not by boxes inside boxes.

## Components

### Buttons

Plain and quiet, with one gold action per view.

- **Shape:** Gently curved (0.5rem), 2.375rem tall.
- **Primary:** Gold fill, dark text, weight 650, small shadow, with a stronger edge in light mode.
- **Secondary:** Transparent with a strong rule border. Hover fills with hover plum.
- **Icon toggle:** Square. When pressed, border and icon turn gold.
- **Focus:** A 2px lavender ring, offset 2px, on every control.
- **Disabled:** Thin rule border and muted text. A disabled primary loses its gold and its shadow.

### Inputs / Fields

- **Style:** Raised plum, strong rule border, 0.5rem radius, full control height.
- **Select:** The same box with a drawn chevron.
- **Checkbox:** Drawn by the theme. A gold fill with a dark tick when checked.
- **Failure:** Weight 650 in main text colour, in a line that already holds its place.

### Navigation

Rail items pair an icon with a label, muted at rest. Hover fills and brightens the text. The current page sits on raised plum in lavender. When stacked, the items wrap in a row at the top.

### Trace

The signature. A canvas over an 8 second sweep on a log pitch axis. The thread is 2.5px gold with round ends, and gaps stay gaps. The previous sweep fades back and clear space runs ahead of the tip. The band is a soft ellipse of candlelight between two thin edges. Mono tick labels sit on faint grid lines. The trace freezes when a session ends, so the result can be read against it.

### Readout and zone mark

The label sits over a large mono number with its unit. With no reading it shows three dashes in the same slot, and a reading with nothing fresh dims in place. Beside it, a drawn mark shows a bar with a chevron above and below. The chevron goes bold above or below the band, and the bar fills in the band. Words in the status line say the same thing.

### Strip notices

Filled with raised plum, a small icon and label text. Most notices carry a gold flame. The rest break carries a pink stop sign. Notices have no coloured edge of any kind.

### Moons

A practised day is a full gold moon with soft maria. A partly done day waxes. A day off is a new moon with a thin rim, which reads as an ordinary night. Future days are small dots. The moon filling after a save (1.4s) is the one authored moment in the app.

### Art and motion

All art is inline SVG in token colours: the bunny, the moons, the icons, the quiet sky and the welcome scene. The bunny's ears rise in the band (240ms). State changes use a 200ms exponential ease-out. With reduced motion the ears stay still, nothing eases in, the moon goes straight to its phase and the trace steps about four times a second.

## Do's and Don'ts

### Do:

- **Do** keep every notice, alert and note in the strip and every result in the gutter.
- **Do** reserve the space for anything that can appear on the practice stage before it appears.
- **Do** pair every colour meaning with a drawn mark and words.
- **Do** use the moon strip to show practice. A gap is a new moon and not a loss.
- **Do** keep the safety line and instructions readable at 800x600 in English and Spanish.
- **Do** check new layouts stacked, down to 400x300.
- **Do** honour reduced motion in anything that moves.
- **Do** keep wording plain and free of medical promises. The app measures sound and cannot judge a throat or a voice.

### Don't:

- **Don't** put anything over the band or the thread.
- **Don't** use pink for anything but the two attention icons, and don't add new pink moments lightly.
- **Don't** colour a reading against anything but the person's own range, and don't give brightness the accent.
- **Don't** put a coloured stripe down the side of a notice. Neutral 1px rules between regions are fine.
- **Don't** add streaks, streak counts or any language of loss.
- **Don't** load remote assets or fonts, and don't add raster art. Art is inline SVG, and the trace is canvas.
- **Don't** add glows beyond the trace, or glass, or a second continuous motion.
- **Don't** write raw hex outside `tokens.css`.
