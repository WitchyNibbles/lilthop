import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { steadyHz } from "./domain/testFrames";
import { translator } from "./i18n";
import { backend, PROFILE, savedResult } from "./test/fakeBackend";
import {
  boot,
  clickAndSettle,
  goTo,
  play,
  rail,
  stage,
  startMic,
} from "./test/driveApp";

const t = translator("en");
const SCREENS = ["Home", "Practice", "Progress", "Recordings", "Settings"];

describe("mic button", () => {
  it("shows a real error when start_pitch rejects", async () => {
    backend.fail("start_pitch", { kind: "stream_failed", message: "denied" });
    await boot();
    await startMic();
    expect(screen.getByRole("alert")).toHaveTextContent(
      t("error.stream_failed"),
    );
    expect(rail().getByText(t("reading.micOff"))).toBeInTheDocument();
    expect(rail().queryByText(t("reading.listening"))).toBeNull();
  });

  it("can dismiss the error", async () => {
    backend.fail("start_pitch", { kind: "stream_failed", message: "denied" });
    await boot();
    await startMic();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it('says "Listening" only while the stream is on', async () => {
    const release = backend.hold("start_pitch", {
      sampleRate: 48_000,
      device: "Desk mic",
      fellBack: false,
    });
    await boot();
    expect(rail().queryByText(t("reading.listening"))).toBeNull();
    fireEvent.click(rail().getByRole("button", { name: "Start mic" }));
    expect(rail().getByText(t("mic.starting"))).toBeInTheDocument();
    expect(rail().queryByText(t("reading.listening"))).toBeNull();
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(rail().getByText(t("reading.listening"))).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(rail().getByRole("button", { name: "Stop mic" }));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(rail().queryByText(t("reading.listening"))).toBeNull(),
    );
  });

  it("shows no pitch number beside the mic-off line", async () => {
    await boot();
    await startMic();
    play(steadyHz(1, 216));
    expect(rail().getByTestId("readout-value")).toHaveTextContent("216");
    await clickAndSettle(rail().getByRole("button", { name: "Stop mic" }));
    expect(rail().getByText(t("reading.micOff"))).toBeInTheDocument();
    expect(rail().getByTestId("readout-value")).toHaveTextContent("---");
  });

  it("shows an audio-error event wherever you are and turns the mic off", async () => {
    await boot();
    await startMic();
    goTo("Progress");
    act(() => {
      backend.emit("audio-error", { kind: "device_lost", message: "gone" });
    });
    expect(screen.getByRole("alert")).toHaveTextContent(t("error.device_lost"));
    expect(rail().getByText(t("reading.micOff"))).toBeInTheDocument();
  });

  it("is there on every screen, with the bunny, the nav and the routine", async () => {
    await boot();
    for (const name of SCREENS) {
      goTo(name);
      expect(
        screen.getByRole("button", { name: "Start mic" }),
      ).toBeInTheDocument();
      expect(rail().getByText(t("app.title"))).toBeInTheDocument();
      for (const item of SCREENS) {
        expect(rail().getByRole("button", { name: item })).toBeInTheDocument();
      }
    }
  });
});

describe("rail", () => {
  it("marks the current screen", async () => {
    await boot();
    goTo("Progress");
    expect(rail().getByRole("button", { name: "Progress" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(rail().getByRole("button", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("lists the routine and opens an item in Practice", async () => {
    await boot();
    fireEvent.click(rail().getByRole("button", { name: /Pitch awareness/ }));
    expect(
      stage().getByRole("heading", { name: "Pitch awareness" }),
    ).toBeInTheDocument();
  });

  it("ticks what is done today", async () => {
    backend.respond("get_results", [
      savedResult({
        exerciseId: "pitch_awareness",
        createdAt: Math.floor(Date.now() / 1000),
      }),
    ]);
    await boot();
    expect(
      rail().getByRole("button", { name: /Pitch awareness.*Done/ }),
    ).toBeInTheDocument();
  });
});

describe("language", () => {
  it("switching changes the text everywhere and is remembered", async () => {
    await boot();
    goTo("Settings");
    fireEvent.change(stage().getByLabelText(t("settings.language")), {
      target: { value: "es" },
    });
    await waitFor(() =>
      expect(
        rail().getByRole("button", { name: "Inicio" }),
      ).toBeInTheDocument(),
    );
    expect(document.documentElement.lang).toBe("es");
    expect(backend.lastCallTo("set_profile")?.args).toEqual({
      profile: { ...PROFILE, language: "es" },
    });
  });

  it("an error already on screen follows the language", async () => {
    backend.fail("start_pitch", { kind: "stream_failed", message: "denied" });
    await boot();
    await startMic();
    goTo("Settings");
    fireEvent.change(stage().getByLabelText(t("settings.language")), {
      target: { value: "es" },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        translator("es")("error.stream_failed"),
      ),
    );
  });

  it("starts in the profile's language", async () => {
    backend.respond("get_profile", { ...PROFILE, language: "es" });
    await boot();
    await waitFor(() =>
      expect(
        rail().getByRole("button", { name: "Inicio" }),
      ).toBeInTheDocument(),
    );
  });
});

describe("theme", () => {
  it("is dark by default and follows the setting", async () => {
    await boot();
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    goTo("Settings");
    fireEvent.change(stage().getByLabelText(t("settings.theme")), {
      target: { value: "light" },
    });
    await waitFor(() =>
      expect(document.documentElement.dataset["theme"]).toBe("light"),
    );
  });

  it("keeps working when the choice cannot be saved, and says so", async () => {
    backend.fail("set_profile", { kind: "database", message: "locked" });
    await boot();
    goTo("Settings");
    fireEvent.change(stage().getByLabelText(t("settings.theme")), {
      target: { value: "light" },
    });
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(t("error.database")),
    );
    expect(document.documentElement.dataset["theme"]).toBe("light");
  });
});

describe("settings", () => {
  it("opens the device chosen there", async () => {
    await boot();
    goTo("Settings");
    fireEvent.change(stage().getByLabelText(t("settings.inputDevice")), {
      target: { value: "Headset" },
    });
    await startMic();
    expect(backend.callsTo("start_pitch")[0]?.args).toEqual({
      deviceName: "Headset",
    });
  });

  it("can go back to the default device", async () => {
    await boot();
    goTo("Settings");
    const select = stage().getByLabelText(t("settings.inputDevice"));
    fireEvent.change(select, { target: { value: "Headset" } });
    fireEvent.change(select, { target: { value: "" } });
    await startMic();
    expect(backend.callsTo("start_pitch")[0]?.args).toEqual({
      deviceName: null,
    });
  });
});

describe("loading", () => {
  it("says so when the saved data cannot be read", async () => {
    backend.fail("get_results", { kind: "database", message: "corrupt" });
    await boot();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(t("error.database")),
    );
  });

  it("offers the introduction to someone with no profile", async () => {
    backend.respond("get_profile", null);
    await boot();
    expect(
      stage().getByRole("heading", { name: t("onboarding.welcome") }),
    ).toBeInTheDocument();
  });

  it("offers it to someone who never finished it", async () => {
    backend.respond("get_profile", { ...PROFILE, onboarded: false });
    await boot();
    expect(
      stage().getByRole("heading", { name: t("onboarding.welcome") }),
    ).toBeInTheDocument();
  });

  it("the placeholders still run", async () => {
    await boot();
    for (const name of ["Progress", "Recordings"]) {
      goTo(name);
      expect(stage().getByRole("heading", { name })).toBeInTheDocument();
    }
  });
});
