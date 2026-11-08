export interface Band {
  readonly minHz: number;
  readonly maxHz: number;
}

export interface TraceScale {
  /** 0 at the bottom of the chart, 1 at the top. Values off the chart fall outside 0..1. */
  toUnit(value: number): number;
  readonly ticks: readonly number[];
}

export const TRACE_WINDOW_MS = 8_000;

/** The pitch detector's search range. */
const LOWEST_HZ = 60;
const HIGHEST_HZ = 1_000;
/** Room above and below the band, as a frequency ratio. */
const BAND_MARGIN = 1.75;
const CHART_WITHOUT_BAND: Band = { minHz: 75, maxHz: 500 };
const PITCH_TICKS = [60, 80, 100, 150, 200, 300, 400, 600, 800, 1000];

const LEVEL_FLOOR_DB = -60;
const LEVEL_TICKS = [-50, -40, -30, -20, -10];

export function pitchScale(band: Band | null): TraceScale {
  const edges = band ?? CHART_WITHOUT_BAND;
  const margin = band === null ? 1 : BAND_MARGIN;
  const low = Math.max(LOWEST_HZ, edges.minHz / margin);
  const high = Math.min(HIGHEST_HZ, edges.maxHz * margin);
  const span = Math.log2(high / low);
  return {
    toUnit: (hz) => Math.log2(hz / low) / span,
    ticks: PITCH_TICKS.filter((tick) => tick > low && tick < high),
  };
}

export function levelScale(): TraceScale {
  return {
    toUnit: (db) => (db - LEVEL_FLOOR_DB) / -LEVEL_FLOOR_DB,
    ticks: LEVEL_TICKS,
  };
}

/** The tip sweeps left to right and wraps, so what was already drawn stays where it is. */
export function sweepX(tMs: number, width: number): number {
  return ((tMs % TRACE_WINDOW_MS) / TRACE_WINDOW_MS) * width;
}
