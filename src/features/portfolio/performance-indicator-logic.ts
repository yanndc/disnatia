import {
  endOfYear,
  format,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
} from "date-fns";
import { frCA } from "date-fns/locale";
import type {
  PerformanceAccountRef,
  PerformanceFilterState,
  PerformanceIndicatorPayload,
  PerformancePeriodId,
  PerformancePeriodResult,
  PerformanceScopePreset,
  PerformanceSnapshotPoint,
} from "./performance-indicator-types";
import {
  previousTradingDay,
  resolveDayPeriodLabels,
  yesterdayTradingSessionDay,
} from "@/lib/market/equity-session";
import { portfolioOwnersMatch } from "@/lib/portfolio/sanitize-portfolio-owner";
import {
  formatFlowAdjustmentNote,
  netExternalFlowsCad,
} from "./performance-cash-flows";
import { dailyCloseKey } from "./daily-close-key";

const PERIOD_META: Record<
  Exclude<PerformancePeriodId, "day">,
  { label: string; shortLabel: string }
> = {
  yesterday: { label: "Hier", shortLabel: "Hier" },
  week: { label: "Cette semaine", shortLabel: "Sem." },
  month: { label: "Ce mois", shortLabel: "Mois" },
  ytd: { label: "Année à ce jour", shortLabel: "AAJ" },
  year: { label: "Par année", shortLabel: "Année" },
  all: { label: "Depuis le début", shortLabel: "Total" },
};

export function resolvePeriodMeta(
  periodId: PerformancePeriodId,
  asOfNow?: string,
): { label: string; shortLabel: string } {
  if (periodId === "day") {
    const now = asOfNow ? parseIsoDate(asOfNow) : new Date();
    return resolveDayPeriodLabels(now);
  }
  return PERIOD_META[periodId];
}

function isoDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

/** Horloge réelle pour les bornes de séance (évite minuit sur asOfNow). */
function sessionClockForBounds(): Date {
  return new Date();
}

function toCad(value: number, currency: string, usdToCad: number | null): number {
  const cur = currency.trim().toUpperCase();
  if (cur === "USD" || cur === "US") {
    return usdToCad !== null ? value * usdToCad : value;
  }
  return value;
}

export function resolveActiveAccountKeys(
  accounts: PerformanceAccountRef[],
  preset: PerformanceScopePreset,
  includedAccountKeys: string[],
  excludedAccountKeys: string[],
  owner: string | null,
): string[] {
  let keys = accounts.map((a) => a.accountKey);

  if (owner) {
    keys = keys.filter((k) => {
      const acc = accounts.find((a) => a.accountKey === k);
      return portfolioOwnersMatch(acc?.owner, owner);
    });
  }

  if (preset === "disnat") {
    keys = keys.filter((k) => !k.startsWith("ext:"));
  } else if (preset === "external") {
    keys = keys.filter((k) => k.startsWith("ext:"));
  } else if (preset === "custom" && includedAccountKeys.length > 0) {
    const includeSet = new Set(includedAccountKeys);
    keys = keys.filter((k) => includeSet.has(k));
  }

  if (excludedAccountKeys.length > 0) {
    const excludeSet = new Set(excludedAccountKeys);
    keys = keys.filter((k) => !excludeSet.has(k));
  }

  return keys;
}

function snapshotValueAtDate(
  accountKey: string,
  targetDate: string,
  snapshots: PerformanceSnapshotPoint[],
  usdToCad: number | null,
): { valueCad: number; asOf: string } | null {
  const rows = snapshots
    .filter((s) => s.accountKey === accountKey && s.asOf <= targetDate)
    .toSorted((a, b) => b.asOf.localeCompare(a.asOf));
  const hit = rows[0];
  if (!hit) return null;
  return {
    valueCad: toCad(hit.totalValueNative, hit.currency, usdToCad),
    asOf: hit.asOf,
  };
}

