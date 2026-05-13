"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const INTERVAL_MS = 10 * 60 * 1000;

/**
 * Actualise les cours en arrière-plan tant que l’utilisateur navigue sur le dashboard
 * (même API que « Actualiser les cours », sans bouger l’UI).
 */
export function BackgroundQuotesRefresh() {
  const router = useRouter();
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (cancelled || inFlightRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

      inFlightRef.current = true;
      try {
        const res = await fetch("/api/portfolio/refresh-quotes", { method: "POST" });
        if (!cancelled && res.ok) {
          router.refresh();
        }
      } catch {
        /* erreur réseau : prochain intervalle */
      } finally {
        inFlightRef.current = false;
      }
    }

    const id = window.setInterval(() => void tick(), INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [router]);

  return null;
}
