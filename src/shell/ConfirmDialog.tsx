import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { focusHeading } from "./focusHeading";

interface ConfirmDialogProps {
  readonly title: string;
  readonly body: string;
  readonly action: string;
  readonly cancel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Tab would otherwise step out to the browser between the last button and the first. */
function keepTabInside(event: ReactKeyboardEvent<HTMLDialogElement>): void {
  if (event.key !== "Tab") return;
  const buttons = event.currentTarget.querySelectorAll("button");
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  const edge = event.shiftKey ? first : last;
  if (document.activeElement !== edge) return;
  event.preventDefault();
  (event.shiftKey ? last : first)?.focus();
}

/** A native modal, so the page behind is inert. Focus goes back to the opener on close. */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { title, body, action, cancel, onConfirm, onCancel } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const safeChoice = useRef<HTMLButtonElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();

  useEffect(() => {
    // Kept across strict mode's second run, when focus is already inside the dialog.
    opener.current ??= document.activeElement;
    dialog.current?.showModal();
    safeChoice.current?.focus();
    return () => {
      const element = opener.current;
      if (element instanceof HTMLElement && element.isConnected)
        element.focus();
      else focusHeading();
    };
  }, []);

  return (
    <dialog
      aria-labelledby={titleId}
      className="confirm"
      onKeyDown={keepTabInside}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      ref={dialog}
    >
      <h2 id={titleId}>{title}</h2>
      <p>{body}</p>
      <div className="confirm-actions">
        <button
          className="btn"
          onClick={onCancel}
          ref={safeChoice}
          type="button"
        >
          {cancel}
        </button>
        <button className="btn" onClick={onConfirm} type="button">
          {action}
        </button>
      </div>
    </dialog>
  );
}
