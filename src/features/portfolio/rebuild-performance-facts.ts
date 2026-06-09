import { prisma } from "@/lib/db/prisma";
import { refreshUsdCadRatesIfStale } from "@/lib/fx/refresh-usd-cad-rates";
import { isoDateFromDbDate } from "./daily-close-key";
import {
  backfillMarketHistory,
  ensureDailyHoldingsUpToDate,
} from "./backfill-market-history";
import { assessSessionDataHealth } from "./performance-facts-health";
import { recomputeAndPersistSessionGains } from "./performance-session-gains";
import type { PerformanceSessionDataHealth } from "./performance-indicator-types";
import { referenceTradingSessionDayIso } from "@/lib/market/equity-session";

export type RebuildPerformanceFactsResult = {
  ok: boolean;
  fromDate: string;
  toDate: string;
  fxRefreshed: boolean;
  holdingsProjected: boolean;
  pricesUpserted: number;
  sessionGainsRows: number;
  missingFxDates: string[];
  health: PerformanceSessionDataHealth;
  messages: string[];
};

/**
 * Reconstruit la couche de faits performance (holdings → clôtures → session_gains)
 * de façon idempotente. Point d'entrée unique pour un historique fiable.
 */
export async function rebuildPerformanceFacts(options?: {
  now?: Date;
  forcePrices?: boolean;
}): Promise<RebuildPerformanceFactsResult> {
  const now = options?.now ?? new Date();
  const messages: string[] = [];
  const toDate = referenceTradingSessionDayIso(now);

  await refreshUsdCadRatesIfStale();
  messages.push("Taux USD→CAD BoC vérifiés.");

  const holdings = await ensureDailyHoldingsUpToDate(now);
  if (holdings.projected) {
    messages.push(
      holdings.reason === "empty"
        ? "Holdings journaliers projetés depuis les transactions."
        : "Holdings journaliers realignés sur la séance courante.",
    );
  }

  const earliestHolding = await prisma.portfolioDailyHolding.findFirst({
    orderBy: { holdingDate: "asc" },
    select: { holdingDate: true },
  });
  const fromDate = earliestHolding
    ? isoDateFromDbDate(earliestHolding.holdingDate)
    : toDate;

  const backfill = await backfillMarketHistory({
    force: options?.forcePrices ?? false,
    recomputeDailyValues: true,
    recomputeSessionGains: false,
    ensureDailyHoldings: false,
  });
  messages.push(backfill.message ?? "Clôtures mises à jour.");

  const disnatAccountKeys = (
    await prisma.portfolioAccountState.findMany({ select: { accountKey: true } })
  ).map((row) => row.accountKey);

  let sessionGainsRows = 0;
  let missingFxDates: string[] = [];
  if (disnatAccountKeys.length > 0) {
    const wrote = await recomputeAndPersistSessionGains(
      disnatAccountKeys,
      fromDate,
      toDate,
    );
    sessionGainsRows = wrote.rowsWritten;
    missingFxDates = wrote.missingFxDates;
    if (missingFxDates.length > 0) {
      messages.push(
        `${missingFxDates.length} date(s) sans taux FX pour conversion USD (ex. ${missingFxDates[0]}).`,
      );
    }
  }

  const sessionRows = await prisma.portfolioDailyAccountSessionGain.findMany({
    where: { accountKey: { in: disnatAccountKeys } },
    select: { sessionDate: true, gainNative: true, priorNative: true },
    orderBy: { sessionDate: "asc" },
  });

  const byDate = new Map<string, { gainCad: number; priorCad: number }>();
  for (const row of sessionRows) {
    const date = isoDateFromDbDate(row.sessionDate);
    const bucket = byDate.get(date) ?? { gainCad: 0, priorCad: 0 };
    bucket.gainCad += row.gainNative;
    bucket.priorCad += row.priorNative;
    byDate.set(date, bucket);
  }
  const sessionGainsByDate = [...byDate.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .toSorted((a, b) => a.date.localeCompare(b.date));

  const health = assessSessionDataHealth(sessionGainsByDate, now);
  const ok = health.ok && missingFxDates.length === 0;

  return {
    ok,
    fromDate,
    toDate,
    fxRefreshed: true,
    holdingsProjected: holdings.projected,
    pricesUpserted: backfill.pricesUpserted,
    sessionGainsRows,
    missingFxDates,
    health,
    messages,
  };
}