function portfolioValueAtDate(
  accountKey: string,
  targetDate: string,
  payload: PerformanceIndicatorPayload,
): { valueCad: number; asOf: string; fromHistory: boolean } | null {
  const history = snapshotValueAtDate(
    accountKey,
    targetDate,
    payload.historyPoints ?? [],
    payload.usdToCad,
  );
  const snap = snapshotValueAtDate(
    accountKey,
    targetDate,
    payload.snapshots,
    payload.usdToCad,
  );
  if (history && snap) {
    if (history.asOf >= snap.asOf) {
      return { ...history, fromHistory: true };
    }
    return { ...snap, fromHistory: false };
  }
  if (history) return { ...history, fromHistory: true };
  if (snap) return { ...snap, fromHistory: false };
  return null;
}

/** Vrai si baseline et fin résolvent au même snapshot (delta = 0 trompeur). */
function snapshotsDegenerateForPeriod(
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
  bounds: { baselineLookup: string | null; end: string },
): boolean {
  if (!bounds.baselineLookup) return true;
  let withBoth = 0;
  let sameDate = 0;
  for (const key of accountKeys) {
    const base = portfolioValueAtDate(key, bounds.baselineLookup, payload);
    const end = portfolioValueAtDate(key, bounds.end, payload);
    if (!base || !end) continue;
    withBoth++;
    if (base.asOf === end.asOf) sameDate++;
  }
  return withBoth > 0 && sameDate === withBoth;
}

