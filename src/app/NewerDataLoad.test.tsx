import { waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { boot, stage } from "../test/driveApp";
import { backend } from "../test/fakeBackend";
import { setup, t, tryAgain, tryAgainButton } from "./loadFailedTestKit";

describe("when the data is from a newer version", () => {
  const NEWER = {
    kind: "newer_data",
    message: "this data was saved by a newer version of the app",
  };

  it("says so, and offers neither setup nor a fresh start", async () => {
    backend.fail("get_profile", NEWER);
    await boot();
    expect(
      stage().getByRole("heading", { name: t("load.newerTitle") }),
    ).toBeInTheDocument();
    expect(stage().getByRole("alert")).toHaveTextContent(t("error.newer_data"));
    expect(
      stage().queryByRole("button", { name: t("load.startFresh") }),
    ).toBeNull();
    expect(setup()).toBeNull();
    expect(tryAgainButton()).toBeInTheDocument();
  });

  it("stays on the same message when the retry fails too", async () => {
    backend.fail("get_profile", NEWER);
    await boot();
    await tryAgain();
    await waitFor(() =>
      expect(stage().getByText(t("load.stillFailed"))).toBeInTheDocument(),
    );
    expect(
      stage().getByRole("heading", { name: t("load.newerTitle") }),
    ).toBeInTheDocument();
    expect(tryAgainButton()).toBeEnabled();
  });
});
