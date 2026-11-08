import type { ActionState } from "../app/useAction";

/** Always in the page, so a screen reader hears the result and nothing moves when it arrives. */
export function ActionResult({ state }: { readonly state: ActionState }) {
  const message =
    state.kind === "done" || state.kind === "failed" ? state.message : "";
  return (
    <p
      className="action-result"
      data-failed={state.kind === "failed"}
      role="status"
    >
      {message}
    </p>
  );
}
