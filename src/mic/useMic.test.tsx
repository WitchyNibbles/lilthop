import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { steadyHz } from "../domain/testFrames";
import { translator } from "../i18n";
import { LiveFeed } from "../live/liveFeed";
import { backend } from "../test/fakeBackend";
import { micIssueMessage, useMic } from "./useMic";

const BAND = { minHz: 165, maxHz: 255 };
const t = translator("en");

async function mount() {
  const feed = new LiveFeed();
  const hook = renderHook(() => useMic(feed, BAND));
  await waitFor(() => expect(backend.listening("pitch")).toBe(true));
  await waitFor(() =>
    expect(hook.result.current.devices).toEqual(["Desk mic", "Headset"]),
  );
  return { feed, ...hook };
}

async function turnOn(result: { current: ReturnType<typeof useMic> }) {
  await act(async () => {
    await result.current.start();
  });
}

describe("useMic", () => {
  it("starts off", async () => {
    const { result } = await mount();
    expect(result.current.status).toBe("off");
  });

  it("is on only once the stream really opened", async () => {
    const release = backend.hold("start_pitch", {
      sampleRate: 48_000,
      device: "Desk mic",
      fellBack: false,
    });
    const { result } = await mount();
    let starting: Promise<void> = Promise.resolve();
    act(() => {
      starting = result.current.start();
    });
    expect(result.current.status).toBe("starting");
    await act(async () => {
      release();
      await starting;
    });
    expect(result.current.status).toBe("on");
  });

  it("shows the real reason when the stream cannot open", async () => {
    backend.fail("start_pitch", {
      kind: "stream_failed",
      message: "no device",
    });
    const { result } = await mount();
    await turnOn(result);
    expect(result.current.status).toBe("off");
    const { issue } = result.current;
    expect(issue && micIssueMessage(issue, t)).toBe(t("error.stream_failed"));
  });

  it("keeps the backend's own words out of the message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    backend.fail("start_pitch", { kind: "odd", message: "the cable bit me" });
    const { result } = await mount();
    await turnOn(result);
    const { issue } = result.current;
    expect(issue && micIssueMessage(issue, t)).toBe(t("error.unknown"));
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("the cable bit me"),
    );
    vi.restoreAllMocks();
  });

  it("clears an old error on the next try", async () => {
    backend.fail("start_pitch", { kind: "stream_failed", message: "no" });
    const { result } = await mount();
    await turnOn(result);
    backend.respond("start_pitch", {
      sampleRate: 48_000,
      device: "Desk mic",
      fellBack: false,
    });
    await turnOn(result);
    expect(result.current.issue).toBeNull();
    expect(result.current.status).toBe("on");
  });

  it("opens the chosen device", async () => {
    const { result } = await mount();
    act(() => {
      result.current.chooseDevice("Headset");
    });
    await turnOn(result);
    expect(backend.callsTo("start_pitch")[0]?.args).toEqual({
      deviceName: "Headset",
    });
  });

  it("moves a running stream to the device just chosen", async () => {
    const { result } = await mount();
    await turnOn(result);
    await act(async () => {
      result.current.chooseDevice("Headset");
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.status).toBe("on"));
    expect(backend.callsTo("stop_pitch")).toHaveLength(1);
    expect(backend.lastCallTo("start_pitch")?.args).toEqual({
      deviceName: "Headset",
    });
  });

  it("leaves everything alone when the mic is off", async () => {
    const { result } = await mount();
    act(() => result.current.chooseDevice("Headset"));
    expect(backend.callsTo("start_pitch")).toHaveLength(0);
    expect(result.current.device).toBe("Headset");
  });

  it("keeps the old stream if it cannot be let go", async () => {
    const { result } = await mount();
    await turnOn(result);
    backend.fail("stop_pitch", { kind: "stream_failed", message: "stuck" });
    await act(async () => {
      result.current.chooseDevice("Headset");
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.issue).not.toBeNull());
    expect(result.current.status).toBe("on");
    expect(backend.callsTo("start_pitch")).toHaveLength(1);
  });

  it("does not restart the feed when a save brings back the same band", async () => {
    const feed = new LiveFeed();
    const start = vi.spyOn(feed, "start");
    const { result, rerender } = renderHook(({ band }) => useMic(feed, band), {
      initialProps: { band: BAND },
    });
    await turnOn(result);
    expect(start).toHaveBeenCalledTimes(1);
    rerender({ band: { ...BAND } });
    expect(start).toHaveBeenCalledTimes(1);
    rerender({ band: { ...BAND, maxHz: 260 } });
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("says so when it fell back to the default device", async () => {
    backend.respond("start_pitch", {
      sampleRate: 48_000,
      device: "Desk mic",
      fellBack: true,
    });
    const { result } = await mount();
    await turnOn(result);
    const { issue } = result.current;
    expect(issue && micIssueMessage(issue, t)).toBe(
      t("settings.deviceFellBack"),
    );
    expect(result.current.status).toBe("on");
  });

  it("feeds frames to the live feed while on", async () => {
    const { result, feed } = await mount();
    await turnOn(result);
    act(() => {
      for (const frame of steadyHz(1, 200)) backend.emit("pitch", frame);
    });
    expect(feed.getView().hz).toBe(200);
  });

  it("stops the stream", async () => {
    const { result, feed } = await mount();
    await turnOn(result);
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.status).toBe("off");
    expect(backend.callsTo("stop_pitch")).toHaveLength(1);
    expect(feed.getView().zone).toBe("quiet");
  });

  it("stays on and says why when stopping fails", async () => {
    backend.fail("stop_pitch", { kind: "io", message: "stuck" });
    const { result } = await mount();
    await turnOn(result);
    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.status).toBe("on");
    expect(result.current.issue).not.toBeNull();
  });

  it("goes off and releases the dead stream when the device is lost", async () => {
    const { result } = await mount();
    await turnOn(result);
    await act(async () => {
      backend.emit("audio-error", { kind: "device_lost", message: "gone" });
      await Promise.resolve();
    });
    expect(result.current.status).toBe("off");
    expect(backend.callsTo("stop_pitch")).toHaveLength(1);
    const { issue } = result.current;
    expect(issue && micIssueMessage(issue, t)).toBe(t("error.device_lost"));
  });

  it("turns off when the running stream fails, and lets the backend go", async () => {
    const { result } = await mount();
    await turnOn(result);
    act(() => {
      backend.emit("audio-error", { kind: "stream_failed", message: "xrun" });
    });
    expect(result.current.status).toBe("off");
    expect(backend.callsTo("stop_pitch")).toHaveLength(1);
    const { issue } = result.current;
    expect(issue && micIssueMessage(issue, t)).toBe(t("error.stream_failed"));
  });

  it("keeps listening through a recording write error", async () => {
    const { result } = await mount();
    await turnOn(result);
    act(() => {
      backend.emit("audio-error", { kind: "write_failed", message: "full" });
    });
    expect(result.current.status).toBe("on");
    const { issue } = result.current;
    expect(issue && micIssueMessage(issue, t)).toBe(t("error.write_failed"));
    expect(backend.callsTo("stop_pitch")).toHaveLength(0);
  });

  it("keeps listening when a recording loses some audio", async () => {
    const { result } = await mount();
    await turnOn(result);
    act(() => {
      backend.emit("audio-error", { kind: "audio_lost", message: "behind" });
    });
    expect(result.current.status).toBe("on");
    const { issue } = result.current;
    expect(issue && micIssueMessage(issue, t)).toBe(t("error.audio_lost"));
    expect(backend.callsTo("stop_pitch")).toHaveLength(0);
  });

  it("can dismiss a message", async () => {
    backend.fail("start_pitch", { kind: "stream_failed", message: "no" });
    const { result } = await mount();
    await turnOn(result);
    act(() => {
      result.current.dismissIssue();
    });
    expect(result.current.issue).toBeNull();
  });

  it("reports a device list it cannot read", async () => {
    backend.fail("list_input_devices", { kind: "io", message: "denied" });
    const feed = new LiveFeed();
    const { result } = renderHook(() => useMic(feed, BAND));
    await waitFor(() => expect(result.current.issue).not.toBeNull());
  });

  it("leaves the events when it unmounts", async () => {
    const { unmount } = await mount();
    unmount();
    await waitFor(() => expect(backend.listening("pitch")).toBe(false));
    expect(backend.listening("audio-error")).toBe(false);
  });
});
