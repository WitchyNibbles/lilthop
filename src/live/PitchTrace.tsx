import { useRef } from "react";
import { useAtMostEvery } from "./useAtMostEvery";
import { useTracePainter, type TraceSetup } from "./useTracePainter";

const SUMMARY_INTERVAL_MS = 2_000;

interface PitchTraceProps extends TraceSetup {
  readonly label: string;
  /** Plain words for screen readers. Never the live number. */
  readonly summary: string;
}

export function PitchTrace({ label, summary, ...setup }: PitchTraceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useTracePainter(canvasRef, setup);
  const spoken = useAtMostEvery(summary, SUMMARY_INTERVAL_MS);
  return (
    <>
      <canvas
        aria-label={label}
        className="trace-canvas"
        ref={canvasRef}
        role="img"
      />
      <p aria-live="polite" className="sr-only">
        {spoken}
      </p>
    </>
  );
}
