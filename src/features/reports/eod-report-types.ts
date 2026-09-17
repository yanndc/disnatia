import type {
  PerformancePeriodResult,
  PerformanceSessionGain,
} from "@/features/portfolio/performance-indicator-types";
import type { SessionTickerView } from "@/features/portfolio/session-ticker-report-queries";

export const EOD_DAILY_PERFORMANCE_DAYS = 10;

export type EodDailyPerformanceRow = {
  date: string;
  gainCad: number;
  gainPct: number | null;
};

export function buildEodDailyPerformanceRows(
  sessions: PerformanceSessionGain[],
  daysShown = EOD_DAILY_PERFORMANCE_DAYS,
): EodDailyPerformanceRow[] {
  return [...sessions]
    .toSorted((a, b) => a.date.localeCompare(b.date))
    .slice(-daysShown)
    .map((session) => ({
      date: session.date,
      gainCad: session.gainCad,
      gainPct: session.priorCad > 0 ? (session.gainCad / session.priorCad) * 100 : null,
    }));
}

export type EodReportData = {
  sessionDate: string;
  sessionLabel: string;
  generatedAt: string;
  /** Valeur totale portefeuilles Disnat (titres + cash, CAD). */
  disnatTotalValueCad: number;
  dayPeriod: PerformancePeriodResult;
  yesterdayPeriod: PerformancePeriodResult;
  dailyPerformance: EodDailyPerformanceRow[];
  currentSession: SessionTickerView;
  previousSession: SessionTickerView;
  quoteCoverage: { matched: number; total: number };
  quotesAsOf: string | null;
  driftVsDisnatPct: number | null;
  usdToCad: number | null;
  usdToCadDate: string | null;
  appUrl: string | null;
};
