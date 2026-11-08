import { act, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { stream, voiced } from "../domain/testFrames";
import {
  clickAndSettle,
  finishSession,
  goTo,
  play,
  rail,
  stage,
  startMic,
  startSession,
} from "../test/driveApp";
import { backend, recording } from "../test/fakeBackend";
import {
  open,
  record,
  stopRecording,
  t,
  visibleText,
} from "./recordingsTestKit";

const SCREENS = ["Home", "Practice", "Progress", "Recordings", "Settings"];

describe("while a recording runs", () => {
  it("says so on every screen, and never that the mic is off", async () => {
    await open();
    await record();
    for (const name of SCREENS) {
      goTo(name);
      expect(visibleText(t("recordings.recording"))).not.toHaveLength(0);
      expect(visibleText(t("reading.micOff"))).toHaveLength(0);
    }
  });

  it("stays in the rail on Practice, for the narrow layout where the stage is below the fold", async () => {
    await open();
    await record();
    goTo("Practice");
    const line = rail().getByText(t("recordings.recording"));
    expect(line).toHaveClass("mic-state");
    expect(line).toHaveAttribute("data-narrow-only", "true");
  });

  it("shows in the wide rail too once a result takes the live status's place", async () => {
    await open();
    await record();
    goTo("Practice");
    await startMic();
    startSession();
    play(stream(40, () => voiced(200)));
    await finishSession();
    expect(rail().getByText(t("recordings.recording"))).toHaveAttribute(
      "data-narrow-only",
      "false",
    );
  });

  it("goes back to the mic's own state once it stops", async () => {
    await open();
    await record();
    await stopRecording();
    expect(rail().getByText(t("reading.micOff"))).toBeInTheDocument();
    expect(visibleText(t("recordings.recording"))).toHaveLength(0);
  });
});

describe("when the disk stops taking the recording", () => {
  const writeFailed = {
    source: "recorder",
    kind: "write_failed",
    message: "full",
  };
  const writeFails = () =>
    act(async () => {
      backend.emit("audio-error", writeFailed);
      await Promise.resolve();
    });

  it("ends the take like Stop does, and shows what was written", async () => {
    await open([]);
    await record();
    backend.fail("stop_recording", { kind: "write_failed", message: "full" });
    backend.respond("list_recordings", [recording({ name: "rec_saved.wav" })]);
    await writeFails();
    expect(visibleText(t("recordings.recording"))).toHaveLength(0);
    expect(
      stage().getByRole("button", { name: t("recordings.record") }),
    ).toBeEnabled();
    await waitFor(() =>
      expect(
        stage().getByRole("button", { name: /^Play/ }),
      ).toBeInTheDocument(),
    );
  });

  it("says so once, though the stop fails with the same error", async () => {
    await open([]);
    await record();
    backend.fail("stop_recording", { kind: "write_failed", message: "full" });
    await writeFails();
    await waitFor(() =>
      expect(visibleText(t("recordings.recording"))).toHaveLength(0),
    );
    expect(visibleText(t("error.write_failed"))).toHaveLength(1);
  });

  it("still reports a stop that fails for some other reason", async () => {
    await open([]);
    await record();
    backend.fail("stop_recording", { kind: "stream_failed", message: "stuck" });
    await writeFails();
    await waitFor(() =>
      expect(stage().getByText(t("error.stream_failed"))).toBeInTheDocument(),
    );
  });

  it("keeps a take the backend could still close", async () => {
    await open([]);
    await record();
    backend.respond("stop_recording", recording({ name: "rec_kept.wav" }));
    await writeFails();
    await waitFor(() =>
      expect(
        stage().getByRole("button", { name: /^Play/ }),
      ).toBeInTheDocument(),
    );
  });

  it("stops only once, however many times the backend reports it", async () => {
    await open([]);
    await record();
    backend.fail("stop_recording", { kind: "write_failed", message: "full" });
    act(() => {
      backend.emit("audio-error", writeFailed);
      backend.emit("audio-error", writeFailed);
    });
    await waitFor(() =>
      expect(visibleText(t("recordings.recording"))).toHaveLength(0),
    );
    expect(backend.callsTo("stop_recording")).toHaveLength(1);
  });

  it("leaves a mic stream's own trouble alone, with nothing being recorded", async () => {
    await open([]);
    await writeFails();
    expect(backend.callsTo("stop_recording")).toHaveLength(0);
  });
});

describe("when the recording falls behind and loses some audio", () => {
  const audioLost = () =>
    act(async () => {
      backend.emit("audio-error", {
        source: "recorder",
        kind: "audio_lost",
        message: "behind",
      });
      await Promise.resolve();
    });

  it("keeps the take going", async () => {
    await open([]);
    await record();
    await audioLost();
    expect(backend.callsTo("stop_recording")).toHaveLength(0);
    expect(visibleText(t("recordings.recording"))).not.toHaveLength(0);
    expect(
      stage().getByRole("button", { name: t("recordings.stopRecording") }),
    ).toBeEnabled();
  });

  it("says audio was lost, and does not blame the disk", async () => {
    await open([]);
    await record();
    await audioLost();
    expect(visibleText(t("error.audio_lost"))).toHaveLength(1);
    expect(visibleText(t("error.write_failed"))).toHaveLength(0);
  });

  it("still lets the take be stopped and kept", async () => {
    await open([]);
    await record();
    await audioLost();
    backend.respond("stop_recording", recording({ name: "rec_kept.wav" }));
    await stopRecording();
    expect(visibleText(t("recordings.recording"))).toHaveLength(0);
    await waitFor(() =>
      expect(
        stage().getByRole("button", { name: /^Play/ }),
      ).toBeInTheDocument(),
    );
  });
});

describe("when stopping fails", () => {
  it("is not left recording: the backend already let go", async () => {
    await open([]);
    await record();
    backend.fail("stop_recording", { kind: "write_failed", message: "full" });
    backend.respond("list_recordings", [recording({ name: "rec_saved.wav" })]);
    await stopRecording();
    expect(visibleText(t("recordings.recording"))).toHaveLength(0);
    expect(
      stage().getByRole("button", { name: t("recordings.record") }),
    ).toBeEnabled();
    expect(stage().getByText(t("error.write_failed"))).toBeInTheDocument();
    await waitFor(() =>
      expect(
        stage().getByRole("button", { name: /^Play/ }),
      ).toBeInTheDocument(),
    );
  });
});

describe("the end of a clip", () => {
  it("only stops the one that ended", async () => {
    await open();
    await clickAndSettle(stage().getByRole("button", { name: /^Play/ }));
    await waitFor(() => expect(backend.listening("playback-ended")).toBe(true));
    act(() => backend.emit("playback-ended", { name: "rec_other.wav" }));
    expect(
      stage().getByRole("button", { name: /^Stop playing/ }),
    ).toBeInTheDocument();
    act(() => backend.emit("playback-ended", { name: "rec_1.wav" }));
    expect(stage().getByRole("button", { name: /^Play/ })).toBeInTheDocument();
  });
});
