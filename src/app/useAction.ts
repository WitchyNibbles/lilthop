import { useCallback, useState } from "react";
import { commandErrorMessage } from "../lib/tauri";
import { useApp } from "./appContext";

export type ActionState =
  | { readonly kind: "idle" }
  | { readonly kind: "busy" }
  | { readonly kind: "done"; readonly message: string }
  | { readonly kind: "failed"; readonly message: string };

export interface Action {
  readonly state: ActionState;
  /** Runs `work`, which resolves to the sentence to show. A rejection shows the real error. */
  readonly run: (work: () => Promise<string>) => void;
  readonly show: (state: ActionState) => void;
}

/** One button's worth of work: nothing here is allowed to finish or fail silently. */
export function useAction(): Action {
  const { t } = useApp();
  const [state, show] = useState<ActionState>({ kind: "idle" });
  const run = useCallback(
    (work: () => Promise<string>) => {
      show({ kind: "busy" });
      work()
        .then((message) => show({ kind: "done", message }))
        .catch((error: unknown) =>
          show({ kind: "failed", message: commandErrorMessage(error, t) }),
        );
    },
    [t],
  );
  return { state, run, show };
}
