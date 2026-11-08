import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n";
import { boot, clickAndSettle, goTo, stage } from "../test/driveApp";
import { backend } from "../test/fakeBackend";

const t = translator("en");

async function open() {
  await boot();
  goTo("Settings");
}

const click = (name: string) =>
  clickAndSettle(stage().getByRole("button", { name }));

describe("move my earlier data again", () => {
  const moveButton = () =>
    stage().queryByRole("button", { name: t("data.moveEarlier") });

  it("is not there unless Start fresh left something that can still be moved", async () => {
    await open();
    expect(backend.callsTo("can_move_earlier_data")).toHaveLength(1);
    expect(moveButton()).toBeNull();
  });

  it("moves it, reads the data again and goes away", async () => {
    backend.respond("can_move_earlier_data", true);
    await open();
    expect(
      await stage().findByRole("button", { name: t("data.moveEarlier") }),
    ).toBeInTheDocument();
    await click(t("data.moveEarlier"));
    expect(backend.callsTo("move_earlier_data")).toHaveLength(1);
    expect(backend.callsTo("get_profile")).toHaveLength(2);
    expect(stage().getByText(t("data.movedEarlier"))).toBeInTheDocument();
    expect(moveButton()).toBeNull();
  });

  it("stays in Settings with the error and the button when the move fails", async () => {
    backend.respond("can_move_earlier_data", true);
    await open();
    await stage().findByRole("button", { name: t("data.moveEarlier") });
    backend.fail("move_earlier_data", {
      kind: "migration_failed",
      message: "disk went away",
    });
    await click(t("data.moveEarlier"));
    expect(backend.callsTo("get_profile")).toHaveLength(1);
    expect(
      screen.queryByRole("heading", { name: t("load.moveTitle") }),
    ).toBeNull();
    expect(stage().getByText(t("error.migration_failed"))).toHaveAttribute(
      "data-failed",
      "true",
    );
    expect(moveButton()).toBeInTheDocument();
  });

  it("is in Spanish too", () => {
    expect(translator("es")("data.moveEarlier")).toBe(
      "Mover de nuevo mis datos anteriores",
    );
    expect(translator("es")("data.movedEarlier")).not.toBe(
      t("data.movedEarlier"),
    );
  });
});

describe("delete all data and the earlier folders", () => {
  it("says nothing extra when every older folder could be checked", async () => {
    await open();
    await click(t("data.deleteAll"));
    await clickAndSettle(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: t("data.confirmAction"),
      }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says so when an earlier folder could not be checked and was left in place", async () => {
    backend.respond("delete_all_data", {
      oldFolderRemoved: false,
      previousFolderRemoved: false,
      couldNotCheck: true,
    });
    await open();
    await click(t("data.deleteAll"));
    await clickAndSettle(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: t("data.confirmAction"),
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      t("error.earlier_data_unchecked"),
    );
    expect(t("error.earlier_data_unchecked")).toMatch(/left in place/);
    expect(translator("es")("error.earlier_data_unchecked")).toMatch(/dejaron/);
  });
});
