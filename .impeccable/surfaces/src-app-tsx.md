---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: []
---

# Surface brief: the app shell and practice stage

Scope: the whole Tauri window. Mode: Operate. Build path: code-led (no image generation here).
Audience, job: a trans person practising alone in a quiet room, glancing at the screen while making sound. Task: see honestly where the voice is against their own band, then see that they showed up.
Constraints: 800x600 must work with instructions and the safety line readable. Local assets only. Dark default, light mode kept. English and Spanish. No medical promises.
Open decisions: who the app serves (feminization only or broader) waits on the owner. Wording stays neutral, no direction picker.

## Direction contract

THESIS: The voice draws a line across a night window, and a band of candlelight shows where it wants to go. Past stays still; only the tip moves. Refuses the category default of a jittering needle or bar gauge, and the wellness-app card grid.

OWN-WORLD: Moonlit Candle. Aubergine night #0D0916, raised #1D1230 and #271A3D, text #F3EAF7, muted #A99AB9. Candle gold #FFD477 owns everything live and primary; lavender #B99AFF for navigation and secondary; hot pink #FF67B7 only for a stop-now moment. Atkinson Hyperlegible Next for words, Atkinson Hyperlegible Mono for measurements. Thin rules, soft offset shadows, no glass, no neon halos. A small drawn bunny in a witch hat. Moon phases as the mark of showing up.

STORY: You open it and it is quiet. You see tonight's routine, a row of moons, and one way to start. On the stage your voice becomes a gold thread. You stay in the band or you do not, and it tells you plainly. You finish, get an honest result, and a moon fills. A day off is a new moon, not a broken streak.

FIRST VIEWPORT: Left rail, about 200px, always there: bunny and app name, five nav items, tonight's routine as a short checklist, mic state and mic button pinned at the bottom. Stage fills the rest. Home: greeting line, moon strip of the last 14 days, next exercise as the primary gold action. Exercise: title and one-line instruction on top, full-width trace taking most of the height, target band across it, large mono Hz at the right of the trace, control row at the bottom, fixed safety line under it. No element changes size while sound comes and goes.

FORM: Stage and rail, dealt position 4 of my ordered list, with the full-width trace from position 1 and the moon strip from position 5, seed key b2261092.

Signature interaction: the trace. Drawn on canvas, 8 s window, log-frequency axis, gaps stay gaps, tip glows softly when in band, the bunny's ears perk in band. Motion grammar: the only continuous motion is the trace; everything else eases in once with a short exponential ease-out. Reduced motion freezes the bunny and steps the trace at a lower rate.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
