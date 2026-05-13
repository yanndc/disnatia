import * as React from "react";
import { cn } from "@/lib/utils";

export type SwitchProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "role"
> & {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
};

/** Interrupteur visuel (sans lib tiers) — proportions type iOS / shadcn. */
export function Switch({
  className,
  checked,
  onCheckedChange,
  disabled,
  id,
  "aria-labelledby": ariaLabelledby,
  "aria-label": ariaLabel,
  ...rest
}: SwitchProps) {
  return (
    <button
      {...rest}
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-labelledby={ariaLabelledby}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onCheckedChange(!checked);
      }}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 rounded-full p-0.5",
        "transition-[background-color] duration-200 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
        "disabled:cursor-not-allowed disabled:opacity-45",
        checked
          ? "bg-slate-900 shadow-[inset_0_1px_2px_rgba(0,0,0,0.2)]"
          : "bg-slate-200 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-0.5 left-0.5 block size-5 rounded-full bg-white",
          "shadow-[0_1px_3px_rgba(0,0,0,0.14),0_1px_1px_rgba(0,0,0,0.06)]",
          "ring-1 ring-slate-900/10",
          "transition-transform duration-200 ease-[cubic-bezier(0.34,1.36,0.64,1)] will-change-transform",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}
