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

export type PerformanceCashFlow = {
  accountKey: string;
  /** ISO date (YYYY-MM-DD) */
  tradeDate: string;
  txCategory:
    | "CONTRIBUTION"
    | "TRANSFER_IN"
    | "TRANSFER_OUT"
    | "INTERNAL_TRANSFER";
  amountCad: number;
};

export type PerformanceHoldingRow = {
  accountKey: string;
  ticker: string;
  currency: string;
  quantity: number;
};

export type PerformanceDailyTotalCad = {
  date: string;
  totalCad: number;
};

/** P&L titres d'une séance (Σ qty × Δ clôture), en CAD. */
export type PerformanceSessionGain = {
  date: string;
  gainCad: number;
  priorCad: number;
};

export type PerformanceIndicatorPayload = {
  accounts: PerformanceAccountRef[];
  currentByAccount: Record<string, PerformanceAccountCurrent>;
  snapshots: PerformanceSnapshotPoint[];
  /** Valeurs titres projetées par compte et par jour (holdings × clôtures). */
  historyPoints: PerformanceSnapshotPoint[];
  /** Valeurs titres agrégées en CAD par jour (portfolio_daily_values). */
  dailyTotalsCad: PerformanceDailyTotalCad[];
  /** P&L titres par séance boursière (holdings journaliers × clôtures). */
  sessionGainsByDate: PerformanceSessionGain[];
  cashFlows: PerformanceCashFlow[];
  /** Positions projetées pour calcul P&L titres par séance */
  holdings: PerformanceHoldingRow[];
  /** Clé ticker|currency|date → clôture */
  dailyCloses: Record<string, number>;
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
  /** live-quotes | session-closes | session-chain | holdings-history | snapshot-delta | unavailable */
  method: "live-quotes" | "session-closes" | "session-chain" | "holdings-history" | "snapshot-delta" | "unavailable";
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
