import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { endMs, hiss, steadyHz, stream, voiced } from "../domain/testFrames";
import { translator } from "../i18n";
import { backend } from "../test/fakeBackend";
import { FakeAudioContext } from "../test/fakeBrowser";
import {
  boot,
  clickAndSettle,
  finishSession,
  goTo,
  openPractice,
  pickExercise,
  play,
  rail,
  stage,
  startMic,
  startSession,
} from "../test/driveApp";

const t = translator("en");
const REST_BREAK_S = 15 * 60 + 1;
const later =
  (offsetMs: number) =>
  <Frame extends { readonly tMs: number }>(frame: Frame): Frame => ({
    ...frame,
    tMs: frame.tMs + offsetMs,
  });

describe("the mic on the practice screen", () => {
  it("starts right here, with no trip to Home", async () => {
    await boot();
    goTo("Practice");
    await clickAndSettle(stage().getByRole("button", { name: "Start mic" }));
    expect(backend.callsTo("start_pitch")).toHaveLength(1);
    expect(
      stage().getByRole("button", { name: "Start session" }),
    ).toBeInTheDocument();
  });

  it("offers Start mic once, in the stage, and Stop mic in the rail once on", async () => {
    await boot();
    goTo("Practice");
    expect(screen.getAllByRole("button", { name: "Start mic" })).toHaveLength(
      1,
    );
    expect(rail().queryByRole("button", { name: "Start mic" })).toBeNull();
    await clickAndSettle(stage().getByRole("button", { name: "Start mic" }));
    expect(
      rail().getByRole("button", { name: "Stop mic" }),
    ).toBeInTheDocument();
  });

  it("says the mic is off once, in the live status", async () => {
    await boot();
    goTo("Practice");
    const seen = screen
      .getAllByText(t("reading.micOff"))
      .filter((line) => !line.classList.contains("sr-only"));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveClass("live-status");
  });
});

describe("what stays on screen", () => {
  it("S4 is in the page when idle, running and on the result", async () => {
    await boot();
    goTo("Practice");
    expect(stage().getByText(t("safety.s4"))).toBeInTheDocument();
    await startMic();
    expect(stage().getByText(t("safety.s4"))).toBeInTheDocument();
    startSession();
    expect(stage().getByText(t("safety.s4"))).toBeInTheDocument();
    await finishSession();
    expect(stage().getByText(t("safety.s4"))).toBeInTheDocument();
  });

  it("S4 is there for every exercise", async () => {
    await boot();
    goTo("Practice");
    for (const id of ["breath", "resonance", "glides"]) {
      pickExercise(id);
      expect(stage().getByText(t("safety.s4"))).toBeInTheDocument();
    }
  });

  it("shows the name and the full instruction", async () => {
    await boot();
    goTo("Practice");
    pickExercise("sustained_tone");
    expect(
      stage().getByRole("heading", { name: t("exercise.sustained_tone.name") }),
    ).toBeInTheDocument();
    expect(
      stage().getByText(t("exercise.sustained_tone.instructions")),
    ).toBeInTheDocument();
  });

  it("S11 sits next to the band with the band's numbers", async () => {
    await openPractice("pitch_awareness");
    expect(stage().getByText(t("safety.s11"))).toBeInTheDocument();
    expect(stage().getByText(/165.*255/)).toBeInTheDocument();
    expect(stage().queryByText(t("safety.s15"))).toBeNull();
  });

  it("pitch raising carries S15, to go only as high as feels easy", async () => {
    await openPractice("pitch_raising");
    expect(stage().getByText(t("safety.s15"))).toBeInTheDocument();
    expect(stage().queryByText(t("safety.s11"))).toBeNull();
    expect(stage().getByText(/165.*255/)).toBeInTheDocument();
  });
});

describe("the live column", () => {
  it("reads pitch in whole Hz", async () => {
    await openPractice("pitch_awareness");
    play(steadyHz(1, 200.4));
    expect(stage().getByTestId("readout-value")).toHaveTextContent("200");
  });

  it("says where the voice is against the band, in words", async () => {
    await openPractice("pitch_awareness");
    play(steadyHz(1, 200));
    expect(stage().getByText(t("reading.inBand"))).toBeInTheDocument();
  });

  it("draws where the voice is, so the zone is not told by colour alone", async () => {
    await openPractice("pitch_awareness");
    const mark = () => stage().getByTestId("zone-mark");
    expect(mark()).toHaveAttribute("data-zone", "quiet");
    play(stream(2, () => voiced(300)));
    expect(mark()).toHaveAttribute("data-zone", "above");
    expect(stage().getByTestId("readout-value")).toHaveAttribute(
      "data-zone",
      "above",
    );
    play(stream(2, () => voiced(120), 2000));
    expect(mark()).toHaveAttribute("data-zone", "below");
    play(stream(2, () => voiced(200), 4000));
    expect(mark()).toHaveAttribute("data-zone", "in");
  });

  it("says above and below", async () => {
    await openPractice("pitch_awareness");
    const high = steadyHz(1, 320);
    play(high);
    expect(stage().getByText(t("reading.aboveBand"))).toBeInTheDocument();
    play(steadyHz(1.5, 120, endMs(high)));
    expect(stage().getByText(t("reading.belowBand"))).toBeInTheDocument();
  });

  it("shows level and S13 for breath, with no pitch at all", async () => {
    await openPractice("breath");
    play(stream(1, () => hiss(0.1)));
    expect(stage().getByText(t("safety.s13"))).toBeInTheDocument();
    expect(stage().getByText(t("reading.level"))).toBeInTheDocument();
    expect(stage().getByTestId("readout-value")).toHaveTextContent("-20");
    expect(stage().queryByText(t("reading.pitch"))).toBeNull();
    expect(stage().queryByText(t("safety.s11"))).toBeNull();
  });

  it("shows brightness and S14 for the forward hum", async () => {
    await openPractice("resonance");
    play(stream(1, () => voiced(200, 2400)));
    expect(stage().getByText(t("safety.s14"))).toBeInTheDocument();
    expect(stage().getByText(t("reading.brightness"))).toBeInTheDocument();
    expect(stage().getByTestId("readout-value")).toHaveTextContent("2400");
  });
});

