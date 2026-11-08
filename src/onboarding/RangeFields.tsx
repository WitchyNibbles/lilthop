import { useApp } from "../app/appContext";
import { Icon } from "../art/icons";
import type { Band } from "../live/traceScale";

const LOWEST_HZ = 40;
const HIGHEST_HZ = 2000;

export interface RangeText {
  readonly min: string;
  readonly max: string;
}

export const rangeText = (band: Band): RangeText => ({
  min: String(band.minHz),
  max: String(band.maxHz),
});

export const isEmptyRange = ({ min, max }: RangeText): boolean =>
  min.trim() === "" && max.trim() === "";

/** The band typed, or null when it is not one. */
export function parseRange({ min, max }: RangeText): Band | null {
  const minHz = Number(min);
  const maxHz = Number(max);
  const valid =
    Number.isFinite(minHz) &&
    Number.isFinite(maxHz) &&
    minHz >= LOWEST_HZ &&
    maxHz <= HIGHEST_HZ &&
    minHz < maxHz;
  return valid ? { minHz, maxHz } : null;
}

interface RangeFieldsProps {
  readonly value: RangeText;
  readonly onChange: (value: RangeText) => void;
}

export function RangeFields({ value, onChange }: RangeFieldsProps) {
  const { t } = useApp();
  return (
    <div className="range-fields">
      <label>
        <span>{t("common.minHz")}</span>
        <input
          className="mono"
          max={HIGHEST_HZ}
          min={LOWEST_HZ}
          onChange={(event) => onChange({ ...value, min: event.target.value })}
          type="number"
          value={value.min}
        />
      </label>
      <label>
        <span>{t("common.maxHz")}</span>
        <input
          className="mono"
          max={HIGHEST_HZ}
          min={LOWEST_HZ}
          onChange={(event) => onChange({ ...value, max: event.target.value })}
          type="number"
          value={value.max}
        />
      </label>
    </div>
  );
}

/** Where the suggested range's numbers come from, folded away until someone asks. */
export function RangeSources() {
  const { t } = useApp();
  return (
    <details className="range-sources">
      <summary>
        <Icon name="chevron" />
        {t("range.sourcesTitle")}
      </summary>
      <p>{t("range.sources")}</p>
    </details>
  );
}
