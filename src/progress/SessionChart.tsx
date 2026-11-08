import { useEffect, useRef, useState } from "react";
import { useApp } from "../app/appContext";
import type { SavedResult } from "../domain/contract";
import {
  chartMarks,
  linePath,
  type ChartFrame,
  type ChartMark,
  type MarkKind,
} from "./sessionChartData";
import { sessionDate, sessionResult } from "./sessionText";

const HEIGHT = 220;
const DEFAULT_WIDTH = 560;
const SCORE_TICKS = [0, 50, 100];
const HIT_RADIUS = 14;
const MARK_RADIUS = 4;
/** About half a tooltip: its centre stays this far from the sides of the chart. */
const TIP_MARGIN = 60;

function useWidth() {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const element = box.current;
    if (element === null) return undefined;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth > 0) setWidth(element.clientWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { box, width };
}

function Axes({
  frame,
  rows,
}: {
  frame: ChartFrame;
  rows: readonly SavedResult[];
}) {
  const { language } = useApp();
  const { width, height, left, right, top, bottom } = frame;
  const plot = height - top - bottom;
  const first = rows[0];
  const last = rows[rows.length - 1];
  return (
    <g className="chart-axes">
      {SCORE_TICKS.map((tick) => {
        const y = height - bottom - (tick / 100) * plot;
        return (
          <g key={tick}>
            <line x1={left} x2={width - right} y1={y} y2={y} />
            <text textAnchor="end" x={left - 8} y={y + 4}>
              {tick}
            </text>
          </g>
        );
      })}
      {first === undefined ? null : (
        <text x={left} y={height - 4}>
          {sessionDate(first, language)}
        </text>
      )}
      {last === undefined || last === first ? null : (
        <text textAnchor="end" x={width - right} y={height - 4}>
          {sessionDate(last, language)}
        </text>
      )}
    </g>
  );
}

function Mark({
  mark,
  onHover,
}: {
  readonly mark: ChartMark;
  readonly onHover: (mark: ChartMark | null) => void;
}) {
  const { kind, x, y } = mark;
  return (
    <g>
      {kind === "unscored" ? (
        <path
          className="chart-mark"
          d={`M${x} ${y - 6}V${y + 2}`}
          data-mark={kind}
        />
      ) : (
        <circle
          className="chart-mark"
          cx={x}
          cy={y}
          data-mark={kind}
          r={MARK_RADIUS}
        />
      )}
      <circle
        className="chart-hit"
        cx={x}
        cy={y}
        onPointerEnter={() => onHover(mark)}
        onPointerLeave={() => onHover(null)}
        r={HIT_RADIUS}
      />
    </g>
  );
}

const LEGEND = {
  current: "progress.legendCurrent",
  old: "progress.legendOld",
  unscored: "progress.legendUnscored",
} as const;

function Legend({ kinds }: { readonly kinds: ReadonlySet<MarkKind> }) {
  const { t } = useApp();
  return (
    <ul className="chart-legend">
      {(["current", "old", "unscored"] as const)
        .filter((kind) => kinds.has(kind))
        .map((kind) => (
          <li key={kind}>
            <span className="chart-swatch" data-kind={kind} />
            {t(LEGEND[kind])}
          </li>
        ))}
    </ul>
  );
}

interface SessionChartProps {
  readonly rows: readonly SavedResult[];
  readonly label: string;
}

export function SessionChart({ rows, label }: SessionChartProps) {
  const { language, t } = useApp();
  const { box, width } = useWidth();
  const [hovered, setHovered] = useState<ChartMark | null>(null);
  const frame: ChartFrame = {
    width,
    height: HEIGHT,
    left: 36,
    right: 12,
    top: 12,
    bottom: 26,
  };
  const marks = chartMarks(rows, frame);
  return (
    <div className="chart" ref={box}>
      <svg
        aria-label={label}
        height={HEIGHT}
        role="img"
        viewBox={`0 0 ${width} ${HEIGHT}`}
        width={width}
      >
        <Axes frame={frame} rows={rows} />
        <path className="chart-line" d={linePath(marks)} />
        {marks.map((mark) => (
          <Mark key={mark.result.id} mark={mark} onHover={setHovered} />
        ))}
      </svg>
      {hovered === null ? null : (
        <div
          className="chart-tip"
          data-testid="chart-tip"
          style={{
            left: Math.min(Math.max(hovered.x, TIP_MARGIN), width - TIP_MARGIN),
            top: hovered.y,
          }}
        >
          <span>{sessionDate(hovered.result, language)}</span>
          <strong>{sessionResult(hovered.result, t)}</strong>
        </div>
      )}
      <Legend kinds={new Set(marks.map((mark) => mark.kind))} />
    </div>
  );
}
