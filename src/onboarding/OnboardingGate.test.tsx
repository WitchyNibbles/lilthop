import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n";
import { boot, clickAndSettle, rail, stage } from "../test/driveApp";
import { backend, PROFILE } from "../test/fakeBackend";
import {
  bootFresh,
  click,
  heading,
  savedProfile,
  t,
  toMicStep,
} from "./onboardingTestKit";

const es = translator("es");

const navButtons = () =>
  within(rail().getByRole("navigation")).getAllByRole("button");
const navButton = (name: string) => rail().getByRole("button", { name });
const expectNav = (open: boolean) => {
  for (const button of navButtons())
    if (open) expect(button).toBeEnabled();
    else expect(button).toBeDisabled();
};

describe("the rail before the safety step is passed", () => {
  it("is really disabled on step 1", async () => {
    await bootFresh();
    expectNav(false);
  });

  it("goes nowhere when clicked", async () => {
    await bootFresh();
    fireEvent.click(navButton(t("nav.practice")));
    expect(heading(t("onboarding.welcome"))).toBeInTheDocument();
  });

  it("is still disabled on the safety step", async () => {
    await bootFresh();
    await click(t("common.next"));
    expect(heading(t("safety.beforeTitle"))).toBeInTheDocument();
    expectNav(false);
  });

  it("says why, and tells a screen reader too", async () => {
    await bootFresh();
    const hint = rail().getByText(t("nav.locked"));
    expect(rail().getByRole("navigation")).toHaveAccessibleDescription(
      t("nav.locked"),
    );
    expect(hint).toBeVisible();
  });

  it("also holds for a saved profile that never finished setup", async () => {
    backend.respond("get_profile", { ...PROFILE, onboarded: false });
    await boot();
    expectNav(false);
  });
});

describe("the rail while the profile is still being read", () => {
  it("holds, so a new person can't slip past setup", async () => {
    const release = backend.hold("get_profile", null);
    await boot();
    expectNav(false);
    fireEvent.click(navButton(t("nav.practice")));
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(heading(t("onboarding.welcome"))).toBeInTheDocument(),
    );
  });
});

describe("a restored backup that never finished setup", () => {
  async function restoreUnfinished() {
    await boot();
    fireEvent.click(navButton(t("nav.settings")));
    backend.respond("get_profile", { ...PROFILE, onboarded: false });
    await clickAndSettle(
      stage().getByRole("button", { name: t("data.restore") }),
    );
    await waitFor(() => expect(backend.callsTo("get_profile")).toHaveLength(2));
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("leaves a returning person a way off Settings", async () => {
    await restoreUnfinished();
    expectNav(true);
    expect(rail().queryByText(t("nav.locked"))).toBeNull();
    fireEvent.click(navButton(t("nav.progress")));
    expect(
      stage().getByRole("heading", { name: t("nav.progress") }),
    ).toBeInTheDocument();
  });

  it("walks them through setup, locked, if they go Home", async () => {
    await restoreUnfinished();
    fireEvent.click(navButton(t("nav.home")));
    expect(heading(t("onboarding.welcome"))).toBeInTheDocument();
    expectNav(false);
  });
});

describe("the rail after the safety step", () => {
  it("opens on step 3 and works", async () => {
    await toMicStep();
    expectNav(true);
    expect(rail().queryByText(t("nav.locked"))).toBeNull();
    fireEvent.click(navButton(t("nav.settings")));
    expect(
      stage().getByRole("heading", { name: t("nav.settings") }),
    ).toBeInTheDocument();
  });

  it("stays open if someone goes back to the safety step", async () => {
    await toMicStep();
    await click(t("common.back"));
    expectNav(true);
  });

  it("is never locked for someone who finished setup", async () => {
    await boot();
    expectNav(true);
  });
});

describe("other ways around the safety step", () => {
  it("Skip on step 1 lands on it", async () => {
    await bootFresh();
    await click(t("common.skip"));
    expect(heading(t("safety.beforeTitle"))).toBeInTheDocument();
  });

  it("a reload mid-setup starts over, rail locked", async () => {
    await toMicStep();
    cleanup();
    await boot();
    expect(heading(t("onboarding.welcome"))).toBeInTheDocument();
    expectNav(false);
  });
});

describe("the language on step 1", () => {
  const pickSpanish = () =>
    fireEvent.change(
      stage().getByRole("combobox", { name: t("settings.language") }),
      { target: { value: "es" } },
    );

  it("can be changed before the safety text is shown", async () => {
    await bootFresh();
    pickSpanish();
    expect(heading(es("onboarding.welcome"))).toBeInTheDocument();
    await click(es("common.next"));
    expect(screen.getByText(es("safety.s9"))).toBeInTheDocument();
  });

  it("is what the finished profile saves", async () => {
    await bootFresh();
    pickSpanish();
    await click(es("common.next"));
    await click(es("common.next"));
    for (let step = 0; step < 3; step++) await click(es("common.skip"));
    await click(es("onboarding.saveContinue"));
    expect(savedProfile().language).toBe("es");
  });
});