describe("the brightness number", () => {
  it("stays neutral: the pitch being in range says nothing about it", async () => {
    await openPractice("resonance");
    play(stream(1, () => voiced(200, 2400)));
    const digits = stage().getByTestId("readout-value");
    expect(digits).not.toHaveAttribute("data-zone");
    expect(digits).toHaveAttribute("data-neutral", "true");
  });
});

describe("notices", () => {
  it("shows the safety monitor's notice on the exercise screen", async () => {
    await openPractice("pitch_awareness");
    play(stream(0.5, () => ({ ...voiced(200), peak: 1 })));
    expect(stage().getByText(t("notice.clipping"))).toBeInTheDocument();
  });

  it("has a strip of its own under the trace, never on it", async () => {
    await boot();
    goTo("Practice");
    const slot = stage().getByTestId("notice-slot");
    expect(slot.closest(".window-sill")).not.toBeNull();
    expect(slot.closest(".trace-window")).toBeNull();
  });

  it("puts the alert in that strip too", async () => {
    await openPractice("pitch_awareness");
    act(() => {
      backend.emit("audio-error", { kind: "write_failed", message: "full" });
    });
    const alert = screen.getByRole("alert");
    expect(alert.closest(".window-sill")).not.toBeNull();
    expect(alert.closest(".trace-window")).toBeNull();
  });

  it("lets a safety notice speak first: the alert waits and comes back", async () => {
    await openPractice("pitch_awareness");
    act(() => {
      backend.emit("audio-error", { kind: "write_failed", message: "full" });
    });
    const clipped = stream(0.5, () => ({ ...voiced(200), peak: 1 }));
    play(clipped);
    expect(stage().getByText(t("notice.clipping"))).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    play(stream(6, () => voiced(200)).map(later(endMs(clipped))));
    expect(stage().queryByText(t("notice.clipping"))).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      t("error.write_failed"),
    );
  });

  it("keeps the same order of notices in the strip", async () => {
    await openPractice("pitch_awareness");
    play(stream(0.5, () => ({ ...voiced(300), peak: 1 })));
    expect(stage().getByTestId("notice-slot")).toHaveAttribute(
      "data-notice",
      "clipping",
    );
  });

  it("marks the rest break, the one notice that asks you to stop", async () => {
    await openPractice("pitch_awareness");
    play(stream(REST_BREAK_S, () => voiced(200)));
    expect(stage().getByText(t("safety.s7"))).toBeInTheDocument();
    expect(stage().getByTestId("notice-slot")).toHaveAttribute(
      "data-notice",
      "restBreak",
    );
  });

  it("announces it politely in a slot that is always there", async () => {
    await openPractice("pitch_awareness");
    const slot = stage().getByTestId("notice-slot");
    expect(slot).toHaveAttribute("aria-live", "polite");
    play(stream(0.5, () => ({ ...voiced(200), peak: 1 })));
    expect(stage().getByTestId("notice-slot")).toBe(slot);
  });
});

describe("metronome", () => {
  it("is offered only by exercises that have one", async () => {
    await openPractice("articulation");
    expect(
      stage().getByRole("button", { name: t("metronome.label") }),
    ).toBeInTheDocument();
    pickExercise("sustained_tone");
    expect(
      stage().queryByRole("button", { name: t("metronome.label") }),
    ).toBeNull();
  });

  it("ticks once turned on, and stops with the screen", async () => {
    await openPractice("articulation");
    fireEvent.click(
      stage().getByRole("button", { name: t("metronome.label") }),
    );
    expect(FakeAudioContext.instances).toHaveLength(1);
    goTo("Home");
    expect(FakeAudioContext.instances[0]?.closed).toBe(true);
  });

  it("keeps the tempo in 30 to 240 however it is typed", async () => {
    await openPractice("articulation");
    const tempo = stage().getByRole("spinbutton", {
      name: t("metronome.tempo"),
    });
    fireEvent.change(tempo, { target: { value: "900" } });
    fireEvent.blur(tempo);
    expect(tempo).toHaveValue(240);
    fireEvent.change(tempo, { target: { value: "" } });
    fireEvent.blur(tempo);
    expect(tempo).toHaveValue(30);
  });

  it("restarts at the new tempo while it is ticking", async () => {
    await openPractice("articulation");
    fireEvent.click(
      stage().getByRole("button", { name: t("metronome.label") }),
    );
    fireEvent.change(
      stage().getByRole("spinbutton", { name: t("metronome.tempo") }),
      { target: { value: "120" } },
    );
    expect(FakeAudioContext.instances).toHaveLength(2);
    expect(FakeAudioContext.instances[0]?.closed).toBe(true);
  });
});

describe("words", () => {
  it("never uses pass or fail language on the screen", async () => {
    await openPractice("pitch_awareness");
    startSession();
    play(steadyHz(10, 120));
    await finishSession();
    const panel = screen.getByTestId("result-score").closest("section");
    expect(panel?.textContent).not.toMatch(/fail|wrong|bad|streak/i);
  });
});
