import * as React from "react";
import { cn } from "@/lib/utils";

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-slate-400",
        className,
      )}
      {...props}
    />
  );
}
