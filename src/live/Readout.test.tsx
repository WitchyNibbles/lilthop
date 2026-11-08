import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatReadout, Readout } from "./Readout";

describe("formatReadout", () => {
  it("is always four characters wide", () => {
    for (const value of [null, 7, 85, 185, 1000, -20]) {
      expect(formatReadout(value)).toHaveLength(4);
    }
  });

  it("starts at the left edge, so the digits line up with the label", () => {
    expect(formatReadout(185)).toBe("185 ");
  });

  it("ends at the right edge when compact, beside its unit", () => {
    expect(formatReadout(185, "end")).toBe(" 185");
  });

  it("rounds to whole numbers", () => {
    expect(formatReadout(184.6).trim()).toBe("185");
  });

  it("has a placeholder before the first reading", () => {
    expect(formatReadout(null).trim()).toBe("---");
  });
});

describe("Readout", () => {
  const readout = (dimmed: boolean) =>
    render(<Readout dimmed={dimmed} label="Pitch" unit="Hz" value={185} />);

  it("shows the label, value and unit", () => {
    readout(false);
    expect(screen.getByText("Pitch")).toBeInTheDocument();
    expect(screen.getByText("Hz")).toBeInTheDocument();
    expect(screen.getByTestId("readout-value")).toHaveTextContent("185");
  });

  it("keeps the value when dimmed and only changes its look", () => {
    readout(true);
    expect(screen.getByTestId("readout-value")).toHaveTextContent("185");
    expect(screen.getByTestId("readout-value")).toHaveAttribute(
      "data-dimmed",
      "true",
    );
  });

  it("carries the zone, so the number can change tone with it", () => {
    render(
      <Readout
        dimmed={false}
        label="Pitch"
        unit="Hz"
        value={300}
        zone="above"
      />,
    );
    expect(screen.getByTestId("readout-value")).toHaveAttribute(
      "data-zone",
      "above",
    );
  });

  it("is not a live region: the number is never announced", () => {
    const { container } = readout(false);
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(container.querySelector("output")).toBeNull();
  });
});
