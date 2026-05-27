export type PerformancePeriodId =
  | "day"
  | "yesterday"
  | "week"
  | "month"
  | "ytd"
  | "year"
  | "all";

export type PerformanceScopePreset = "all" | "disnat" | "external" | "custom";

export type PerformanceAccountRef = {
  accountKey: string;
  label: string;
  owner: string | null;
  accountType: string | null;
  currency: string;
  isExternal: boolean;
  provider?: string;
};

export type PerformanceSnapshotPoint = {
  accountKey: string;
  /** ISO date (YYYY-MM-DD) */
  asOf: string;
  totalValueNative: number;
  currency: string;
};

export type PerformanceAccountCurrent = {
  totalCad: number;
  positionsCad: number;
  cashCad: number;
  dayGainCad: number | null;
  dayPriorCad: number | null;
};

export type PerformanceIndicatorPayload = {
  accounts: PerformanceAccountRef[];
  currentByAccount: Record<string, PerformanceAccountCurrent>;
  snapshots: PerformanceSnapshotPoint[];
  usdToCad: number | null;
  usdToCadDate: string | null;
  availableYears: number[];
  quotesAsOf: string | null;
  asOfNow: string;
};

export type PerformancePeriodResult = {
  periodId: PerformancePeriodId;
  label: string;
  shortLabel: string;
  gainCad: number | null;
  gainPct: number | null;
  currentCad: number;
  baselineCad: number | null;
  baselineDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** live-quotes = séance en cours ; snapshot-delta = historique imports/snapshots */
  method: "live-quotes" | "snapshot-delta" | "unavailable";
  accountsIncluded: number;
  accountsWithBaseline: number;
  incomplete: boolean;
  note: string | null;
};

export type PerformanceFilterState = {
  preset: PerformanceScopePreset;
  owner: string | null;
  includedAccountKeys: string[];
  excludedAccountKeys: string[];
  selectedYear: number;
  activePeriod: PerformancePeriodId;
};
