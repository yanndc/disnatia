export type PerformancePeriodId =
  | "day"
  | "yesterday"
  | "month"
  | "month3"
  | "year"
  | "year3"
  | "ytd"
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
  /** Valeur des titres seulement (import portefeuille Disnat), si disponible. */
  marketValueNative?: number;
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

/** Ligne titres enrichie (cours live + clôture séance précédente), calculée une fois dans le payload. */
export type PerformanceEnrichedHoldingRow = {
  accountKey: string;
  ticker: string;
  securityName: string;
  currency: string;
  quantity: number;
  quoteChangePerShare: number | null;
  displayDayGainLoss: number | null;
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

export type PerformanceSessionDataHealth = {
  ok: boolean;
  message: string | null;
  persistedDays: number;
  firstDate: string | null;
  lastDate: string | null;
};

export type PerformanceSnapshotsBundle = {
  calcVersion: number;
  sessionDate: string;
  byScopeKey: Record<string, PerformancePeriodResult[]>;
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
  /** P&L titres par compte et par séance (pour filtres propriétaire / compte). */
  sessionGainsByAccount: Record<string, PerformanceSessionGain[]>;
  /** État de fiabilité des séances persistées (aucun fallback implicite). */
  sessionDataHealth: PerformanceSessionDataHealth;
  /** Indicateurs précalculés (Phase C) — null si rebuild requis. */
  performanceSnapshots: PerformanceSnapshotsBundle | null;
  cashFlows: PerformanceCashFlow[];
  /** Soldes cash cumulés par compte (ledger transactions). */
  accountCashLedgers: Record<
    string,
    { date: string; balanceCad: number }[]
  >;
  /** Positions projetées pour calcul P&L titres par séance */
  holdings: PerformanceHoldingRow[];
  /** Positions enrichies (P&L séance déjà calculé par ligne). */
  enrichedHoldings: PerformanceEnrichedHoldingRow[];
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
  /** live-quotes | session-chain | unavailable */
  method: "live-quotes" | "session-chain" | "unavailable";
  accountsIncluded: number;
  accountsWithBaseline: number;
  incomplete: boolean;
  /** true si gainPct est un taux annualisé (périodes > ~1 an). */
  annualized: boolean;
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
