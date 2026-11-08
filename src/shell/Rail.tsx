import { useApp } from "../app/appContext";
import { Bunny } from "../art/Bunny";
import { useLive } from "../live/useLive";
import { MicPanel } from "./MicPanel";
import { NavList } from "./NavList";
import { RoutineList } from "./RoutineList";

function Brand() {
  const { t } = useApp();
  const inBand = useLive((view) => view.zone === "in");
  return (
    <div className="brand">
      <Bunny perked={inBand} />
      <span className="brand-name">{t("app.title")}</span>
    </div>
  );
}

export function Rail() {
  return (
    <aside className="rail">
      <Brand />
      <NavList />
      <RoutineList />
      <MicPanel />
    </aside>
  );
}
