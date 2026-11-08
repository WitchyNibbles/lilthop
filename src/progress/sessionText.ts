import type { Language, SavedResult } from "../domain/contract";
import type { MessageKey, Translator } from "../i18n";
import type { TrendDirection } from "../domain/stats";

export const TREND_MESSAGE: Readonly<Record<TrendDirection, MessageKey>> = {
  up: "progress.trendUp",
  down: "progress.trendDown",
  flat: "progress.trendFlat",
  unknown: "progress.trendUnknown",
};

export function sessionDate(result: SavedResult, language: Language): string {
  return new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(
    new Date(result.createdAt * 1000),
  );
}

export function sessionResult(result: SavedResult, t: Translator): string {
  return result.score === null
    ? t("progress.noScore")
    : t("progress.scoreValue", { score: Math.round(result.score) });
}
