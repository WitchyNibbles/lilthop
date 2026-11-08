import { act, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { goTo, stage, startMic } from "../test/driveApp";
import { backend, recording } from "../test/fakeBackend";
import { open, record, t, visibleText } from "./recordingsTestKit";

type Source = "pitch" | "recorder";
type Kind = "device_lost" | "stream_failed";

const report = (source: Source, kind: Kind) =>
  act(async () => {
    backend.emit("audio-error", { source, kind, message: "gone" });
    await Promise.resolve();
  });

const takeOver = () =>
  waitFor(() => expect(visibleText(t("recordings.recording"))).toHaveLength(0));

describe.each<Kind>(["device_lost", "stream_failed"])(
  "when the recorder's own stream reports %s",
  (kind) => {
    it("ends the take and keeps what was written", async () => {
      await open([]);
      await record();
      backend.respond("stop_recording", recording({ name: "rec_kept.wav" }));
      await report("recorder", kind);
      await takeOver();
      expect(backend.callsTo("stop_recording")).toHaveLength(1);
      expect(
        stage().getByRole("button", { name: t("recordings.record") }),
      ).toBeEnabled();
      await waitFor(() =>
        expect(
          stage().getByRole("button", { name: /^Play/ }),
        ).toBeInTheDocument(),
      );
    });

    it("says why", async () => {
      await open([]);
      await record();
      await report("recorder", kind);
      await takeOver();
      expect(visibleText(t(`error.${kind}`))).toHaveLength(1);
    });
  },
);

describe.each<Kind>(["device_lost", "stream_failed"])(
  "when the pitch stream reports %s during a take",
  (kind) => {
    it("leaves the take to the recorder's own fate", async () => {
      await open([]);
      await record();
      await report("pitch", kind);
      expect(backend.callsTo("stop_recording")).toHaveLength(0);
      expect(visibleText(t("recordings.recording"))).not.toHaveLength(0);
    });
  },
);

describe("an unplugged mic, both streams reporting", () => {
  it("ends the take on the recorder's report, whichever comes first", async () => {
    await open([]);
    await record();
    await report("pitch", "device_lost");
    expect(backend.callsTo("stop_recording")).toHaveLength(0);
    await report("recorder", "device_lost");
    await takeOver();
    expect(backend.callsTo("stop_recording")).toHaveLength(1);
  });

  it("stops only once if the recorder reports first", async () => {
    await open([]);
    await record();
    await report("recorder", "device_lost");
    await report("pitch", "device_lost");
    await takeOver();
    expect(backend.callsTo("stop_recording")).toHaveLength(1);
  });

  it("can be followed by a new take", async () => {
    await open([]);
    await record();
    await report("recorder", "device_lost");
    await takeOver();
    await record();
    expect(backend.callsTo("start_recording")).toHaveLength(2);
    expect(visibleText(t("recordings.recording"))).not.toHaveLength(0);
  });

  it("doesn't leave live pitch beside a dead take once the mic is back on", async () => {
    await open([]);
    await record();
    await report("pitch", "device_lost");
    await report("recorder", "device_lost");
    await takeOver();
    goTo("Practice");
    await startMic();
    expect(visibleText(t("recordings.recording"))).toHaveLength(0);
  });
});

describe("a stream that dies while the take is still starting", () => {
  async function dieDuringStart() {
    await open([]);
    const release = backend.hold("start_recording", { name: "rec_new.wav" });
    await record();
    await report("recorder", "device_lost");
    return release;
  }

  const finishStart = (release: () => void) =>
    act(async () => {
      release();
      await Promise.resolve();
    });

  it("closes the take as soon as the start comes back", async () => {
    const release = await dieDuringStart();
    expect(backend.callsTo("stop_recording")).toHaveLength(0);
    await finishStart(release);
    await waitFor(() =>
      expect(backend.callsTo("stop_recording")).toHaveLength(1),
    );
    await takeOver();
  });

  it("catches a report that lands before the screen has caught up", async () => {
    await open([]);
    const release = backend.hold("start_recording", { name: "rec_new.wav" });
    await record();
    await act(async () => {
      release();
      for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
      backend.emit("audio-error", {
        source: "recorder",
        kind: "device_lost",
        message: "gone",
      });
    });
    await waitFor(() =>
      expect(backend.callsTo("stop_recording")).toHaveLength(1),
    );
    await takeOver();
  });

  it("doesn't hold the next take against it", async () => {
    const release = await dieDuringStart();
    await finishStart(release);
    await takeOver();
    await waitFor(() =>
      expect(
        stage().getByRole("button", { name: t("recordings.record") }),
      ).toBeEnabled(),
    );
    backend.respond("start_recording", { name: "rec_next.wav" });
    await record();
    expect(backend.callsTo("stop_recording")).toHaveLength(1);
    expect(visibleText(t("recordings.recording"))).not.toHaveLength(0);
  });

  it("asks for no stop if the start failed anyway, then or on the next take", async () => {
    await open([]);
    let refuse: (error: unknown) => void = () => undefined;
    const refused = new Promise((_, reject) => {
      refuse = reject;
    });
    backend.handle("start_recording", () => refused);
    await record();
    await report("recorder", "device_lost");
    await act(async () => {
      refuse({ kind: "device_lost", message: "gone" });
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(
        stage().getByRole("button", { name: t("recordings.record") }),
      ).toBeEnabled(),
    );
    backend.respond("start_recording", { name: "rec_next.wav" });
    await record();
    expect(backend.callsTo("stop_recording")).toHaveLength(0);
    expect(visibleText(t("recordings.recording"))).not.toHaveLength(0);
  });
});
