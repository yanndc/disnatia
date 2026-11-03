import type {
  PerformancePeriodResult,
  PerformanceSessionGain,
} from "@/features/portfolio/performance-indicator-types";
import type { SessionTickerView } from "@/features/portfolio/session-ticker-report-queries";

export const EOD_DAILY_PERFORMANCE_DAYS = 20;

export type EodDailyPerformanceRow = {
  date: string;
  gainCad: number;
  gainPct: number | null;
};

/** Cumul sur la fenêtre affichée (somme des gains + rendement composé). */
export type EodDailyPerformanceTotal = {
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

export function summarizeEodDailyPerformance(
  rows: EodDailyPerformanceRow[],
): EodDailyPerformanceTotal {
  if (rows.length === 0) {
    return { gainCad: 0, gainPct: null };
  }
  const gainCad = rows.reduce((sum, row) => sum + row.gainCad, 0);
  const factor = rows.reduce(
    (acc, row) => (row.gainPct === null ? acc : acc * (1 + row.gainPct / 100)),
    1,
  );
  return { gainCad, gainPct: (factor - 1) * 100 };
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
  /** Analyse IA (Pinocchio) de la séance; null si non générée (clé absente ou échec). */
  pinocchioAnalysis: string | null;
};
