import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { backend } from "./test/fakeBackend";

describe("main", () => {
  it("renders the app into the root", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () => {
      await import("./main");
    });
    await waitFor(() => expect(backend.listening("pitch")).toBe(true));
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
