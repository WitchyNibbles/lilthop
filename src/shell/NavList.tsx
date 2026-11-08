import {
  useApp,
  useInSetup,
  useNavLocked,
  type Screen,
} from "../app/appContext";
import { Icon, type IconName } from "../art/icons";
import type { MessageKey } from "../i18n";

const NAV_ITEMS: readonly {
  readonly screen: Screen;
  readonly label: MessageKey;
  readonly icon: IconName;
}[] = [
  { screen: "home", label: "nav.home", icon: "home" },
  { screen: "practice", label: "nav.practice", icon: "practice" },
  { screen: "progress", label: "nav.progress", icon: "progress" },
  { screen: "recordings", label: "nav.recordings", icon: "recordings" },
  { screen: "settings", label: "nav.settings", icon: "settings" },
];

const LOCKED_HINT_ID = "nav-locked-hint";

export function NavList() {
  const { openScreen, route, t } = useApp();
  const inSetup = useInSetup();
  const locked = useNavLocked();
  // Before the profile is read nobody knows there is a safety step to pass.
  const showsHint = locked && inSetup;
  return (
    <nav
      aria-describedby={showsHint ? LOCKED_HINT_ID : undefined}
      aria-label={t("nav.label")}
      className="nav"
    >
      <ul>
        {NAV_ITEMS.map(({ screen, label, icon }) => (
          <li key={screen}>
            <button
              aria-current={
                !inSetup && route.screen === screen ? "page" : undefined
              }
              className="nav-item"
              disabled={locked}
              onClick={() => openScreen(screen)}
              type="button"
            >
              <Icon name={icon} />
              {t(label)}
            </button>
          </li>
        ))}
      </ul>
      {showsHint ? (
        <p className="nav-locked" id={LOCKED_HINT_ID}>
          {t("nav.locked")}
        </p>
      ) : null}
    </nav>
  );
}
