import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translator } from "../i18n";
import { boot, clickAndSettle, goTo, rail, stage } from "../test/driveApp";
import { backend, PROFILE } from "../test/fakeBackend";

const t = translator("en");
const READ_ERROR = { kind: "io", message: "database is locked" };

const failedScreen = () =>
  stage().queryByRole("heading", { name: t("load.title") });
const setup = () =>
  stage().queryByRole("heading", { name: t("onboarding.welcome") });
const tryAgainButton = () =>
  stage().getByRole("button", { name: t("error.retry") });
const tryAgain = () => clickAndSettle(tryAgainButton());

async function bootWithFailedRead() {
  backend.fail("get_profile", READ_ERROR);
  await boot();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("when the saved profile can't be read", () => {
  it("says so plainly and does not offer setup", async () => {
    await bootWithFailedRead();
    expect(failedScreen()).toBeInTheDocument();
    expect(setup()).toBeNull();
  });

  it("doesn't tell a returning person about a safety step", async () => {
    await bootWithFailedRead();
    expect(rail().queryByText(t("nav.locked"))).toBeNull();
  });

  it("doesn't say there are no goals, when they just couldn't be read", async () => {
    await bootWithFailedRead();
    expect(rail().queryByText(t("home.noGoals"))).toBeNull();
  });

  it("speaks the system's language, with no profile to ask", async () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("es-MX");
    await bootWithFailedRead();
    const es = translator("es");
    expect(
      stage().getByRole("heading", { name: es("load.title") }),
    ).toBeInTheDocument();
    expect(
      stage().getByRole("button", { name: es("error.retry") }),
    ).toBeInTheDocument();
  });

  it("brings a returning person home, saving nothing on the way", async () => {
    await bootWithFailedRead();
    backend.respond("get_profile", PROFILE);
    await tryAgain();
    await waitFor(() => expect(failedScreen()).toBeNull());
    expect(setup()).toBeNull();
    expect(stage().getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(backend.callsTo("get_profile")).toHaveLength(2);
    expect(backend.callsTo("set_profile")).toHaveLength(0);
  });

  it("sends someone with no profile after all to setup", async () => {
    await bootWithFailedRead();
    backend.respond("get_profile", null);
    await tryAgain();
    await waitFor(() => expect(setup()).toBeInTheDocument());
    expect(backend.callsTo("set_profile")).toHaveLength(0);
  });

  it("stays put and says so when the second try fails too", async () => {
    await bootWithFailedRead();
    expect(stage().queryByText(t("load.stillFailed"))).toBeNull();
    await tryAgain();
    await waitFor(() =>
      expect(stage().getByText(t("load.stillFailed"))).toBeInTheDocument(),
    );
    expect(failedScreen()).toBeInTheDocument();
    expect(tryAgainButton()).toBeEnabled();
    expect(setup()).toBeNull();
  });

  it("can't be pressed twice while a try is running", async () => {
    await bootWithFailedRead();
    const release = backend.hold("get_profile", PROFILE);
    await tryAgain();
    expect(tryAgainButton()).toBeDisabled();
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await waitFor(() => expect(failedScreen()).toBeNull());
  });

  it("drops the old error once a try works", async () => {
    backend.fail("get_results", READ_ERROR);
    await bootWithFailedRead();
    backend.respond("get_profile", PROFILE);
    backend.respond("get_results", []);
    await tryAgain();
    await waitFor(() => expect(failedScreen()).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("when the earlier data could not be moved to the new folder", () => {
  const MOVE_ERROR = { kind: "migration_failed", message: "disk went away" };
  const moveTitle = () =>
    stage().queryByRole("heading", { name: t("load.moveTitle") });

  async function bootWithFailedMove() {
    backend.fail("get_profile", MOVE_ERROR);
    await boot();
  }

  it("says the data is untouched in its old place, not that the profile is broken", async () => {
    await bootWithFailedMove();
    expect(moveTitle()).toBeInTheDocument();
    expect(failedScreen()).toBeNull();
    expect(stage().getByText(t("error.migration_failed"))).toBeInTheDocument();
    expect(t("error.migration_failed")).toMatch(/untouched/);
    expect(t("error.migration_failed")).toContain("com.voice.trainer");
    expect(setup()).toBeNull();
  });

  it("says it in Spanish too", async () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("es-MX");
    await bootWithFailedMove();
    const es = translator("es");
    expect(
      stage().getByRole("heading", { name: es("load.moveTitle") }),
    ).toBeInTheDocument();
    expect(stage().getByText(es("error.migration_failed"))).toBeInTheDocument();
    expect(es("error.migration_failed")).toMatch(/intactos/);
  });

  it("tries the move again on retry and goes home when it works", async () => {
    await bootWithFailedMove();
    backend.respond("get_profile", PROFILE);
    await tryAgain();
    await waitFor(() => expect(moveTitle()).toBeNull());
    expect(setup()).toBeNull();
    expect(backend.callsTo("get_profile")).toHaveLength(2);
    expect(backend.callsTo("set_profile")).toHaveLength(0);
  });

  it("stays on the same message when the retry fails too", async () => {
    await bootWithFailedMove();
    await tryAgain();
    await waitFor(() =>
      expect(stage().getByText(t("load.moveStillFailed"))).toBeInTheDocument(),
    );
    expect(moveTitle()).toBeInTheDocument();
    expect(tryAgainButton()).toBeEnabled();
    expect(setup()).toBeNull();
  });

  describe("start fresh", () => {
    const startFreshButton = () =>
      stage().queryByRole("button", { name: t("load.startFresh") });
    const dialog = () => within(screen.getByRole("dialog"));
    const confirm = () =>
      clickAndSettle(
        dialog().getByRole("button", { name: t("load.startFreshAction") }),
      );

    it("is offered next to retry, with a note that the old data stays where it is", async () => {
      await bootWithFailedMove();
      expect(startFreshButton()).toBeInTheDocument();
      expect(stage().getByText(t("load.startFreshNote"))).toBeInTheDocument();
      expect(tryAgainButton()).toBeEnabled();
    });

    it("is not offered when the profile simply could not be read", async () => {
      await bootWithFailedRead();
      expect(startFreshButton()).toBeNull();
      expect(stage().queryByText(t("load.startFreshNote"))).toBeNull();
    });

    it("asks first, and says what happens to the earlier data", async () => {
      await bootWithFailedMove();
      await clickAndSettle(startFreshButton()!);
      expect(backend.callsTo("start_fresh")).toHaveLength(0);
      const body = t("load.startFreshConfirmBody");
      expect(dialog().getByText(body)).toBeInTheDocument();
      expect(body).toMatch(/stays in its old folder/);
      expect(body).toMatch(/won't try to move it again/);
      expect(body).toContain(t("data.deleteAll"));
    });

    it("does nothing when the person cancels", async () => {
      await bootWithFailedMove();
      await clickAndSettle(startFreshButton()!);
      await clickAndSettle(
        dialog().getByRole("button", { name: t("common.cancel") }),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(backend.callsTo("start_fresh")).toHaveLength(0);
      expect(moveTitle()).toBeInTheDocument();
    });

    it("tells the backend to skip the move once confirmed, then reads again and goes on", async () => {
      await bootWithFailedMove();
      backend.handle("start_fresh", () => {
        backend.respond("get_profile", null);
      });
      await clickAndSettle(startFreshButton()!);
      await confirm();
      await waitFor(() => expect(moveTitle()).toBeNull());
      expect(backend.callsTo("start_fresh")).toHaveLength(1);
      expect(backend.callsTo("get_profile")).toHaveLength(2);
      expect(setup()).toBeInTheDocument();
      expect(backend.callsTo("set_profile")).toHaveLength(0);
    });

    it("stays put and says so when the backend cannot start fresh", async () => {
      await bootWithFailedMove();
      backend.fail("start_fresh", { kind: "io", message: "disk is full" });
      await clickAndSettle(startFreshButton()!);
      await confirm();
      await waitFor(() =>
        expect(
          stage().getByText(t("load.startFreshFailed")),
        ).toBeInTheDocument(),
      );
      expect(moveTitle()).toBeInTheDocument();
      expect(backend.callsTo("get_profile")).toHaveLength(1);
    });

    it("says it in Spanish too", async () => {
      vi.spyOn(navigator, "language", "get").mockReturnValue("es-MX");
      await bootWithFailedMove();
      const es = translator("es");
      expect(stage().getByText(es("load.startFreshNote"))).toBeInTheDocument();
      await clickAndSettle(
        stage().getByRole("button", { name: es("load.startFresh") }),
      );
      expect(
        dialog().getByText(es("load.startFreshConfirmBody")),
      ).toBeInTheDocument();
      expect(es("load.startFreshConfirmBody")).toContain(es("data.deleteAll"));
      expect(es("load.startFreshConfirmBody")).toMatch(/carpeta antigua/);
    });
  });

  it("shows the same words in the alert when another read hits it", async () => {
    backend.fail("get_results", MOVE_ERROR);
    await boot();
    expect(
      await screen.findByRole("alert", {
        name: "",
      }),
    ).toHaveTextContent(t("error.migration_failed"));
  });

  it("falls back to the plain message once a different error comes", async () => {
    await bootWithFailedMove();
    backend.fail("get_profile", READ_ERROR);
    await tryAgain();
    await waitFor(() => expect(failedScreen()).toBeInTheDocument());
    expect(moveTitle()).toBeNull();
  });
});

describe("when a later read fails", () => {
  async function restoreThatCannotBeReadBack() {
    await boot();
    goTo("Settings");
    backend.fail("get_profile", READ_ERROR);
    await clickAndSettle(
      stage().getByRole("button", { name: t("data.restore") }),
    );
    await waitFor(() => expect(failedScreen()).toBeInTheDocument());
  }

  it("takes the screens that save the profile away", async () => {
    await restoreThatCannotBeReadBack();
    expect(
      stage().queryByRole("button", { name: t("settings.saveGoals") }),
    ).toBeNull();
    expect(
      stage().queryByRole("button", { name: t("settings.calibrate") }),
    ).toBeNull();
  });

  it("shows the same screen wherever someone goes", async () => {
    await restoreThatCannotBeReadBack();
    goTo("Practice");
    expect(failedScreen()).toBeInTheDocument();
  });

  it("goes home after a try that works, where setup can still catch a new profile", async () => {
    await restoreThatCannotBeReadBack();
    backend.respond("get_profile", { ...PROFILE, onboarded: false });
    await tryAgain();
    await waitFor(() => expect(setup()).toBeInTheDocument());
    expect(backend.callsTo("set_profile")).toHaveLength(0);
  });
});

describe("what doesn't count as a failed read", () => {
  it("a failed results read leaves the profile's answer in charge", async () => {
    backend.respond("get_profile", null);
    backend.fail("get_results", READ_ERROR);
    await boot();
    expect(setup()).toBeInTheDocument();
    expect(failedScreen()).toBeNull();
  });

  it("an error while the read is still out doesn't open setup", async () => {
    const release = backend.hold("get_profile", PROFILE);
    backend.fail("get_results", READ_ERROR);
    await boot();
    expect(setup()).toBeNull();
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(stage().getByRole("heading", { level: 1 })).toBeInTheDocument(),
    );
    expect(setup()).toBeNull();
  });
});
