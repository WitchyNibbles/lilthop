import { beforeEach, describe, expect, it, vi } from "vitest";

// Nothing here reaches a real Tauri runtime: both modules are replaced before the code loads.
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen:
    vi.fn<
      (
        name: string,
        handler: (event: { payload: unknown }) => void,
      ) => Promise<() => void>
    >(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

import type { PitchFrame, Profile } from "../domain/contract";
import { translator } from "../i18n";
import {
  AppCommandError,
  audioErrorMessage,
  backupCreate,
  backupRestore,
  commandErrorMessage,
  deleteAllData,
  startFresh,
  canMoveEarlierData,
  moveEarlierData,
  deleteRecording,
  exportData,
  getProfile,
  getResults,
  listInputDevices,
  listRecordings,
  onAudioError,
  onPitch,
  onPlaybackEnded,
  playRecording,
  saveResult,
  setProfile,
  setRecordingMeta,
  startPitch,
  startRecording,
  stopPitch,
  stopPlayback,
  stopRecording,
} from "./tauri";

const PROFILE: Profile = {
  baselineHz: 130,
  baselineCentroid: 2000,
  baselineRms: 0.05,
  targetMinHz: 165,
  targetMaxHz: 255,
  goals: ["pitch"],
  language: "en",
  theme: "dark",
  onboarded: true,
  pitchEngine: 2,
};

beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.listen.mockReset();
  mocks.invoke.mockResolvedValue(undefined);
});

describe("commands use the contract's names and camelCase arguments", () => {
  it.each([
    ["list_input_devices", () => listInputDevices(), undefined],
    ["start_pitch", () => startPitch("Mic A"), { deviceName: "Mic A" }],
    ["start_pitch", () => startPitch(null), { deviceName: null }],
    ["stop_pitch", () => stopPitch(), undefined],
    ["start_recording", () => startRecording(null), { deviceName: null }],
    ["stop_recording", () => stopRecording(), undefined],
    ["play_recording", () => playRecording("a.wav"), { name: "a.wav" }],
    ["stop_playback", () => stopPlayback(), undefined],
    ["list_recordings", () => listRecordings(), undefined],
    ["delete_recording", () => deleteRecording("a.wav"), { name: "a.wav" }],
    [
      "set_recording_meta",
      () => setRecordingMeta("a.wav", "my take", "keep"),
      { name: "a.wav", note: "my take", tags: "keep" },
    ],
    ["get_profile", () => getProfile(), undefined],
    ["set_profile", () => setProfile(PROFILE), { profile: PROFILE }],
    ["get_results", () => getResults(), undefined],
    ["export_data", () => exportData("csv"), { format: "csv" }],
    ["backup_create", () => backupCreate(), undefined],
    ["backup_restore", () => backupRestore(), undefined],
    ["delete_all_data", () => deleteAllData(), undefined],
    ["start_fresh", () => startFresh(), undefined],
    ["can_move_earlier_data", () => canMoveEarlierData(), undefined],
    ["move_earlier_data", () => moveEarlierData(), undefined],
  ] as const)("%s", async (command, call, args) => {
    await call();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith(command, args);
  });

  it("save_result sends the result under `result` and returns the id", async () => {
    mocks.invoke.mockResolvedValue(42);
    const result = {
      exerciseId: "glides",
      score: 80,
      pitchMean: 180,
      pitchSd: 12,
      durationS: 60,
      voicedS: 40,
      scoringVersion: 2,
    };
    await expect(saveResult(result)).resolves.toBe(42);
    expect(mocks.invoke).toHaveBeenCalledWith("save_result", { result });
  });

  it("returns what the backend returned", async () => {
    mocks.invoke.mockResolvedValue(PROFILE);
    await expect(getProfile()).resolves.toEqual(PROFILE);
    mocks.invoke.mockResolvedValue(null);
    await expect(backupCreate()).resolves.toBeNull();
  });
});

