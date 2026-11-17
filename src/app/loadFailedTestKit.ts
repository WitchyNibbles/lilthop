// Queries and actions on the screen that stands in when the profile can't be read, for its tests.
import { translator } from "../i18n";
import { clickAndSettle, stage } from "../test/driveApp";

export const t = translator("en");

export const setup = () =>
  stage().queryByRole("heading", { name: t("onboarding.welcome") });

export const tryAgainButton = () =>
  stage().getByRole("button", { name: t("error.retry") });

export const tryAgain = () => clickAndSettle(tryAgainButton());
