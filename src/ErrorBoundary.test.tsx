import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";
import { translator } from "./i18n";

const t = translator("en");

let exploding = true;

function Boom() {
  if (exploding) throw new Error("boom");
  return <span>recovered</span>;
}

beforeEach(() => {
  exploding = true;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  document.documentElement.lang = "";
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("renders its children when nothing is wrong", () => {
    render(
      <ErrorBoundary>
        <span>ok</span>
      </ErrorBoundary>,
    );
    expect(screen.getByText("ok")).toBeInTheDocument();
  });

  it("shows what went wrong", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText(t("error.title"))).toBeInTheDocument();
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });

  it("keeps the raw text for bug reports, folded under a translated summary", () => {
    document.documentElement.lang = "es";
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    const summary = screen.getByText(translator("es")("error.details"));
    expect(summary.tagName).toBe("SUMMARY");
    const details = summary.closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("boom");
  });

  it("tries again", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    exploding = false;
    fireEvent.click(screen.getByRole("button", { name: t("error.retry") }));
    expect(screen.getByText("recovered")).toBeInTheDocument();
  });

  it("speaks the app's language", () => {
    document.documentElement.lang = "es";
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(
      screen.getByText(translator("es")("error.title")),
    ).toBeInTheDocument();
  });
});
