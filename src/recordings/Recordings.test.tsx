import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n";
import { boot, clickAndSettle, goTo, stage } from "../test/driveApp";
import { backend, recording } from "../test/fakeBackend";

const t = translator("en");

async function open(items = [recording()]) {
  backend.respond("list_recordings", items);
  await boot();
  goTo("Recordings");
  await act(async () => {
    await Promise.resolve();
  });
}

const noteBox = () => stage().getByRole("textbox", { name: /^Note for/ });
const tagsBox = () => stage().getByRole("textbox", { name: /^Tags for/ });

async function blur(element: HTMLElement) {
  await act(async () => {
    fireEvent.blur(element);
    await Promise.resolve();
  });
}

describe("the list", () => {
  it("teaches when it is empty", async () => {
    await open([]);
    expect(stage().getByText(t("recordings.none"))).toBeInTheDocument();
    expect(stage().getByText(t("recordings.noneHelp"))).toBeInTheDocument();
  });

  it("loads notes and tags from list_recordings", async () => {
    await open([recording({ note: "after warm-up", tags: "morning" })]);
    expect(noteBox()).toHaveValue("after warm-up");
    expect(tagsBox()).toHaveValue("morning");
  });

  it("never shows a file path or even a file name", async () => {
    await open([recording({ name: "rec_secret.wav" })]);
    expect(stage().queryByText(/rec_secret|\.wav|\//)).toBeNull();
  });

  it("shows a real error when the list cannot load", async () => {
    backend.fail("list_recordings", { kind: "io", message: "no folder" });
    await boot();
    goTo("Recordings");
    expect(
      await stage().findByText(t("error.io", { message: "no folder" })),
    ).toBeInTheDocument();
  });
});

describe("notes", () => {
  it("does not save when the box is entered and left unchanged", async () => {
    await open([recording({ note: "keep me", tags: "tag" })]);
    fireEvent.focus(noteBox());
    await blur(noteBox());
    fireEvent.focus(tagsBox());
    await blur(tagsBox());
    expect(backend.callsTo("set_recording_meta")).toHaveLength(0);
  });

  it("saves a real change with both fields, and says so", async () => {
    await open([recording({ note: "old", tags: "tag" })]);
    fireEvent.change(noteBox(), { target: { value: "new" } });
    await blur(noteBox());
    expect(backend.lastCallTo("set_recording_meta")?.args).toEqual({
      name: "rec_1.wav",
      note: "new",
      tags: "tag",
    });
    expect(stage().getByText(t("recordings.saved"))).toBeInTheDocument();
  });

  it("does not save the same change twice", async () => {
    await open();
    fireEvent.change(noteBox(), { target: { value: "new" } });
    await blur(noteBox());
    await blur(noteBox());
    expect(backend.callsTo("set_recording_meta")).toHaveLength(1);
  });

  it("shows Saving while it is on its way", async () => {
    const release = backend.hold("set_recording_meta", undefined);
    await open();
    fireEvent.change(noteBox(), { target: { value: "new" } });
    await blur(noteBox());
    expect(stage().getByText(t("recordings.saving"))).toBeInTheDocument();
    await act(async () => {
      release();
      await Promise.resolve();
    });
  });

  it("keeps what was typed while the last save was running", async () => {
    const release = backend.hold("set_recording_meta", undefined);
    await open();
    fireEvent.change(noteBox(), { target: { value: "new" } });
    await blur(noteBox());
    fireEvent.change(tagsBox(), { target: { value: "evening" } });
    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(noteBox()).toHaveValue("new");
    expect(tagsBox()).toHaveValue("evening");
  });

  it("keeps the text and offers a retry when saving fails", async () => {
    backend.fail("set_recording_meta", { kind: "database", message: "full" });
    await open();
    fireEvent.change(noteBox(), { target: { value: "precious" } });
    await blur(noteBox());
    expect(noteBox()).toHaveValue("precious");
    expect(stage().getByText(/^Not saved:/)).toBeInTheDocument();
    backend.respond("set_recording_meta", undefined);
    await clickAndSettle(
      stage().getByRole("button", { name: t("error.retry") }),
    );
    expect(stage().getByText(t("recordings.saved"))).toBeInTheDocument();
  });
});

describe("recording", () => {
  it("records, stops, and puts the new take in the list", async () => {
    await open([]);
    await clickAndSettle(
      stage().getByRole("button", { name: t("recordings.record") }),
    );
    expect(stage().getByText(t("recordings.recording"))).toBeInTheDocument();
    await clickAndSettle(
      stage().getByRole("button", { name: t("recordings.stopRecording") }),
    );
    expect(backend.callsTo("stop_recording")).toHaveLength(1);
    expect(noteBox()).toBeInTheDocument();
  });

  it("still knows it is recording after a look at another screen", async () => {
    await open([]);
    await clickAndSettle(
      stage().getByRole("button", { name: t("recordings.record") }),
    );
    goTo("Home");
    goTo("Recordings");
    expect(
      stage().getByRole("button", { name: t("recordings.stopRecording") }),
    ).toBeInTheDocument();
  });

  it("shows a real error when recording cannot start", async () => {
    backend.fail("start_recording", { kind: "stream_failed", message: "x" });
    await open([]);
    await clickAndSettle(
      stage().getByRole("button", { name: t("recordings.record") }),
    );
    expect(stage().getByText(t("error.stream_failed"))).toBeInTheDocument();
    expect(
      stage().getByRole("button", { name: t("recordings.record") }),
    ).toBeEnabled();
  });
});

describe("playing", () => {
  const playButton = () => stage().getByRole("button", { name: /^Play/ });

  it("plays, shows stop, and stops", async () => {
    await open();
    await clickAndSettle(playButton());
    expect(backend.lastCallTo("play_recording")?.args).toEqual({
      name: "rec_1.wav",
    });
    await clickAndSettle(
      stage().getByRole("button", { name: /^Stop playing/ }),
    );
    expect(backend.callsTo("stop_playback")).toHaveLength(1);
    expect(playButton()).toBeInTheDocument();
  });

  it("goes back to Play when the clip ends by itself", async () => {
    await open();
    await clickAndSettle(playButton());
    await waitFor(() => expect(backend.listening("playback-ended")).toBe(true));
    act(() => backend.emit("playback-ended", { name: "rec_1.wav" }));
    expect(playButton()).toBeInTheDocument();
  });

  it("shows a real error when playing fails", async () => {
    backend.fail("play_recording", { kind: "not_found", message: "gone" });
    await open();
    await clickAndSettle(playButton());
    expect(stage().getByText(t("error.not_found"))).toBeInTheDocument();
    expect(playButton()).toBeInTheDocument();
  });
});

describe("a failure elsewhere", () => {
  it("does not make a running recording look stopped", async () => {
    backend.fail("play_recording", { kind: "io", message: "busy" });
    await open();
    await clickAndSettle(
      stage().getByRole("button", { name: t("recordings.record") }),
    );
    await clickAndSettle(stage().getByRole("button", { name: /^Play/ }));
    expect(stage().getByText(t("recordings.recording"))).toBeInTheDocument();
    expect(
      stage().getByRole("button", { name: t("recordings.stopRecording") }),
    ).toBeInTheDocument();
  });
});

describe("deleting", () => {
  const deleteButton = () =>
    stage().getByRole("button", { name: /^Delete recording/ });

  const confirmDelete = async () => {
    await clickAndSettle(deleteButton());
    await clickAndSettle(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: t("common.delete"),
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });
  };

  it("lets go of a recording that is playing before deleting it", async () => {
    await open();
    await clickAndSettle(stage().getByRole("button", { name: /^Play/ }));
    await confirmDelete();
    expect(backend.callsTo("stop_playback")).toHaveLength(1);
    expect(backend.callsTo("delete_recording")).toHaveLength(1);
  });

  it("puts focus on the heading once the row has gone", async () => {
    await open();
    const button = deleteButton();
    button.focus();
    await confirmDelete();
    await waitFor(() =>
      expect(
        stage().getByRole("heading", { name: t("recordings.title") }),
      ).toHaveFocus(),
    );
  });

  it("asks first, and Cancel keeps the recording", async () => {
    await open();
    await clickAndSettle(deleteButton());
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(t("recordings.confirmTitle"))).toBeInTheDocument();
    await clickAndSettle(
      dialog.getByRole("button", { name: t("common.cancel") }),
    );
    expect(backend.callsTo("delete_recording")).toHaveLength(0);
    expect(noteBox()).toBeInTheDocument();
  });

  it("deletes once confirmed, and says so", async () => {
    await open();
    await clickAndSettle(deleteButton());
    await clickAndSettle(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: t("common.delete"),
      }),
    );
    expect(backend.lastCallTo("delete_recording")?.args).toEqual({
      name: "rec_1.wav",
    });
    expect(stage().getByText(t("recordings.deleted"))).toBeInTheDocument();
    expect(stage().queryByRole("textbox", { name: /^Note for/ })).toBeNull();
  });

  it("keeps the row and shows why when deleting fails", async () => {
    backend.fail("delete_recording", { kind: "io", message: "locked" });
    await open();
    await clickAndSettle(deleteButton());
    await clickAndSettle(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: t("common.delete"),
      }),
    );
    expect(
      stage().getByText(t("error.io", { message: "locked" })),
    ).toBeInTheDocument();
    expect(noteBox()).toBeInTheDocument();
  });
});

describe("search", () => {
  it("matches notes and tags, and says when nothing matches", async () => {
    await open([
      recording({ name: "a.wav", note: "morning hum" }),
      recording({ name: "b.wav", tags: "evening" }),
    ]);
    const search = stage().getByRole("searchbox", {
      name: t("recordings.search"),
    });
    fireEvent.change(search, { target: { value: "MORNING" } });
    expect(stage().getAllByRole("textbox", { name: /^Note for/ })).toHaveLength(
      1,
    );
    fireEvent.change(search, { target: { value: "evening" } });
    expect(stage().getByRole("textbox", { name: /^Tags for/ })).toHaveValue(
      "evening",
    );
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(stage().getByText(t("recordings.noMatch"))).toBeInTheDocument();
  });
});
