import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { steadyHz } from "../domain/testFrames";
import { canvasContext, setReducedMotion } from "../test/fakeBrowser";
import { LiveFeed } from "./liveFeed";
import { PitchTrace } from "./PitchTrace";

const BAND = { minHz: 165, maxHz: 255 };

let frameCallbacks: FrameRequestCallback[] = [];

function nextFrame(now: number): void {
  const due = frameCallbacks;
  frameCallbacks = [];
  for (const callback of due) callback(now);
}

function trace(feed: LiveFeed, summary = "in your range", frozen = false) {
  return render(
    <PitchTrace
      band={BAND}
      buffer={feed.trace}
      frozen={frozen}
      label="Pitch trace"
      series="pitch"
      summary={summary}
      theme="dark"
    />,
  );
}

function runningFeed(): LiveFeed {
  const feed = new LiveFeed();
  feed.start(BAND);
  return feed;
}

beforeEach(() => {
  frameCallbacks = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frameCallbacks = [];
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("PitchTrace", () => {
  it("is an image with a label", () => {
    trace(runningFeed());
    expect(screen.getByRole("img", { name: "Pitch trace" }).tagName).toBe(
      "CANVAS",
    );
  });

  it("holds the drawing still while frozen, however much voice arrives", () => {
    const feed = runningFeed();
    for (const frame of steadyHz(0.2, 200)) feed.push(frame);
    trace(feed, "in your range", true);
    nextFrame(16);
    expect(canvasContext.times("clearRect")).toBeGreaterThan(0);
    canvasContext.reset();
    for (const frame of steadyHz(0.2, 210, 300)) feed.push(frame);
    nextFrame(32);
    expect(canvasContext.times("clearRect")).toBe(0);
  });

  it("paints on the animation frame after new data, not per frame", () => {
    const feed = runningFeed();
    trace(feed);
    nextFrame(16);
    canvasContext.reset();
    for (const frame of steadyHz(0.2, 200)) feed.push(frame);
    expect(canvasContext.times("clearRect")).toBe(0);
    nextFrame(32);
    expect(canvasContext.times("clearRect")).toBe(1);
  });

  it("does not paint again when nothing changed", () => {
    const feed = runningFeed();
    trace(feed);
    nextFrame(16);
    canvasContext.reset();
    nextFrame(32);
    nextFrame(48);
    expect(canvasContext.times("clearRect")).toBe(0);
  });

  it("does not render React for frames", () => {
    const feed = runningFeed();
    const { container } = trace(feed);
    const before = container.innerHTML;
    for (const frame of steadyHz(2, 200)) feed.push(frame);
    nextFrame(16);
    expect(container.innerHTML).toBe(before);
  });

  it("paints less often under reduced motion", () => {
    setReducedMotion(true);
    const feed = runningFeed();
    trace(feed);
    nextFrame(0);
    canvasContext.reset();
    let start = 0;
    for (let now = 16; now < 1000; now += 16) {
      for (const frame of steadyHz(0.016, 200, start)) feed.push(frame);
      feed.trace.push(start, 200, -20);
      start += 16;
      nextFrame(now);
    }
    expect(canvasContext.times("clearRect")).toBeLessThanOrEqual(5);
    expect(canvasContext.times("clearRect")).toBeGreaterThan(1);
  });

  it("scales the canvas by the device pixel ratio", () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "clientWidth", "get")
      .mockReturnValue(400);
    const spyHeight = vi
      .spyOn(HTMLCanvasElement.prototype, "clientHeight", "get")
      .mockReturnValue(200);
    trace(runningFeed());
    const canvas = screen.getByRole("img", { name: "Pitch trace" });
    expect(canvas).toHaveAttribute("width", "800");
    expect(canvas).toHaveAttribute("height", "400");
    expect(canvasContext.transforms.slice(-1)[0]).toEqual([2, 0, 0, 2, 0, 0]);
    spy.mockRestore();
    spyHeight.mockRestore();
  });

  it("follows a change of pixel ratio", () => {
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "clientWidth", "get")
      .mockReturnValue(400);
    vi.stubGlobal("devicePixelRatio", 1);
    trace(runningFeed());
    vi.stubGlobal("devicePixelRatio", 3);
    nextFrame(16);
    expect(screen.getByRole("img", { name: "Pitch trace" })).toHaveAttribute(
      "width",
      "1200",
    );
    spy.mockRestore();
  });

  it("stops its loop when it goes away", () => {
    const { unmount } = trace(runningFeed());
    unmount();
    expect(frameCallbacks).toHaveLength(0);
  });

  it("keeps the summary polite and the words the caller gave", () => {
    trace(runningFeed());
    const summary = screen.getByText("in your range");
    expect(summary).toHaveAttribute("aria-live", "polite");
  });

  it("updates the summary at most once every 2 s", () => {
    vi.useFakeTimers();
    const feed = runningFeed();
    const view = (summary: string) => (
      <PitchTrace
        band={BAND}
        buffer={feed.trace}
        label="Pitch trace"
        series="pitch"
        summary={summary}
        theme="dark"
      />
    );
    const { rerender } = render(view("one"));
    rerender(view("two"));
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(screen.getByText("two")).toBeInTheDocument();
    rerender(view("three"));
    rerender(view("four"));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("two")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(screen.getByText("four")).toBeInTheDocument();
  });
});
