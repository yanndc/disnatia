import type { PerformancePeriodResult } from "@/features/portfolio/performance-indicator-types";

export type EodReportPositionRow = {
  accountKey: string;
  accountLabel: string;
  ticker: string;
  securityName: string | null;
  currency: string;
  quantity: number;
  marketValueCad: number;
  dayGainCad: number | null;
  usesLiveQuote: boolean;
};

export type EodReportAccountRow = {
  accountKey: string;
  label: string;
  owner: string | null;
  isExternal: boolean;
  totalCad: number;
  positionsCad: number;
  cashCad: number;
  dayGainCad: number | null;
};

export type EodReportData = {
  sessionDate: string;
  sessionLabel: string;
  generatedAt: string;
  totalValueCad: number;
  dayPeriod: PerformancePeriodResult;
  yesterdayPeriod: PerformancePeriodResult;
  accounts: EodReportAccountRow[];
  positions: EodReportPositionRow[];
  quoteCoverage: { matched: number; total: number };
  quotesAsOf: string | null;
  driftVsDisnatPct: number | null;
  usdToCad: number | null;
  usdToCadDate: string | null;
  appUrl: string | null;
};
