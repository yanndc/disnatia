"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const STALE_AFTER_MS = 15 * 60 * 1000;

/**
 * Actualise les cours en arrière-plan à chaque ouverture de page dashboard
 * si la dernière MAJ date de plus de 15 minutes (même API que « Actualiser les cours »).
 */
export function BackgroundQuotesRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function maybeRefresh() {
      if (cancelled || inFlightRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

      inFlightRef.current = true;
      try {
        const res = await fetch(
          `/api/portfolio/refresh-quotes?maxAgeMinutes=${STALE_AFTER_MS / 60_000}`,
          { method: "POST" },
        );
        if (!cancelled && res.ok) {
          const payload = (await res.json()) as { skipped?: boolean };
          if (!payload.skipped) {
            router.refresh();
          }
        }
      } catch {
        /* erreur réseau : prochaine navigation */
      } finally {
        inFlightRef.current = false;
      }
    }

    void maybeRefresh();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  return null;
}
