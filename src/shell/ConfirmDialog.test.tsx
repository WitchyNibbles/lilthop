import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

function Harness({ onConfirm }: { readonly onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} type="button">
        Open
      </button>
      {open ? (
        <ConfirmDialog
          action="Go"
          body="Sure?"
          cancel="Keep"
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            onConfirm();
            setOpen(false);
          }}
          title="Title"
        />
      ) : null}
    </>
  );
}

const open = () => {
  const opener = screen.getByRole("button", { name: "Open" });
  opener.focus();
  fireEvent.click(opener);
  return opener;
};

describe("ConfirmDialog", () => {
  it("is a named modal that starts on the safe choice", () => {
    render(<Harness onConfirm={vi.fn()} />);
    open();
    expect(screen.getByRole("dialog", { name: "Title" })).toHaveAttribute(
      "open",
    );
    expect(screen.getByRole("button", { name: "Keep" })).toHaveFocus();
  });

  it("gives focus back to what opened it", () => {
    render(<Harness onConfirm={vi.fn()} />);
    const opener = open();
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(opener).toHaveFocus();
  });

  it("keeps Tab inside, going round both ways", () => {
    render(<Harness onConfirm={vi.fn()} />);
    open();
    const keep = screen.getByRole("button", { name: "Keep" });
    const go = screen.getByRole("button", { name: "Go" });
    fireEvent.keyDown(keep, { key: "Tab", shiftKey: true });
    expect(go).toHaveFocus();
    fireEvent.keyDown(go, { key: "Tab" });
    expect(keep).toHaveFocus();
  });

  it("treats Escape as cancel", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    open();
    fireEvent(screen.getByRole("dialog"), new Event("cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