function closePriceAtDate(
  ticker: string,
  currency: string,
  date: string,
  dailyCloses: Record<string, number>,
): number | null {
  const key = dailyCloseKey(ticker, currency, date);
  const value = dailyCloses[key];
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

/** Séance précédente avec clôture connue (gère jours fériés boursiers). */
function priorCloseDateForTicker(
  sessionEnd: string,
  ticker: string,
  currency: string,
  dailyCloses: Record<string, number>,
  maxSteps = 8,
): string | null {
  let cursor = parseIsoDate(sessionEnd);
  for (let i = 0; i < maxSteps; i++) {
    cursor = previousTradingDay(cursor, 1);
    const iso = isoDate(cursor);
    if (closePriceAtDate(ticker, currency, iso, dailyCloses) !== null) {
      return iso;
    }
  }
  return null;
}

function computeYesterdayFromSessionCloses(
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
  bounds: {
    start: string | null;
    end: string;
    baselineLookup: string | null;
  },
): Omit<PerformancePeriodResult, "periodId" | "label" | "shortLabel"> & {
  usable: boolean;
} {
  if (!bounds.baselineLookup || !bounds.start) {
    return {
      usable: false,
      gainCad: null,
      gainPct: null,
      currentCad: 0,
      baselineCad: null,
      baselineDate: bounds.baselineLookup,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      method: "unavailable",
      accountsIncluded: accountKeys.length,
      accountsWithBaseline: 0,
      incomplete: true,
      note: null,
    };
  }

  const disnatKeys = accountKeys.filter((k) => {
    const acc = payload.accounts.find((a) => a.accountKey === k);
    return acc && !acc.isExternal;
  });

  if (disnatKeys.length === 0) {
    return {
      usable: false,
      gainCad: null,
      gainPct: null,
      currentCad: accountKeys.reduce(
        (s, k) => s + (payload.currentByAccount[k]?.totalCad ?? 0),
        0,
      ),
      baselineCad: null,
      baselineDate: bounds.baselineLookup,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      method: "unavailable",
      accountsIncluded: accountKeys.length,
      accountsWithBaseline: 0,
      incomplete: true,
      note: "P&L jour disponible uniquement sur les titres Disnat avec cotation.",
    };
  }

  let gain = 0;
  let prior = 0;
  let hasGain = false;
  let hasPrior = false;
  let pricedLines = 0;
  let incomplete = false;
  const coveredKeys = new Set<string>();

  for (const key of disnatKeys) {
    const rows = payload.holdings.filter(
      (h) => h.accountKey === key && h.quantity > 0,
    );
    if (rows.length === 0) continue;

    const acc = payload.accounts.find((a) => a.accountKey === key);
    if (!acc) continue;

    let accountGain = 0;
    let accountPrior = 0;
    let accountPriced = 0;

    for (const row of rows) {
      const endClose = closePriceAtDate(
        row.ticker,
        row.currency,
        bounds.end,
        payload.dailyCloses,
      );
      const baseDate =
        priorCloseDateForTicker(
          bounds.end,
          row.ticker,
          row.currency,
          payload.dailyCloses,
        ) ?? bounds.baselineLookup;
      const baseClose =
        baseDate != null
          ? closePriceAtDate(
              row.ticker,
              row.currency,
              baseDate,
              payload.dailyCloses,
            )
          : null;
      if (endClose === null || baseClose === null) {
        incomplete = true;
        continue;
      }
      accountPriced++;
      accountGain += row.quantity * (endClose - baseClose);
      accountPrior += row.quantity * baseClose;
    }

    if (accountPriced === 0) continue;
    coveredKeys.add(key);
    pricedLines += accountPriced;
    hasGain = true;
    gain += toCad(accountGain, acc.currency, payload.usdToCad);
    if (accountPrior > 0) {
      hasPrior = true;
      prior += toCad(accountPrior, acc.currency, payload.usdToCad);
    }
  }

  const currentCad = accountKeys.reduce(
    (s, k) => s + (payload.currentByAccount[k]?.totalCad ?? 0),
    0,
  );

  if (!hasGain || pricedLines === 0) {
    return {
      usable: false,
      gainCad: null,
      gainPct: null,
      currentCad,
      baselineCad: hasPrior ? prior : null,
      baselineDate: bounds.baselineLookup,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      method: "unavailable",
      accountsIncluded: accountKeys.length,
      accountsWithBaseline: 0,
      incomplete: true,
      note: "Clôtures de séance indisponibles pour calculer le P&L d'hier.",
    };
  }

  const flowAdjustmentCad = netExternalFlowsCad(
    payload.cashFlows ?? [],
    [...coveredKeys],
    bounds.start,
    bounds.end,
  );
  const gainCad = gain - flowAdjustmentCad;
  const flowNote = formatFlowAdjustmentNote(flowAdjustmentCad);

  return {
    usable: true,
    gainCad,
    gainPct: hasPrior && prior > 0 ? (gainCad / prior) * 100 : null,
    currentCad,
    baselineCad: hasPrior ? prior : null,
    baselineDate: bounds.baselineLookup,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    method: "session-closes",
    accountsIncluded: accountKeys.length,
    accountsWithBaseline: coveredKeys.size,
    incomplete,
    note: joinNotes(
      incomplete ? "P&L partiel : clôture absente sur au moins une ligne titre." : null,
      flowNote,
    ),
  };
}

export function resolvePeriodBounds(
  periodId: PerformancePeriodId,
  now: Date,
  selectedYear: number,
  earliestSnapshotDate: string | null,
): { start: string | null; end: string; baselineLookup: string | null } {
  const end = isoDate(now);

  switch (periodId) {
    case "day":
      return { start: end, end, baselineLookup: null };
    case "yesterday": {
      const sessionEnd = yesterdayTradingSessionDay(now);
      const sessionEndIso = isoDate(sessionEnd);
      const baseline = isoDate(previousTradingDay(sessionEnd, 1));
      return { start: sessionEndIso, end: sessionEndIso, baselineLookup: baseline };
    }
    case "week": {
      const start = isoDate(
        startOfWeek(now, { weekStartsOn: 1, locale: frCA }),
      );
      const baseline = isoDate(subDays(parseIsoDate(start), 1));
      return { start, end, baselineLookup: baseline };
    }
    case "month": {
      const start = isoDate(startOfMonth(now));
      const baseline = isoDate(subDays(parseIsoDate(start), 1));
      return { start, end, baselineLookup: baseline };
    }
    case "ytd": {
      const start = isoDate(startOfYear(now));
      const baseline = isoDate(subDays(parseIsoDate(start), 1));
      return { start, end, baselineLookup: baseline };
    }
    case "year": {
      const yearStart = startOfYear(new Date(selectedYear, 0, 1));
      const start = isoDate(yearStart);
      const yearEndDate =
        selectedYear < now.getFullYear()
          ? endOfYear(yearStart)
          : now;
      const periodEnd = isoDate(yearEndDate);
      const baseline = isoDate(subDays(yearStart, 1));
      return { start, end: periodEnd, baselineLookup: baseline };
    }
    case "all":
      return {
        start: earliestSnapshotDate,
        end,
        baselineLookup: earliestSnapshotDate
          ? isoDate(subDays(parseIsoDate(earliestSnapshotDate), 1))
          : null,
      };
  }
}

function earliestHistoryAmong(
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
): string | null {
  const dates = [
    ...(payload.historyPoints ?? [])
      .filter((s) => accountKeys.includes(s.accountKey))
      .map((s) => s.asOf),
    ...payload.snapshots
      .filter((s) => accountKeys.includes(s.accountKey))
      .map((s) => s.asOf),
  ];
  if (dates.length === 0) return null;
  return dates.toSorted()[0] ?? null;
}

function computeDayPeriod(
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
): Omit<PerformancePeriodResult, "periodId" | "label" | "shortLabel"> {
  let gain = 0;
  let prior = 0;
  let hasGain = false;
  let hasPrior = false;
  let incomplete = false;
  let currentCad = 0;
  let disnatWithTitres = 0;
  let disnatWithDay = 0;

  for (const key of accountKeys) {
    const cur = payload.currentByAccount[key];
    if (!cur) continue;
    currentCad += cur.totalCad;

    const acc = payload.accounts.find((a) => a.accountKey === key);
    if (acc?.isExternal) continue;

    if (cur.dayGainCad !== null) {
      hasGain = true;
      gain += cur.dayGainCad;
      disnatWithDay++;
    } else if (cur.positionsCad > 0) {
      incomplete = true;
    }
    if (cur.positionsCad > 0) disnatWithTitres++;
    if (cur.dayPriorCad !== null && cur.dayPriorCad > 0) {
      hasPrior = true;
      prior += cur.dayPriorCad;
    }
  }

  const onlyExternal =
    accountKeys.length > 0 &&
    accountKeys.every((k) => payload.accounts.find((a) => a.accountKey === k)?.isExternal);

  if (onlyExternal) {
    return {
      gainCad: null,
      gainPct: null,
      currentCad,
      baselineCad: null,
      baselineDate: null,
      periodStart: payload.asOfNow,
      periodEnd: payload.asOfNow,
      method: "unavailable",
      accountsIncluded: accountKeys.length,
      accountsWithBaseline: 0,
      incomplete: true,
      note: "P&L jour disponible uniquement sur les titres Disnat avec cotation.",
    };
  }

  if (disnatWithTitres > 0 && disnatWithDay === 0) {
    return {
      gainCad: null,
      gainPct: null,
      currentCad,
      baselineCad: hasPrior ? prior : null,
      baselineDate: null,
      periodStart: payload.asOfNow,
      periodEnd: payload.asOfNow,
      method: "unavailable",
      accountsIncluded: accountKeys.length,
      accountsWithBaseline: 0,
      incomplete: true,
      note: "Cotation du jour indisponible pour calculer le P&L.",
    };
  }

  return {
    gainCad: hasGain ? gain : null,
    gainPct: hasGain && hasPrior && prior > 0 ? (gain / prior) * 100 : null,
    currentCad,
    baselineCad: hasPrior ? prior : null,
    baselineDate: null,
    periodStart: payload.asOfNow,
    periodEnd: payload.asOfNow,
    method: "live-quotes",
    accountsIncluded: accountKeys.length,
    accountsWithBaseline: disnatWithDay,
    incomplete,
    note: incomplete
      ? "P&L partiel : cotation absente sur au moins une ligne titre."
      : null,
  };
}

function joinNotes(...parts: (string | null | undefined)[]): string | null {
  const merged = parts.filter((p): p is string => Boolean(p));
  return merged.length > 0 ? merged.join(" ") : null;
}

function computeAdjustedSnapshotGain(
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
  bounds: {
    start: string | null;
    end: string;
    baselineLookup: string | null;
  },
  options: {
    /** Si true, la valeur de fin vient d'un snapshot (ex. hier) plutôt que du live. */
    endFromSnapshot?: boolean;
  } = {},
): {
  currentCad: number;
  baselineCad: number;
  withBaseline: number;
  withEnd: number;
  latestBaselineDate: string | null;
  gainCad: number | null;
  gainPct: number | null;
  flowAdjustmentCad: number;
  incomplete: boolean;
  note: string | null;
  usedHistory: boolean;
} {
  const endFromSnapshot = options.endFromSnapshot ?? false;
  let currentCad = 0;
  let baselineCad = 0;
  let withBaseline = 0;
  let withEnd = 0;
  let latestBaselineDate: string | null = null;
  const coveredKeys: string[] = [];

  let withHistory = 0;

  for (const key of accountKeys) {
    const baseSnap =
      bounds.baselineLookup
        ? portfolioValueAtDate(key, bounds.baselineLookup, payload)
        : null;
    if (!baseSnap) continue;

    let endValueCad: number | null = null;
    let endFromHistory = false;
    if (endFromSnapshot && bounds.end) {
      const endSnap = portfolioValueAtDate(key, bounds.end, payload);
      if (endSnap) {
        endValueCad = endSnap.valueCad;
        endFromHistory = endSnap.fromHistory;
        withEnd++;
      }
    } else {
      const acc = payload.accounts.find((a) => a.accountKey === key);
      const cur = payload.currentByAccount[key];
      if (acc?.isExternal) {
        endValueCad = cur?.totalCad ?? null;
      } else {
        endValueCad = cur?.positionsCad ?? cur?.totalCad ?? null;
      }
      if (endValueCad !== null) withEnd++;
    }

    if (endValueCad === null) continue;

    coveredKeys.push(key);
    baselineCad += baseSnap.valueCad;
    currentCad += endValueCad;
    withBaseline++;
    if (baseSnap.fromHistory) withHistory++;
    if (endFromHistory) withHistory++;
    if (!latestBaselineDate || baseSnap.asOf > latestBaselineDate) {
      latestBaselineDate = baseSnap.asOf;
    }
  }

  const incomplete =
    withBaseline < accountKeys.length || withEnd < accountKeys.length;

  if (withBaseline === 0 || withEnd === 0 || !bounds.start) {
    return {
      currentCad,
      baselineCad,
      withBaseline,
      withEnd,
      latestBaselineDate,
      gainCad: null,
      gainPct: null,
      flowAdjustmentCad: 0,
      incomplete: true,
      note: null,
      usedHistory: false,
    };
  }

  const flowAdjustmentCad = netExternalFlowsCad(
    payload.cashFlows ?? [],
    coveredKeys,
    bounds.start,
    bounds.end,
  );
  const rawGain = currentCad - baselineCad;
  const gainCad = rawGain - flowAdjustmentCad;
  const gainPct = baselineCad > 0 ? (gainCad / baselineCad) * 100 : null;

  const partialNote = incomplete
    ? `Baseline partielle (${withBaseline}/${accountKeys.length} comptes avec référence).`
    : null;
  const flowNote = formatFlowAdjustmentNote(flowAdjustmentCad);

  return {
    currentCad,
    baselineCad,
    withBaseline,
    withEnd,
    latestBaselineDate,
    gainCad,
    gainPct,
    flowAdjustmentCad,
    incomplete,
    note: joinNotes(partialNote, flowNote),
    usedHistory: withHistory > 0,
  };
}

function computeYesterdayPeriod(
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
): PerformancePeriodResult {
  const meta = resolvePeriodMeta("yesterday", payload.asOfNow);
  const now = sessionClockForBounds();
  const bounds = resolvePeriodBounds("yesterday", now, now.getFullYear(), null);

  const fromCloses = computeYesterdayFromSessionCloses(
    accountKeys,
    payload,
    bounds,
  );
  if (fromCloses.usable) {
    const { usable: _u, ...result } = fromCloses;
    return {
      periodId: "yesterday",
      label: meta.label,
      shortLabel: meta.shortLabel,
      ...result,
    };
  }

  const degenerate = snapshotsDegenerateForPeriod(accountKeys, payload, bounds);
  const calc = computeAdjustedSnapshotGain(accountKeys, payload, bounds, {
    endFromSnapshot: true,
  });

  if (calc.withEnd === 0 || calc.withBaseline === 0 || degenerate) {
    return {
      periodId: "yesterday",
      label: meta.label,
      shortLabel: meta.shortLabel,
      gainCad: null,
      gainPct: null,
      currentCad: calc.currentCad,
      baselineCad: calc.withBaseline > 0 ? calc.baselineCad : null,
      baselineDate: calc.latestBaselineDate,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      method: "unavailable",
      accountsIncluded: accountKeys.length,
      accountsWithBaseline: calc.withBaseline,
      incomplete: true,
      note:
        fromCloses.note ??
        "Snapshot introuvable pour la séance d'hier — importe un fichier portefeuille daté ou saisis une valeur externe.",
    };
  }

  return {
    periodId: "yesterday",
    label: meta.label,
    shortLabel: meta.shortLabel,
    gainCad: calc.gainCad,
    gainPct: calc.gainPct,
    currentCad: calc.currentCad,
    baselineCad: calc.baselineCad,
    baselineDate: calc.latestBaselineDate,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    method: "snapshot-delta",
    accountsIncluded: accountKeys.length,
    accountsWithBaseline: calc.withBaseline,
    incomplete: calc.incomplete,
    note: calc.note,
  };
}

function computeSnapshotPeriod(
  periodId: PerformancePeriodId,
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
  selectedYear: number,
): PerformancePeriodResult {
  const meta = resolvePeriodMeta(periodId, payload.asOfNow);
  const now = sessionClockForBounds();
  const earliest = earliestHistoryAmong(accountKeys, payload);
  const bounds = resolvePeriodBounds(periodId, now, selectedYear, earliest);

  if (!bounds.baselineLookup || !bounds.start) {
    return {
      periodId,
      label: meta.label,
      shortLabel: meta.shortLabel,
      gainCad: null,
      gainPct: null,
      currentCad: accountKeys.reduce(
        (s, k) => s + (payload.currentByAccount[k]?.totalCad ?? 0),
        0,
      ),
      baselineCad: null,
      baselineDate: null,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      method: "unavailable",
      accountsIncluded: accountKeys.length,
      accountsWithBaseline: 0,
      incomplete: true,
      note: "Aucun historique pour cette portée — lance le backfill historique de marché.",
    };
  }

  const calc = computeAdjustedSnapshotGain(accountKeys, payload, {
    start: bounds.start,
    end: bounds.end,
    baselineLookup: bounds.baselineLookup,
  });

  if (calc.withBaseline === 0) {
    return {
      periodId,
      label: meta.label,
      shortLabel: meta.shortLabel,
      gainCad: null,
      gainPct: null,
      currentCad: calc.currentCad,
      baselineCad: null,
      baselineDate: null,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      method: "unavailable",
      accountsIncluded: accountKeys.length,
      accountsWithBaseline: 0,
      incomplete: true,
      note:
        periodId === "all"
          ? "Lance le backfill historique de marché ou importe des snapshots portefeuille."
          : "Historique de départ introuvable — lance le backfill historique de marché.",
    };
  }

  return {
    periodId,
    label: meta.label,
    shortLabel: meta.shortLabel,
    gainCad: calc.gainCad,
    gainPct: calc.gainPct,
    currentCad: calc.currentCad,
    baselineCad: calc.baselineCad,
    baselineDate: calc.latestBaselineDate,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    method: calc.usedHistory ? "holdings-history" : "snapshot-delta",
    accountsIncluded: accountKeys.length,
    accountsWithBaseline: calc.withBaseline,
    incomplete: calc.incomplete,
    note: calc.note,
  };
}

export function computePeriodResult(
  payload: PerformanceIndicatorPayload,
  filters: Pick<
    PerformanceFilterState,
    | "preset"
    | "owner"
    | "includedAccountKeys"
    | "excludedAccountKeys"
    | "selectedYear"
  >,
  periodId: PerformancePeriodId,
): PerformancePeriodResult {
  const meta = resolvePeriodMeta(periodId, payload.asOfNow);
  const accountKeys = resolveActiveAccountKeys(
    payload.accounts,
    filters.preset,
    filters.includedAccountKeys,
    filters.excludedAccountKeys,
    filters.owner,
  );

  if (accountKeys.length === 0) {
    return {
      periodId,
      label: meta.label,
      shortLabel: meta.shortLabel,
      gainCad: null,
      gainPct: null,
      currentCad: 0,
      baselineCad: null,
      baselineDate: null,
      periodStart: null,
      periodEnd: payload.asOfNow,
      method: "unavailable",
      accountsIncluded: 0,
      accountsWithBaseline: 0,
      incomplete: true,
      note: "Aucun compte sélectionné.",
    };
  }

  if (periodId === "day") {
    const day = computeDayPeriod(accountKeys, payload);
    return { periodId, label: meta.label, shortLabel: meta.shortLabel, ...day };
  }

  if (periodId === "yesterday") {
    return computeYesterdayPeriod(accountKeys, payload);
  }

  return computeSnapshotPeriod(
    periodId,
    accountKeys,
    payload,
    filters.selectedYear,
  );
}

export function computeAllPeriodResults(
  payload: PerformanceIndicatorPayload,
  filters: Pick<
    PerformanceFilterState,
    | "preset"
    | "owner"
    | "includedAccountKeys"
    | "excludedAccountKeys"
    | "selectedYear"
  >,
): PerformancePeriodResult[] {
  const ids: PerformancePeriodId[] = [
    "day",
    "yesterday",
    "week",
    "month",
    "ytd",
    "year",
    "all",
  ];
  return ids.map((id) => computePeriodResult(payload, filters, id));
}

export function defaultPerformanceFilters(
  payload: PerformanceIndicatorPayload,
): PerformanceFilterState {
  const currentYear = parseIsoDate(payload.asOfNow).getFullYear();
  return {
    preset: "all",
    owner: null,
    includedAccountKeys: [],
    excludedAccountKeys: [],
    selectedYear: payload.availableYears.includes(currentYear)
      ? currentYear
      : (payload.availableYears[0] ?? currentYear),
    activePeriod: "day",
  };
}

export const PERFORMANCE_PERIODS = PERIOD_META;

export function signedGainClass(value: number | null): string {
  if (value === null) return "text-slate-400";
  if (value > 0) return "text-emerald-600";
  if (value < 0) return "text-rose-600";
  return "text-slate-600";
}

export function signedGainBg(value: number | null): string {
  if (value === null) return "bg-slate-50";
  if (value > 0) return "bg-emerald-50 ring-emerald-200";
  if (value < 0) return "bg-rose-50 ring-rose-200";
  return "bg-slate-50";
}
