import type { PerformanceSessionDataHealth } from "./performance-indicator-types";
import {
  isBeforeTodaySessionOpen,
  isoDateInToronto,
  referenceTradingSessionDayIso,
  yesterdayTradingSessionDay,
} from "@/lib/market/equity-session";
import { listTradingDaysInRange } from "@/lib/fx/usd-cad-rate-map";

const RECENT_GAP_CHECK_DAYS = 21;

/** Évalue la couverture des gains de séance persistés (sans fallback implicite). */
export function assessSessionDataHealth(
  sessionGainsByDate: { date: string; gainCad: number; priorCad: number }[],
  now = new Date(),
): PerformanceSessionDataHealth {
  if (sessionGainsByDate.length === 0) {
    return {
      ok: false,
      message:
        "Aucune séance persistée. Lance « Reconstruire les faits performance » avant affichage.",
      persistedDays: 0,
      firstDate: null,
      lastDate: null,
    };
  }

  const sorted = [...sessionGainsByDate].toSorted((a, b) => a.date.localeCompare(b.date));
  const firstDate = sorted[0]!.date;
  const lastDate = sorted.at(-1)!.date;

  for (const row of sorted) {
    if (!Number.isFinite(row.gainCad) || !Number.isFinite(row.priorCad)) {
      return {
        ok: false,
        message: `Données invalides (NaN) le ${row.date}. Reconstruis les faits performance.`,
        persistedDays: sorted.length,
        firstDate,
        lastDate,
      };
    }
  }

  const expectedLast = isBeforeTodaySessionOpen(now)
    ? isoDateInToronto(yesterdayTradingSessionDay(now))
    : referenceTradingSessionDayIso(now);

  if (lastDate < expectedLast) {
    return {
      ok: false,
      message: `Gains de séance en retard (dernier : ${lastDate}, attendu : ${expectedLast}).`,
      persistedDays: sorted.length,
      firstDate,
      lastDate,
    };
  }

  const recentEnd = expectedLast;
  const recentCandidates = sorted.map((r) => r.date).filter((d) => d <= recentEnd);
  const recentStart =
    recentCandidates[Math.max(0, recentCandidates.length - RECENT_GAP_CHECK_DAYS)] ??
    recentEnd;
  const expectedRecent = listTradingDaysInRange(recentStart, recentEnd);
  const have = new Set(sorted.map((r) => r.date));
  const missingRecent = expectedRecent.filter((d) => !have.has(d));

  if (missingRecent.length > 0) {
    return {
      ok: false,
      message: `${missingRecent.length} séance(s) manquante(s) récemment (ex. ${missingRecent[0]}).`,
      persistedDays: sorted.length,
      firstDate,
      lastDate,
    };
  }

  return {
    ok: true,
    message: null,
    persistedDays: sorted.length,
    firstDate,
    lastDate,
  };
}
