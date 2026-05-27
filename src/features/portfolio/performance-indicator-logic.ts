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

function earliestSnapshotAmong(
  accountKeys: string[],
  snapshots: PerformanceSnapshotPoint[],
): string | null {
  const dates = snapshots
    .filter((s) => accountKeys.includes(s.accountKey))
    .map((s) => s.asOf);
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
} {
  const endFromSnapshot = options.endFromSnapshot ?? false;
  let currentCad = 0;
  let baselineCad = 0;
  let withBaseline = 0;
  let withEnd = 0;
  let latestBaselineDate: string | null = null;
  const coveredKeys: string[] = [];

  for (const key of accountKeys) {
    const baseSnap =
      bounds.baselineLookup
        ? snapshotValueAtDate(
            key,
            bounds.baselineLookup,
            payload.snapshots,
            payload.usdToCad,
          )
        : null;
    if (!baseSnap) continue;

    let endValueCad: number | null = null;
    if (endFromSnapshot && bounds.end) {
      const endSnap = snapshotValueAtDate(
        key,
        bounds.end,
        payload.snapshots,
        payload.usdToCad,
      );
      if (endSnap) {
        endValueCad = endSnap.valueCad;
        withEnd++;
      }
    } else {
      endValueCad = payload.currentByAccount[key]?.totalCad ?? null;
      if (endValueCad !== null) withEnd++;
    }

    if (endValueCad === null) continue;

    coveredKeys.push(key);
    baselineCad += baseSnap.valueCad;
    currentCad += endValueCad;
    withBaseline++;
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
  };
}

function computeYesterdayPeriod(
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
): PerformancePeriodResult {
  const meta = resolvePeriodMeta("yesterday", payload.asOfNow);
  const now = parseIsoDate(payload.asOfNow);
  const bounds = resolvePeriodBounds("yesterday", now, now.getFullYear(), null);
  const calc = computeAdjustedSnapshotGain(accountKeys, payload, bounds, {
    endFromSnapshot: true,
  });

  if (calc.withEnd === 0 || calc.withBaseline === 0) {
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
  const now = parseIsoDate(payload.asOfNow);
  const earliest = earliestSnapshotAmong(accountKeys, payload.snapshots);
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
      note: "Aucun snapshot historique pour cette portée.",
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
          ? "Importe des snapshots portefeuille ou saisis des valeurs externes pour activer l'historique."
          : "Snapshot de départ introuvable — importe un fichier portefeuille antérieur à cette période.",
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
    method: "snapshot-delta",
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
  if (value > 0) return "text-emerald-400";
  if (value < 0) return "text-rose-400";
  return "text-slate-300";
}

export function signedGainBg(value: number | null): string {
  if (value === null) return "bg-white/5";
  if (value > 0) return "bg-emerald-500/15 ring-emerald-400/30";
  if (value < 0) return "bg-rose-500/15 ring-rose-400/30";
  return "bg-white/5";
}
