import type { ReactNode } from "react";
import { Icon } from "../art/icons";

interface SelectProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly children: ReactNode;
  readonly disabled?: boolean;
  /** Show the label above the field; otherwise it is for screen readers only. */
  readonly showLabel?: boolean;
}

export function Select(props: SelectProps) {
  const { label, value, onChange, children, disabled, showLabel } = props;
  return (
    <label className="select-field">
      <span className={showLabel === true ? "select-label" : "sr-only"}>
        {label}
      </span>
      <span className="select-box">
        <select
          disabled={disabled === true}
          onChange={(event) => onChange(event.target.value)}
          value={value}
        >
          {children}
        </select>
        <Icon name="chevron" />
      </span>
    </label>
  );
}
