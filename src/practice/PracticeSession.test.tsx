import { act, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  concat,
  endMs,
  hiss,
  silent,
  steadyHz,
  stream,
  voiced,
} from "../domain/testFrames";
import { translator } from "../i18n";
import { backend, PROFILE } from "../test/fakeBackend";
import {
  clickAndSettle,
  finishSession,
  goTo,
  lastSavedResult,
  openPractice,
  pickExercise,
  play,
  rail,
  stage,
  startSession,
} from "../test/driveApp";

const t = translator("en");

describe("a session", () => {
  it("is unaffected by silence: it runs on, and silence adds no voice", async () => {
    await openPractice("pitch_awareness");
    startSession();
    const voice = steadyHz(10, 200);
    play(voice);
    play(silent(4, endMs(voice)));
    expect(
      stage().getByRole("button", { name: "Finish and save" }),
    ).toBeEnabled();
    await finishSession();
    const result = lastSavedResult();
    expect(result.voicedS).toBeCloseTo(10, 0);
    expect(result.durationS).toBeCloseTo(14, 0);
    expect(result.score).toBe(100);
  });

  it("saves through buildNewResult with the scoring version", async () => {
    await openPractice("pitch_awareness");
    startSession();
    play(steadyHz(10, 200));
    await finishSession();
    expect(lastSavedResult()).toMatchObject({
      exerciseId: "pitch_awareness",
      scoringVersion: 2,
    });
    expect(lastSavedResult().pitchMean).toBeCloseTo(200, 3);
  });

  it("measures a real 60 s run: no frame cap, time from the frames", async () => {
    await openPractice("pitch_awareness");
    startSession();
    const inBand = steadyHz(18, 200);
    play(concat(inBand, steadyHz(40, 120, endMs(inBand))));
    await finishSession();
    const result = lastSavedResult();
    expect(result.durationS).toBeCloseTo(58, 0);
    expect(result.score).toBeLessThan(35);
  });

  it("does not count 1 s of voice and 8.5 s of silence: nothing is saved, and it says why kindly", async () => {
    await openPractice("sustained_tone");
    startSession();
    const voice = steadyHz(1, 200);
    play(concat(voice, silent(8.5, endMs(voice))));
    await finishSession();
    expect(backend.callsTo("save_result")).toHaveLength(0);
    expect(stage().getByText(/Nothing was saved/)).toHaveTextContent(
      t("result.notEnoughVoice", { seconds: 1 }),
    );
  });

  it("uses the sound wording for breath", async () => {
    await openPractice("breath");
    startSession();
    play(silent(2));
    await finishSession();
    expect(stage().getByText(/Nothing was saved/)).toHaveTextContent(
      t("result.notEnoughSound", { seconds: 0 }),
    );
  });

  it("shows a score with no colour verdict and the mean pitch", async () => {
    await openPractice("pitch_awareness");
    startSession();
    play(steadyHz(10, 200));
    await finishSession();
    expect(stage().getByTestId("result-score")).toHaveTextContent("100");
    expect(
      stage().getByText(t("result.average", { mean: 200 })),
    ).toBeInTheDocument();
    expect(stage().getByText(t("measure.range.label"))).toBeInTheDocument();
    expect(stage().getByText(t("result.oneTake"))).toBeInTheDocument();
  });

  it("gives no mean pitch for breath", async () => {
    await openPractice("breath");
    startSession();
    play(stream(10, () => hiss(0.05)));
    await finishSession();
    expect(stage().getByTestId("result-score")).toBeInTheDocument();
    expect(stage().queryByText(/Average pitch/)).toBeNull();
  });

  it.each(["resonance", "forward_vowels"])(
    "brightness is practice only: no score, saved as a null-score row, for %s",
    async (id) => {
      await openPractice(id);
      startSession();
      play(stream(10, () => voiced(200, 2400)));
      await finishSession();
      expect(lastSavedResult().score).toBeNull();
      expect(stage().getByText(t("result.savedNote"))).toBeInTheDocument();
      expect(
        stage().getByText(t("result.practiceOnly", { hz: 2400 })),
      ).toBeInTheDocument();
      expect(stage().queryByTestId("result-score")).toBeNull();
    },
  );

  it("says saved only once it is saved", async () => {
    const release = backend.hold("save_result", 1);
    await openPractice("pitch_awareness");
    startSession();
    play(steadyHz(10, 200));
    await finishSession();
    expect(stage().getByText(t("result.saving"))).toBeInTheDocument();
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(stage().getByText(t("result.savedNote"))).toBeInTheDocument(),
    );
  });

  it("does not lose a result that failed to save", async () => {
    backend.fail("save_result", { kind: "database", message: "locked" });
    await openPractice("pitch_awareness");
    startSession();
    play(steadyHz(10, 200));
    await finishSession();
    await waitFor(() =>
      expect(stage().getByText(/could not be saved/)).toHaveTextContent(
        t("error.database"),
      ),
    );
    backend.respond("save_result", 1);
    await clickAndSettle(
      stage().getByRole("button", { name: t("result.retrySave") }),
    );
    await waitFor(() =>
      expect(stage().getByText(t("result.savedNote"))).toBeInTheDocument(),
    );
    expect(backend.callsTo("save_result")).toHaveLength(2);
  });

  it("reloads the results after saving", async () => {
    await openPractice("pitch_awareness");
    const before = backend.callsTo("get_results").length;
    startSession();
    play(steadyHz(10, 200));
    await finishSession();
    await waitFor(() =>
      expect(backend.callsTo("get_results").length).toBe(before + 1),
    );
  });

  it("stop throws the session away and saves nothing", async () => {
    await openPractice("pitch_awareness");
    startSession();
    play(steadyHz(10, 200));
    fireEvent.click(stage().getByRole("button", { name: t("common.stop") }));
    expect(backend.callsTo("save_result")).toHaveLength(0);
    expect(
      stage().getByRole("button", { name: "Start session" }),
    ).toBeInTheDocument();
  });

  it("counts down from the frames and finishes by itself", async () => {
    await openPractice("sustained_tone");
    expect(
      stage().getByText(t("exercise.timeLeft", { seconds: 45 })),
    ).toBeInTheDocument();
    startSession();
    const first = steadyHz(10, 200);
    play(first);
    expect(
      stage().getByText(t("exercise.timeLeft", { seconds: 36 })),
    ).toBeInTheDocument();
    await act(async () => {
      for (const frame of steadyHz(36, 200, endMs(first)))
        backend.emit("pitch", frame);
      await Promise.resolve();
    });
    expect(backend.callsTo("save_result")).toHaveLength(1);
  });

  it("keeps going across a mic restart without crediting the gap", async () => {
    await openPractice("pitch_awareness");
    startSession();
    play(steadyHz(6, 200));
    await clickAndSettle(rail().getByRole("button", { name: "Stop mic" }));
    await clickAndSettle(rail().getByRole("button", { name: "Start mic" }));
    play(steadyHz(6, 200));
    await finishSession();
    expect(lastSavedResult().voicedS).toBeCloseTo(12, 0);
  });

  it("locks the picker while running", async () => {
    await openPractice("pitch_awareness");
    startSession();
    expect(stage().getByRole("combobox")).toBeDisabled();
  });

  it("goes again from the result", async () => {
    await openPractice("pitch_awareness");
    startSession();
    play(steadyHz(10, 200));
    await finishSession();
    fireEvent.click(stage().getByRole("button", { name: t("exercise.again") }));
    expect(
      stage().getByRole("button", { name: "Start session" }),
    ).toBeInTheDocument();
    expect(stage().queryByTestId("result-score")).toBeNull();
  });

  it("picking another exercise leaves the result", async () => {
    await openPractice("pitch_awareness");
    startSession();
    play(steadyHz(10, 200));
    await finishSession();
    pickExercise("glides");
    expect(stage().queryByTestId("result-score")).toBeNull();
  });

  it("survives a look at another screen", async () => {
    await openPractice("pitch_awareness");
    startSession();
    const first = steadyHz(5, 200);
    play(first);
    goTo("Home");
    play(steadyHz(5, 200, endMs(first)));
    goTo("Practice");
    await finishSession();
    expect(lastSavedResult().voicedS).toBeCloseTo(10, 0);
  });

  it("will not start without a range to practise against", async () => {
    backend.respond("get_profile", { ...PROFILE, targetMinHz: 0 });
    await openPractice("pitch_awareness");
    expect(stage().getByText(t("exercise.needsRange"))).toBeInTheDocument();
    expect(
      stage().getByRole("button", { name: "Start session" }),
    ).toBeDisabled();
  });
});
