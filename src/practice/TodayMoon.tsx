import { useEffect, useRef } from "react";
import { useApp } from "../app/appContext";
import { litPath, Moon } from "../art/Moon";
import { useTodayMoon } from "../home/useRoutine";
import { useReducedMotion } from "../live/useReducedMotion";

const FILL_MS = 1_400;

interface TodayMoonProps {
  /** Where the moon stood before this session: a fast save can land before this ever mounts. */
  readonly from: number;
}

/** The one authored moment: when a save lands, today's moon waxes to its new phase. */
export function TodayMoon({ from }: TodayMoonProps) {
  const { t } = useApp();
  const { phase, done, total } = useTodayMoon();
  const reducedMotion = useReducedMotion();
  const lit = useRef<SVGPathElement>(null);
  const shown = useRef(from);

  useEffect(() => {
    const path = lit.current;
    if (path === null) return undefined;
    const draw = (value: number) => {
      shown.current = value;
      path.setAttribute("d", litPath(value));
    };
    const start = shown.current;
    if (reducedMotion || start === phase) {
      draw(phase);
      return undefined;
    }
    let frame = 0;
    const startedAt = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / FILL_MS);
      if (progress === 1) {
        draw(phase);
        return;
      }
      draw(start + (phase - start) * (1 - (1 - progress) ** 3));
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [phase, reducedMotion]);

  return (
    <div
      className="today-moon"
      data-end={litPath(phase)}
      data-full={phase >= 1}
      data-phase={phase}
      data-testid="today-moon"
    >
      <Moon litRef={lit} phase={from} />
      {total > 0 ? <p>{t("result.moonCaption", { done, total })}</p> : null}
    </div>
  );
}
