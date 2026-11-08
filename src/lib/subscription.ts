/** Starts an event subscription and undoes it, even if the cleanup runs before it resolved. */
export function listenUntilCleanup(
  subscribe: () => Promise<() => void>,
  onFailure: (error: unknown) => void,
): () => void {
  let leave: (() => void) | null = null;
  let cancelled = false;
  subscribe()
    .then((unlisten) => {
      if (cancelled) unlisten();
      else leave = unlisten;
    })
    .catch(onFailure);
  return () => {
    cancelled = true;
    leave?.();
  };
}
