import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n";
import { boot, goTo, stage } from "../test/driveApp";

const t = translator("en");

describe("keyboard and landmarks", () => {
  it("moves focus to the new screen's heading after navigation", async () => {
    await boot();
    goTo("Settings");
    expect(stage().getByRole("heading", { level: 1 })).toHaveFocus();
    goTo("Progress");
    expect(stage().getByRole("heading", { level: 1 })).toHaveFocus();
  });

  it("does not steal focus on first load", async () => {
    await boot();
    expect(stage().getByRole("heading", { level: 1 })).not.toHaveFocus();
  });

  it("offers a way past the rail", async () => {
    await boot();
    fireEvent.click(screen.getByRole("button", { name: t("nav.skip") }));
    expect(stage().getByRole("heading", { level: 1 })).toHaveFocus();
  });

  it("has the three landmarks on every screen", async () => {
    await boot();
    for (const name of [
      "Home",
      "Practice",
      "Progress",
      "Recordings",
      "Settings",
    ]) {
      goTo(name);
      expect(screen.getByRole("main")).toBeInTheDocument();
      expect(screen.getByRole("complementary")).toBeInTheDocument();
      expect(screen.getByRole("navigation")).toBeInTheDocument();
    }
  });
});
