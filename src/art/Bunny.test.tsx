import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Bunny } from "./Bunny";

describe("Bunny", () => {
  it("is decorative: the name next to it carries the meaning", () => {
    const { container } = render(<Bunny perked={false} />);
    expect(container.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("perks its ears when told", () => {
    render(<Bunny perked />);
    expect(screen.getByTestId("bunny")).toHaveAttribute("data-perked", "true");
  });

  it("rests otherwise", () => {
    render(<Bunny perked={false} />);
    expect(screen.getByTestId("bunny")).toHaveAttribute("data-perked", "false");
  });
});
