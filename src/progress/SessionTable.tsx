import { useApp } from "../app/appContext";
import { Icon } from "../art/icons";
import type { SavedResult } from "../domain/contract";
import { markKind } from "./sessionChartData";
import { sessionDate, sessionResult } from "./sessionText";

/** The chart in words, for keyboards, screen readers and anyone who prefers numbers. */
export function SessionTable({
  rows,
}: {
  readonly rows: readonly SavedResult[];
}) {
  const { language, t } = useApp();
  return (
    <details className="session-table">
      <summary>
        <Icon name="chevron" />
        {t("progress.tableSummary")}
      </summary>
      <table>
        <thead>
          <tr>
            <th scope="col">{t("progress.tableDate")}</th>
            <th scope="col">{t("progress.tableResult")}</th>
            <th scope="col">{t("progress.tableMeasured")}</th>
          </tr>
        </thead>
        <tbody>
          {[...rows].reverse().map((row) => (
            <tr key={row.id}>
              <td>{sessionDate(row, language)}</td>
              <td className="mono">{sessionResult(row, t)}</td>
              <td>
                {t(
                  markKind(row) === "old"
                    ? "progress.legendOld"
                    : "progress.legendCurrent",
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
