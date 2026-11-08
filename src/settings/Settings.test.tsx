import { act, fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n";
import { stream, voiced } from "../domain/testFrames";
import {
  boot,
  clickAndSettle,
  goTo,
  play,
  rail,
  stage,
} from "../test/driveApp";
import { backend, PROFILE } from "../test/fakeBackend";

const t = translator("en");

async function open() {
  await boot();
  goTo("Settings");
}

const click = (name: string) =>
  clickAndSettle(stage().getByRole("button", { name }));

describe("the device list", () => {
  it("is locked while the mic is opening, so the label can't run ahead of the stream", async () => {
    const release = backend.hold("start_pitch", {
      sampleRate: 48_000,
      device: "Desk mic",
      fellBack: false,
    });
    await open();
    const devices = stage().getByLabelText(t("settings.inputDevice"));
    expect(devices).toBeEnabled();
    await clickAndSettle(rail().getByRole("button", { name: "Start mic" }));
    expect(devices).toBeDisabled();
    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(stage().getByLabelText(t("settings.inputDevice"))).toBeEnabled();
  });
});

describe("your goals", () => {
  const goal = (key: "goal.pitch" | "goal.range") =>
    stage().getByRole("checkbox", { name: t(key) });
  const saveGoals = () => click(t("settings.saveGoals"));

  it("shows the saved goals and saves a change", async () => {
    await open();
    expect(goal("goal.pitch")).toBeChecked();
    expect(goal("goal.range")).not.toBeChecked();
    fireEvent.click(goal("goal.range"));
    await saveGoals();
    expect(backend.lastCallTo("set_profile")?.args).toEqual({
      profile: { ...PROFILE, goals: ["pitch", "range"] },
    });
    expect(stage().getByText(t("settings.goalsSaved"))).toBeInTheDocument();
  });

  it("changes today's routine in the rail", async () => {
    await open();
    fireEvent.click(goal("goal.range"));
    await saveGoals();
    expect(rail().getByRole("button", { name: /^Glides/ })).toBeInTheDocument();
  });
});

describe("your range", () => {
  it("starts from the saved range and saves a new one", async () => {
    await open();
    const min = stage().getByLabelText(t("common.minHz"));
    expect(min).toHaveValue(165);
    fireEvent.change(min, { target: { value: "150" } });
    await click(t("common.save"));
    expect(backend.lastCallTo("set_profile")?.args).toEqual({
      profile: { ...PROFILE, targetMinHz: 150 },
    });
    expect(stage().getByText(t("settings.rangeSaved"))).toBeInTheDocument();
  });

  it("says where the suggested numbers come from, folded away", async () => {
    await open();
    const details = stage()
      .getByText(t("range.sourcesTitle"))
      .closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent(t("range.sources"));
  });

  it("refuses nonsense and says why, saving nothing", async () => {
    await open();
    fireEvent.change(stage().getByLabelText(t("common.minHz")), {
      target: { value: "400" },
    });
    await click(t("common.save"));
    expect(stage().getByText(t("range.invalid"))).toBeInTheDocument();
    expect(backend.callsTo("set_profile")).toHaveLength(0);
  });

  it("shows the restored range after a restore", async () => {
    await open();
    backend.respond("get_profile", {
      ...PROFILE,
      targetMinHz: 100,
      targetMaxHz: 150,
    });
    await click(t("data.restore"));
    expect(await stage().findByDisplayValue("100")).toBeInTheDocument();
    expect(stage().getByLabelText(t("common.maxHz"))).toHaveValue(150);
  });

  it("reaches a mic that is already running", async () => {
    await open();
    await clickAndSettle(rail().getByRole("button", { name: "Start mic" }));
    fireEvent.change(stage().getByLabelText(t("common.maxHz")), {
      target: { value: "400" },
    });
    await click(t("common.save"));
    goTo("Practice");
    play(stream(2, () => voiced(300, 1900)));
    expect(stage().queryByText(t("reading.aboveBand"))).toBeNull();
    expect(stage().getByText(t("reading.inBand"))).toBeInTheDocument();
  });

  it("shows a real error when the range cannot be saved", async () => {
    backend.fail("set_profile", { kind: "database", message: "full" });
    await open();
    await click(t("common.save"));
    expect(
      stage().getByText(t("error.database", { message: "full" })),
    ).toBeInTheDocument();
  });
});

describe("export and backup", () => {
  it.each([
    [t("data.exportJson"), "export_data", { format: "json" }],
    [t("data.exportCsv"), "export_data", { format: "csv" }],
  ])("%s says where it went", async (label, command, args) => {
    await open();
    await click(label);
    expect(backend.lastCallTo(command)?.args).toEqual(args);
    expect(
      stage().getByText(t("data.exported", { name: "voice-data.json" })),
    ).toBeInTheDocument();
  });

  it("backup says where it went", async () => {
    await open();
    await click(t("data.backup"));
    expect(
      stage().getByText(t("data.backedUp", { name: "voice-backup.zip" })),
    ).toBeInTheDocument();
  });

  it.each([
    [t("data.exportJson"), "export_data"],
    [t("data.backup"), "backup_create"],
    [t("data.restore"), "backup_restore"],
  ])("%s says so when the dialog is cancelled", async (label, command) => {
    backend.respond(command, null);
    await open();
    await click(label);
    expect(stage().getByText(t("data.cancelled"))).toBeInTheDocument();
  });

  it.each([
    [t("data.exportJson"), "export_data"],
    [t("data.exportCsv"), "export_data"],
    [t("data.backup"), "backup_create"],
    [t("data.restore"), "backup_restore"],
  ])("%s shows a real error", async (label, command) => {
    backend.fail(command, { kind: "io", message: "disk full" });
    await open();
    await click(label);
    expect(
      stage().getByText(t("error.io", { message: "disk full" })),
    ).toBeInTheDocument();
  });
});

describe("restore", () => {
  it("gives a summary and reloads what came back", async () => {
    await open();
    const before = backend.callsTo("get_profile").length;
    await click(t("data.restore"));
    expect(
      stage().getByText(
        t("data.restoredProfile", { results: 3, recordings: 2 }),
      ),
    ).toBeInTheDocument();
    expect(backend.callsTo("get_profile").length).toBeGreaterThan(before);
  });

  it("says so when the backup held no settings", async () => {
    backend.respond("backup_restore", {
      results: 1,
      recordings: 0,
      profile: false,
    });
    await open();
    await click(t("data.restore"));
    expect(
      stage().getByText(t("data.restored", { results: 1, recordings: 0 })),
    ).toBeInTheDocument();
  });
});

describe("delete all data", () => {
  it("says it also removes the copies earlier versions left behind, and Cancel is safe", async () => {
    await open();
    await click(t("data.deleteAll"));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(t("data.confirmBody"))).toBeInTheDocument();
    expect(t("data.confirmBody")).toMatch(/earlier versions/);
    expect(translator("es")("data.confirmBody")).toMatch(
      /versiones anteriores/,
    );
    await clickAndSettle(
      dialog.getByRole("button", { name: t("common.cancel") }),
    );
    expect(backend.callsTo("delete_all_data")).toHaveLength(0);
  });

  it("stops the mic, deletes, and starts over at the welcome", async () => {
    await open();
    await clickAndSettle(rail().getByRole("button", { name: "Start mic" }));
    await click(t("data.deleteAll"));
    backend.respond("get_profile", null);
    await clickAndSettle(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: t("data.confirmAction"),
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(backend.callsTo("stop_pitch").length).toBeGreaterThan(0);
    expect(backend.callsTo("delete_all_data")).toHaveLength(1);
    expect(
      await stage().findByRole("heading", { name: t("onboarding.welcome") }),
    ).toBeInTheDocument();
  });

  it("leaves no recording running behind it", async () => {
    await open();
    goTo("Recordings");
    await clickAndSettle(
      stage().getByRole("button", { name: t("recordings.record") }),
    );
    goTo("Settings");
    await click(t("data.deleteAll"));
    await clickAndSettle(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: t("data.confirmAction"),
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    goTo("Recordings");
    expect(
      await stage().findByRole("button", { name: t("recordings.record") }),
    ).toBeInTheDocument();
  });

  it("shows a real error and stays put when deleting fails", async () => {
    backend.fail("delete_all_data", { kind: "io", message: "locked" });
    await open();
    await click(t("data.deleteAll"));
    await clickAndSettle(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: t("data.confirmAction"),
      }),
    );
    expect(
      stage().getByText(t("error.io", { message: "locked" })),
    ).toBeInTheDocument();
  });
});

describe("the rest of the page", () => {
  it("has the privacy note", async () => {
    await open();
    expect(stage().getByText(t("settings.privacy"))).toBeInTheDocument();
  });

  it("leads to the safety page", async () => {
    await open();
    await click(t("settings.readSafety"));
    expect(
      stage().getByRole("heading", { name: t("safety.title") }),
    ).toBeInTheDocument();
  });
});
