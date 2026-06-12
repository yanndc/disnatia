import type { PerformancePeriodResult } from "@/features/portfolio/performance-indicator-types";
import type { SessionTickerView } from "@/features/portfolio/session-ticker-report-queries";

export type EodReportData = {
  sessionDate: string;
  sessionLabel: string;
  generatedAt: string;
  /** Valeur totale portefeuilles Disnat (titres + cash, CAD). */
  disnatTotalValueCad: number;
  dayPeriod: PerformancePeriodResult;
  yesterdayPeriod: PerformancePeriodResult;
  currentSession: SessionTickerView;
  previousSession: SessionTickerView;
  quoteCoverage: { matched: number; total: number };
  quotesAsOf: string | null;
  driftVsDisnatPct: number | null;
  usdToCad: number | null;
  usdToCadDate: string | null;
  appUrl: string | null;
};
