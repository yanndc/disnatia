"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { isEquityMarketSessionOpen } from "@/lib/market/equity-session";

/** Hors séance : seuil demandé à l’ouverture de page. */
const STALE_AFTER_MS = 15 * 60 * 1000;
/** En séance ouverte : cours plus frais pour rapprocher Disnat. */
const STALE_DURING_SESSION_MS = 2 * 60 * 1000;
const POLL_DURING_SESSION_MS = 2 * 60 * 1000;
const POLL_DEFAULT_MS = 15 * 60 * 1000;

function staleThresholdMs(now = Date.now()): number {
  return isEquityMarketSessionOpen(new Date(now))
    ? STALE_DURING_SESSION_MS
    : STALE_AFTER_MS;
}

function pollIntervalMs(now = Date.now()): number {
  return isEquityMarketSessionOpen(new Date(now))
    ? POLL_DURING_SESSION_MS
    : POLL_DEFAULT_MS;
}

/**
 * Actualise les cours + recharge les pages dashboard :
 * - à chaque navigation (si cours périmés)
 * - toutes les 2 min en séance ouverte (sinon 15 min)
 * - au retour sur l’onglet
 */
export function BackgroundQuotesRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const inFlightRef = useRef(false);

  const maybeRefresh = useCallback(async () => {
    if (inFlightRef.current) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return;
    }

    inFlightRef.current = true;
    try {
      const maxAgeMinutes = staleThresholdMs() / 60_000;
      const res = await fetch(
        `/api/portfolio/refresh-quotes?maxAgeMinutes=${maxAgeMinutes}`,
        { method: "POST" },
      );
      if (res.ok) {
        const payload = (await res.json()) as { skipped?: boolean };
        if (!payload.skipped) {
          router.refresh();
        }
      }
    } catch {
      /* prochain cycle */
    } finally {
      inFlightRef.current = false;
    }
  }, [router]);

  useEffect(() => {
    void maybeRefresh();
  }, [pathname, maybeRefresh]);

  useEffect(() => {
    function schedulePoll() {
      return window.setInterval(() => {
        void maybeRefresh();
      }, pollIntervalMs());
    }

    let pollId = schedulePoll();
    const realignId = window.setInterval(() => {
      window.clearInterval(pollId);
      pollId = schedulePoll();
    }, 60_000);

    function onVisibility() {
      if (document.visibilityState === "visible") {
        void maybeRefresh();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(pollId);
      window.clearInterval(realignId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [maybeRefresh]);

  return null;
}
