import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translator } from "../i18n";
import { boot, stage } from "../test/driveApp";
import { backend, PROFILE } from "../test/fakeBackend";
import { setup, t, tryAgain } from "./loadFailedTestKit";

const DATABASE = { kind: "database", message: "file is not a database" };

afterEach(() => {
  vi.restoreAllMocks();
});

const alertsOutsideStage = () => {
  const main = screen.getByRole("main");
  return screen
    .queryAllByRole("alert")
    .filter((alert) => !main.contains(alert));
};

describe("when the saved data will not open", () => {
  it("says the saved data could not be read, and that nothing was changed", async () => {
    backend.fail("get_profile", DATABASE);
    await boot();
    expect(
      stage().getByRole("heading", { name: t("load.title") }),
    ).toBeInTheDocument();
    const alert = stage().getByRole("alert");
    expect(alert).toHaveTextContent(t("error.database"));
    expect(alert).toHaveTextContent(t("load.body"));
    expect(setup()).toBeNull();
    expect(
      stage().queryByRole("button", { name: t("load.startFresh") }),
    ).toBeNull();
  });

  it("says a file could not be read or written when the data folder can't be used", async () => {
    backend.fail("get_profile", { kind: "io", message: "permission denied" });
    await boot();
    expect(
      stage().getByRole("heading", { name: t("load.title") }),
    ).toBeInTheDocument();
    const alert = stage().getByRole("alert");
    expect(alert).toHaveTextContent(t("error.io"));
    expect(alert).toHaveTextContent(t("load.body"));
    expect(setup()).toBeNull();
    expect(
      stage().queryByRole("button", { name: t("load.startFresh") }),
    ).toBeNull();
  });

  it("says it in Spanish too", async () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("es-MX");
    backend.fail("get_profile", DATABASE);
    await boot();
    expect(stage().getByRole("alert")).toHaveTextContent(
      translator("es")("error.database"),
    );
  });

  it("keeps to the plain words for a failure it has no better words for", async () => {
    backend.fail("get_profile", { kind: "not_found", message: "no profile" });
    await boot();
    expect(stage().getByRole("alert").textContent).toBe(t("load.body"));
  });
});

describe("the alert row while that screen is up", () => {
  it.each(["database", "newer_data", "migration_failed"])(
    "does not repeat what the screen says (%s)",
    async (kind) => {
      const failure = { kind, message: "cannot read" };
      backend.fail("get_profile", failure);
      backend.fail("get_results", failure);
      await boot();
      await waitFor(() =>
        expect(stage().getByRole("alert")).toBeInTheDocument(),
      );
      const alerts = screen.getAllByRole("alert");
      expect(alerts).toHaveLength(1);
      expect(screen.getByRole("main")).toContainElement(alerts[0] ?? null);
    },
  );

  it("still shows a different problem", async () => {
    backend.fail("get_profile", {
      kind: "newer_data",
      message: "this data was saved by a newer version of the app",
    });
    backend.fail("get_results", { kind: "io", message: "disk" });
    await boot();
    await waitFor(() => expect(alertsOutsideStage()).toHaveLength(1));
    expect(alertsOutsideStage()[0]).toHaveTextContent(t("error.io"));
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  it("speaks again once the profile reads and the results still do not", async () => {
    backend.fail("get_profile", DATABASE);
    backend.fail("get_results", DATABASE);
    await boot();
    backend.respond("get_profile", PROFILE);
    await tryAgain();
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: t("load.title") }),
      ).toBeNull(),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(t("error.database")),
    );
  });
});
