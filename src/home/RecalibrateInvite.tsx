import { useApp } from "../app/appContext";

/** Asked once: either answer settles it, so nobody is nagged about a measurement. */
export function RecalibrateInvite() {
  const { openScreen, profile, reportDataIssue, saveProfile, t } = useApp();
  if (profile?.pitchEngine !== 1) return null;

  const settle = () => {
    saveProfile({ ...profile, pitchEngine: 2 }).catch(reportDataIssue);
  };

  return (
    <section className="invite">
      <p>{t("recalibrate.invite")}</p>
      <div className="invite-actions">
        <button
          className="btn"
          onClick={() => {
            settle();
            openScreen("calibrate");
          }}
          type="button"
        >
          {t("calibration.again")}
        </button>
        <button className="btn" onClick={settle} type="button">
          {t("recalibrate.notNow")}
        </button>
      </div>
    </section>
  );
}
