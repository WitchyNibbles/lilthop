import { useEffect, useRef, useState } from "react";

/** Follows `value`, but changes at most once every `intervalMs`, always landing on the latest. */
export function useAtMostEvery<T>(value: T, intervalMs: number): T {
  const [shown, setShown] = useState(value);
  const lastChangeMs = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    if (value === shown) return undefined;
    const wait = Math.max(0, lastChangeMs.current + intervalMs - Date.now());
    const timer = setTimeout(() => {
      lastChangeMs.current = Date.now();
      setShown(value);
    }, wait);
    return () => clearTimeout(timer);
  }, [value, shown, intervalMs]);

  return shown;
}
