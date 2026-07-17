import { getPortfolioSummary } from "@/features/portfolio/queries";
import { computePeriodResult } from "@/features/portfolio/performance-indicator-logic";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  buildSessionTickerViewForDate,
} from "@/features/portfolio/session-ticker-report-queries";
import {
  isoDateInToronto,
  priorReferenceSessionDateIso,
  referenceTradingSessionDay,
  resolveDayPeriodLabels,
} from "@/lib/market/equity-session";
import type { EodReportData } from "./eod-report-types";

export async function buildEodReportData(now = new Date()): Promise<EodReportData> {
  const [payload, summary] = await Promise.all([
    getPerformanceIndicatorPayload(),
    getPortfolioSummary(),
  ]);

  const filters = {
    preset: "disnat" as const,
    owner: null,
    includedAccountKeys: [] as string[],
    excludedAccountKeys: [] as string[],
    selectedYear: now.getFullYear(),
  };

  const dayPeriod = computePeriodResult(payload, filters, "day");
  const yesterdayPeriod = computePeriodResult(payload, filters, "yesterday");

  const sessionDate = isoDateInToronto(referenceTradingSessionDay(now));
  const previousSessionDate = priorReferenceSessionDateIso(now);
  const { label: sessionLabel } = resolveDayPeriodLabels(now);

  // Le rapport est toujours envoyé après la clôture : on ne veut jamais du live,
  // seulement les gains de séance persistés (session_gains), pour rester cohérent
  // avec le sujet du courriel (computeDayPeriod).
  const [currentSession, previousSession] = await Promise.all([
    buildSessionTickerViewForDate(payload, sessionDate, now, { disableLive: true }),
    buildSessionTickerViewForDate(payload, previousSessionDate, now, { disableLive: true }),
  ]);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || null;

  return {
    sessionDate,
    sessionLabel,
    generatedAt: now.toISOString(),
    disnatTotalValueCad: summary.disnatLiveTotalValue,
    dayPeriod,
    yesterdayPeriod,
    currentSession,
    previousSession,
    quoteCoverage: summary.quoteCoverage,
    quotesAsOf:
      summary.quotesAsOf instanceof Date
        ? summary.quotesAsOf.toISOString()
        : summary.quotesAsOf
          ? String(summary.quotesAsOf)
          : null,
    driftVsDisnatPct: summary.driftVsDisnatPct,
    usdToCad: payload.usdToCad,
    usdToCadDate: payload.usdToCadDate,
    appUrl,
  };
}
