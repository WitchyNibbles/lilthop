import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { steadyHz } from "../domain/testFrames";
import { boot, play, startMic } from "../test/driveApp";

afterEach(() => {
  window.localStorage.removeItem("lilthop-timing");
  vi.restoreAllMocks();
});

describe("timing probe in the app", () => {
  it("prints a line about the frames it got when the flag is set", async () => {
    window.localStorage.setItem("lilthop-timing", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await boot();
    await startMic();
    play(steadyHz(0.5, 200));
    await waitFor(
      () =>
        expect(info).toHaveBeenCalledWith(
          expect.stringMatching(/^pitch timing: 2\d frames, behind /),
        ),
      { timeout: 3_000 },
    );
  });

  it("says nothing by default", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await boot();
    await startMic();
    play(steadyHz(0.5, 200));
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(info).not.toHaveBeenCalled();
  });
});