describe("errors", () => {
  it("turns the backend's { kind, message } into an AppCommandError", async () => {
    mocks.invoke.mockRejectedValue({
      kind: "invalid_backup",
      message: "bad zip",
    });
    const error = await getResults().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppCommandError);
    expect(error).toMatchObject({
      kind: "invalid_backup",
      message: "bad zip",
      command: "get_results",
    });
  });

  it("keeps a plain string rejection as an unknown error instead of losing it", async () => {
    mocks.invoke.mockRejectedValue("window closed");
    const error = await stopPitch().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "unknown", message: "window closed" });
  });

  it("keeps an Error's message", async () => {
    mocks.invoke.mockRejectedValue(new Error("boom"));
    const error = await stopPitch().catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "unknown", message: "boom" });
  });

  it("describes a known kind in the reader's language, and falls back for an unknown one", () => {
    const es = translator("es");
    expect(
      commandErrorMessage(
        new AppCommandError("invalid_backup", "x", "backup_restore"),
        es,
      ),
    ).toBe("No se pudo usar esa copia de seguridad. No se cambió nada.");
    expect(
      commandErrorMessage(
        new AppCommandError("weird", "disk on fire", "x"),
        translator("en"),
      ),
    ).toBe(translator("en")("error.unknown"));
    expect(commandErrorMessage("not an error", translator("en"))).toBe(
      translator("en")("error.unknown"),
    );
  });

  it("has a message for every error kind the Rust side sends", () => {
    const en = translator("en");
    const fallback = commandErrorMessage(
      new AppCommandError("zzz", "m", "x"),
      en,
    );
    for (const kind of [
      "invalid_input",
      "not_found",
      "invalid_backup",
      "database",
      "io",
      "migration_failed",
    ]) {
      const text = commandErrorMessage(new AppCommandError(kind, "m", "x"), en);
      expect(text, kind).not.toBe(fallback);
      expect(
        commandErrorMessage(
          new AppCommandError(kind, "m", "x"),
          translator("es"),
        ),
        kind,
      ).not.toBe(
        commandErrorMessage(
          new AppCommandError("zzz", "m", "x"),
          translator("es"),
        ),
      );
    }
  });

  it("describes each audio error kind", () => {
    const en = translator("en");
    expect(
      audioErrorMessage(
        { source: "recorder", kind: "device_lost", message: "" },
        en,
      ),
    ).toContain("disconnected");
    expect(
      audioErrorMessage(
        { source: "recorder", kind: "write_failed", message: "" },
        en,
      ),
    ).toContain("disk");
    expect(
      audioErrorMessage(
        { source: "recorder", kind: "stream_failed", message: "" },
        en,
      ),
    ).toContain("could not start");
    expect(
      audioErrorMessage(
        { source: "recorder", kind: "audio_lost", message: "" },
        en,
      ),
    ).toContain("audio was lost");
  });
});

describe("events", () => {
  function capture(event: string): (payload: unknown) => void {
    const call = mocks.listen.mock.calls.find((c) => c[0] === event);
    if (!call) throw new Error(`no listener for ${event}`);
    return (payload) => call[1]({ payload });
  }

  it("onPitch listens to `pitch` and hands over the frame", async () => {
    const stop = vi.fn();
    mocks.listen.mockResolvedValue(stop);
    const seen: PitchFrame[] = [];
    const unlisten = await onPitch((frame) => seen.push(frame));
    const frame = { tMs: 21, f0: 200, rms: 0.05, peak: 0.2, centroid: 1800 };
    capture("pitch")(frame);
    expect(seen).toEqual([frame]);
    expect(unlisten).toBe(stop);
  });

  it("onAudioError listens to `audio-error`", async () => {
    mocks.listen.mockResolvedValue(vi.fn());
    const handler = vi.fn();
    await onAudioError(handler);
    capture("audio-error")({ kind: "device_lost", message: "gone" });
    expect(handler).toHaveBeenCalledWith({
      kind: "device_lost",
      message: "gone",
    });
  });

  it("onPlaybackEnded listens to `playback-ended`", async () => {
    mocks.listen.mockResolvedValue(vi.fn());
    const handler = vi.fn();
    await onPlaybackEnded(handler);
    capture("playback-ended")({ name: "a.wav" });
    expect(handler).toHaveBeenCalledWith({ name: "a.wav" });
  });
});
