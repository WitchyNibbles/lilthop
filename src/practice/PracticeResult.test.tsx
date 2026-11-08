import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { steadyHz, stream, voiced } from "../domain/testFrames";
import { todaysRoutine } from "../home/routine";
import { translator } from "../i18n";
import {
  finishSession,
  openPractice,
  play,
  rail,
  stage,
  startSession,
} from "../test/driveApp";
import { backend, PROFILE, savedResult } from "../test/fakeBackend";
import { canvasContext, setReducedMotion } from "../test/fakeBrowser";

const t = translator("en");

/** What the real backend does: a saved session is there the next time results are read. */
function rememberSaves() {
  backend.handle("save_result", () => {
    backend.respond("get_results", [
      savedResult({
        exerciseId: "pitch_awareness",
        createdAt: Math.floor(Date.now() / 1000),
      }),
    ]);
    return 1;
  });
}

async function nextFrame() {
  await act(async () => {
    await new Promise((done) => requestAnimationFrame(done));
  });
}

async function practise() {
  await openPractice("pitch_awareness");
  startSession();
  play(stream(40, () => voiced(200)));
  await finishSession();
  await act(async () => {
    await Promise.resolve();
  });
}

const routineLength = () =>
  todaysRoutine(PROFILE.goals, [], new Date()).items.length;

const moon = () => stage().getByTestId("today-moon");
const phase = () => Number(moon().getAttribute("data-phase"));

afterEach(() => {
  vi.restoreAllMocks();
  setReducedMotion(false);
});

describe("after a saved session", () => {
  it("swaps the quiet sky for the session's notes, in the same strip", async () => {
    await openPractice("pitch_awareness");
    const slot = stage().getByTestId("notice-slot");
    expect(within(slot).getByTestId("quiet-sky")).toBeInTheDocument();
    startSession();
    play(stream(40, () => voiced(200)));
    await finishSession();
    expect(slot).toHaveTextContent(t("result.oneTake"));
    expect(within(slot).queryByTestId("quiet-sky")).not.toBeInTheDocument();
  });

  it("ticks the routine in the rail", async () => {
    rememberSaves();
    await practise();
    expect(
      await rail().findByRole("button", { name: /Pitch awareness.*Done/ }),
    ).toBeInTheDocument();
  });

  it("fills today's moon by the share of the routine done", async () => {
    rememberSaves();
    await practise();
    await vi.waitFor(() => expect(phase()).toBeGreaterThan(0));
    expect(
      screen.getByText(
        t("result.moonCaption", { done: 1, total: routineLength() }),
      ),
    ).toBeInTheDocument();
  });

  it("fills the moon over time, then stops at the new phase", async () => {
    rememberSaves();
    await practise();
    await vi.waitFor(() => expect(phase()).toBeGreaterThan(0));
    const lit = () => moon().querySelector(".moon-lit")?.getAttribute("d");
    expect(lit()).not.toBe(moon().getAttribute("data-end"));
    await vi.waitFor(
      () => expect(lit()).toBe(moon().getAttribute("data-end")),
      { timeout: 3_000 },
    );
  });

  it("ends in the same place with reduced motion on", async () => {
    setReducedMotion(true);
    rememberSaves();
    await practise();
    await vi.waitFor(() => expect(phase()).toBeGreaterThan(0));
    expect(moon().querySelector(".moon-lit")?.getAttribute("d")).toBe(
      moon().getAttribute("data-end"),
    );
  });

  it("leaves the moon as it was if the save fails", async () => {
    backend.fail("save_result", { kind: "database", message: "full" });
    await practise();
    expect(phase()).toBe(0);
  });

  it("names what was saved", async () => {
    await practise();
    expect(stage().getByText(t("result.savedNote"))).toBeInTheDocument();
    expect(t("result.savedNote")).toMatch(/result/i);
    expect(translator("es")("result.savedNote")).toMatch(/resultado/i);
  });

  it("keeps the thread on screen: the panel lets the trace show", async () => {
    await practise();
    expect(
      screen.getByRole("img", { name: /Pitch trace/ }),
    ).toBeInTheDocument();
    await nextFrame();
    canvasContext.reset();
    play(stream(1, () => voiced(210), 90_000));
    await nextFrame();
    expect(canvasContext.times("clearRect")).toBe(0);
  });
});

describe("where the result goes", () => {
  it("takes the readings' place beside the trace, off the thread", async () => {
    await practise();
    const score = stage().getByTestId("result-score");
    expect(score.closest(".live-column")).not.toBeNull();
    expect(moon().closest(".live-column")).not.toBeNull();
    expect(document.querySelector(".trace-window .result-panel")).toBeNull();
    expect(stage().queryByTestId("readout-value")).toBeNull();
  });

  it("leaves the one-take note in the strip, under the thread", async () => {
    await practise();
    const note = stage().getByText(t("result.oneTake"));
    expect(note.closest(".window-sill")).not.toBeNull();
    expect(stage().getByText(t("safety.s3"))).toBeInTheDocument();
  });

  it("gives the strip to an alert, which has something to ask", async () => {
    await practise();
    act(() => {
      backend.emit("audio-error", { kind: "write_failed", message: "full" });
    });
    expect(stage().queryByText(t("result.oneTake"))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("alert.dismiss") }));
    expect(stage().getByText(t("result.oneTake"))).toBeInTheDocument();
  });

  it("brings the readings back for the next try", async () => {
    await practise();
    fireEvent.click(stage().getByRole("button", { name: t("exercise.again") }));
    expect(stage().getByTestId("readout-value")).toBeInTheDocument();
    expect(stage().queryByTestId("result-score")).toBeNull();
  });
});

describe("a session that was too short", () => {
  it("has no moon to fill", async () => {
    await openPractice("pitch_awareness");
    startSession();
    play(steadyHz(1, 200));
    await finishSession();
    expect(stage().queryByTestId("today-moon")).toBeNull();
  });
});

describe("the error banner", () => {
  const raise = () => {
    act(() => {
      backend.emit("audio-error", { kind: "write_failed", message: "full" });
    });
  };

  it("stays out of the header in practice, in the strip under the trace", async () => {
    await openPractice("pitch_awareness");
    raise();
    expect(screen.getByRole("alert").closest(".window-sill")).not.toBeNull();
  });

  it("names the recording, and sits beside a saved result without clashing", async () => {
    await practise();
    raise();
    const alert = within(screen.getByRole("alert"));
    expect(alert.getByText(t("error.write_failed"))).toBeInTheDocument();
    expect(t("error.write_failed")).toMatch(/recording/i);
    expect(stage().getByText(t("result.savedNote"))).toBeInTheDocument();
  });

  it("takes its own row on other screens, above the page, covering nothing", async () => {
    backend.respond("get_profile", PROFILE);
    await openPractice("pitch_awareness");
    fireEvent.click(rail().getByRole("button", { name: "Home" }));
    raise();
    const banner = screen.getByRole("alert");
    expect(banner.closest("main")).toBeNull();
    expect(banner.nextElementSibling?.tagName).toBe("MAIN");
  });
});
