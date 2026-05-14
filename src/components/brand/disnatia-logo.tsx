import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

const SRC = "/disnatia-logo.png";
const NATURAL_W = 300;
const NATURAL_H = 88;

/**
 * Logo Disnatia (PNG). Sur fond sombre, conserver `text-white` dans `className`
 * pour appliquer l’inversion (équivalent visuel à l’ancien SVG en `currentColor`).
 */
export function DisnatiaLogo({
  className,
  ...props
}: ComponentPropsWithoutRef<"img">) {
  const raw = className ?? "";
  const onDarkBg = /\btext-white\b/.test(raw);
  const cleaned = raw
    .replace(/\btext-white\b/g, " ")
    .replace(/\btext-slate-950\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return (
    <img
      src={SRC}
      width={NATURAL_W}
      height={NATURAL_H}
      alt="Disnatia"
      decoding="async"
      className={cn(
        "h-auto w-auto max-w-none object-contain object-left",
        onDarkBg && "brightness-0 invert",
        cleaned,
      )}
      {...props}
    />
  );
}
