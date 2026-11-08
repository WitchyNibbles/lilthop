import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";
import { backend } from "./fakeBackend";
import {
  canvasContext,
  installAudio,
  installCanvas,
  installMatchMedia,
  installDialog,
  installResizeObserver,
  setReducedMotion,
} from "./fakeBrowser";

vi.mock("@tauri-apps/api/core", async () => {
  const fake = await import("./fakeBackend");
  return { invoke: fake.backend.invoke };
});
vi.mock("@tauri-apps/api/event", async () => {
  const fake = await import("./fakeBackend");
  return { listen: fake.backend.listen };
});

beforeEach(() => {
  backend.reset();
  canvasContext.reset();
  installCanvas();
  installMatchMedia();
  installResizeObserver();
  installDialog();
  installAudio();
  setReducedMotion(false);
});
