import {
  endOfYear,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import { frCA } from "date-fns/locale";
import type {
  PerformanceAccountRef,
  PerformanceFilterState,
  PerformanceIndicatorPayload,
  PerformancePeriodId,
  PerformancePeriodResult,
  PerformanceScopePreset,
} from "./performance-indicator-types";
import {
  isoDateInToronto,
  isEquityMarketSessionOpen,
  previousTradingDay,
  referenceTradingSessionDay,
  resolveDayPeriodLabels,
  yesterdayTradingSessionDay,
} from "@/lib/market/equity-session";
import { portfolioOwnersMatch } from "@/lib/portfolio/sanitize-portfolio-owner";

const SESSION_GAINS_UNAVAILABLE_NOTE =
  "Actualise les cours pour calculer le P&L de séance.";

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
  return isoDateInToronto(d);
}

function parseIsoDate(s: string): Date {
  if (s.includes("T")) {
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
}

function baselineBeforePeriodStart(startIso: string): string {
  return isoDate(previousTradingDay(parseIsoDate(startIso), 1));
}

function currentCadTotal(
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
): number {
  return accountKeys.reduce(
    (s, k) => s + (payload.currentByAccount[k]?.totalCad ?? 0),
    0,
  );
}

/** Horloge pour les bornes : `asOfNow` en tests/SSR, sinon horloge réelle. */
function sessionClockForBounds(asOfNow?: string): Date {
  if (asOfNow) {
    const d = parseIsoDate(asOfNow);
    if (!asOfNow.includes("T")) {
      d.setHours(15, 0, 0, 0);
    }
    return d;
  }
  return new Date();
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
      return { start, end, baselineLookup: baselineBeforePeriodStart(start) };
    }
    case "month": {
      const start = isoDate(startOfMonth(now));
      return { start, end, baselineLookup: baselineBeforePeriodStart(start) };
    }
    case "ytd": {
      const start = isoDate(startOfYear(now));
      return { start, end, baselineLookup: baselineBeforePeriodStart(start) };
    }
    case "year": {
      const yearStart = startOfYear(new Date(selectedYear, 0, 1));
      const start = isoDate(yearStart);
      const yearEndDate =
        selectedYear < now.getFullYear()
          ? endOfYear(yearStart)
          : now;
      const periodEnd = isoDate(yearEndDate);
      return {
        start,
        end: periodEnd,
        baselineLookup: baselineBeforePeriodStart(start),
      };
    }
    case "all":
      return {
        start: earliestSnapshotDate,
        end,
        baselineLookup: earliestSnapshotDate,
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
  const now = sessionClockForBounds(payload.asOfNow);
  const refDay = isoDate(referenceTradingSessionDay(now));
  const refSession = (payload.sessionGainsByDate ?? []).find((g) => g.date === refDay);

  if (refSession && !isEquityMarketSessionOpen(now)) {
    const currentCad = accountKeys.reduce(
      (s, k) => s + (payload.currentByAccount[k]?.totalCad ?? 0),
      0,
    );
    return {
      gainCad: refSession.gainCad,
      gainPct:
        refSession.priorCad > 0
          ? (refSession.gainCad / refSession.priorCad) * 100
          : null,
      currentCad,
      baselineCad: refSession.priorCad > 0 ? refSession.priorCad : null,
      baselineDate: refDay,
      periodStart: refDay,
      periodEnd: refDay,
      method: "session-chain",
      accountsIncluded: accountKeys.length,
      accountsWithBaseline: disnatAccountKeysInScope(accountKeys, payload).length,
      incomplete: false,
      note: null,
    };
  }

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

function sumLiveDayGainCad(
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
): number {
  let gain = 0;
  for (const key of disnatAccountKeysInScope(accountKeys, payload)) {
    const dayGain = payload.currentByAccount[key]?.dayGainCad;
    if (dayGain != null) gain += dayGain;
  }
  return gain;
}

/** Somme des P&L de séance sur une plage (exporté pour tests). */
export function sumSessionGainsInRange(
  sessionGains: { date: string; gainCad: number; priorCad: number }[],
  start: string,
  end: string,
): { gainCad: number; priorCad: number; dates: string[] } {
  const hits = sessionGains
    .filter((g) => g.date >= start && g.date <= end)
    .toSorted((a, b) => a.date.localeCompare(b.date));
  return {
    gainCad: hits.reduce((s, g) => s + g.gainCad, 0),
    priorCad: hits[0]?.priorCad ?? 0,
    dates: hits.map((g) => g.date),
  };
}

function disnatAccountKeysInScope(
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
): string[] {
  return accountKeys.filter(
    (k) => payload.accounts.find((a) => a.accountKey === k && !a.isExternal),
  );
}

/** P&L titres = somme des séances persistées sur la période (+ live du jour si séance ouverte). */
function computeSessionChainPeriod(
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
  bounds: { start: string | null; end: string; baselineLookup: string | null },
  periodId: PerformancePeriodId,
): {
  usable: boolean;
  gainCad: number | null;
  gainPct: number | null;
  currentCad: number;
  baselineCad: number | null;
  baselineDate: string | null;
  accountsWithBaseline: number;
  incomplete: boolean;
  note: string | null;
} {
  const currentCad = currentCadTotal(accountKeys, payload);

  if (!bounds.start) {
    return {
      usable: false,
      gainCad: null,
      gainPct: null,
      currentCad,
      baselineCad: null,
      baselineDate: null,
      accountsWithBaseline: 0,
      incomplete: true,
      note: SESSION_GAINS_UNAVAILABLE_NOTE,
    };
  }

  const disnatKeys = disnatAccountKeysInScope(accountKeys, payload);
  if (disnatKeys.length === 0) {
    return {
      usable: false,
      gainCad: null,
      gainPct: null,
      currentCad,
      baselineCad: null,
      baselineDate: null,
      accountsWithBaseline: 0,
      incomplete: true,
      note: "P&L disponible uniquement sur les comptes Disnat.",
    };
  }

  const sessions =
    periodId === "all"
      ? [...(payload.sessionGainsByDate ?? [])]
      : (payload.sessionGainsByDate ?? [])
          .filter((g) => g.date >= bounds.start! && g.date <= bounds.end)
          .toSorted((a, b) => a.date.localeCompare(b.date));

  if (sessions.length === 0) {
    return {
      usable: false,
      gainCad: null,
      gainPct: null,
      currentCad,
      baselineCad: null,
      baselineDate: null,
      accountsWithBaseline: 0,
      incomplete: true,
      note: SESSION_GAINS_UNAVAILABLE_NOTE,
    };
  }

  let gainCad = sessions.reduce((s, g) => s + g.gainCad, 0);
  const priorCad = sessions[0]!.priorCad;
  let incomplete = periodId === "all" || sessions[0]!.date > bounds.start!;

  const now = sessionClockForBounds(payload.asOfNow);
  const endIsToday = bounds.end === isoDate(now);
  if (
    endIsToday &&
    periodId !== "yesterday" &&
    isEquityMarketSessionOpen(now)
  ) {
    const todayIso = bounds.end;
    const chainToday = sessions.find((g) => g.date === todayIso);
    const liveToday = sumLiveDayGainCad(accountKeys, payload);
    if (chainToday) {
      gainCad -= chainToday.gainCad;
    }
    gainCad += liveToday;
  }

  return {
    usable: true,
    gainCad,
    gainPct: priorCad > 0 ? (gainCad / priorCad) * 100 : null,
    currentCad,
    baselineCad: priorCad > 0 ? priorCad : null,
    baselineDate: sessions[0]?.date ?? bounds.baselineLookup,
    accountsWithBaseline: disnatKeys.length,
    incomplete,
    note: joinNotes(
      periodId === "all" && sessions.length > 0
        ? `Total titres depuis ${sessions[0]!.date} (historique de séances chargé).`
        : null,
      incomplete ? "P&L partiel : historique de séances incomplet sur la période." : null,
    ),
  };
}

function buildChainPeriodResult(
  periodId: Exclude<PerformancePeriodId, "day">,
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
  selectedYear: number,
): PerformancePeriodResult {
  const meta = resolvePeriodMeta(periodId, payload.asOfNow);
  const now = sessionClockForBounds(payload.asOfNow);
  const earliest = earliestHistoryAmong(accountKeys, payload);
  const bounds = resolvePeriodBounds(periodId, now, selectedYear, earliest);
  const currentCad = currentCadTotal(accountKeys, payload);

  if (periodId !== "all" && !bounds.start) {
    return {
      periodId,
      label: meta.label,
      shortLabel: meta.shortLabel,
      gainCad: null,
      gainPct: null,
      currentCad,
      baselineCad: null,
      baselineDate: null,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      method: "unavailable",
      accountsIncluded: accountKeys.length,
      accountsWithBaseline: 0,
      incomplete: true,
      note: SESSION_GAINS_UNAVAILABLE_NOTE,
    };
  }

  const calc = computeSessionChainPeriod(accountKeys, payload, bounds, periodId);
  if (!calc.usable || calc.gainCad === null) {
    return {
      periodId,
      label: meta.label,
      shortLabel: meta.shortLabel,
      gainCad: null,
      gainPct: null,
      currentCad: calc.currentCad,
      baselineCad: calc.baselineCad,
      baselineDate: calc.baselineDate,
      periodStart: bounds.start,
      periodEnd: bounds.end,
      method: "unavailable",
      accountsIncluded: accountKeys.length,
      accountsWithBaseline: calc.accountsWithBaseline,
      incomplete: true,
      note: calc.note ?? SESSION_GAINS_UNAVAILABLE_NOTE,
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
    baselineDate: calc.baselineDate,
    periodStart: bounds.start,
    periodEnd: bounds.end,
    method: "session-chain",
    accountsIncluded: accountKeys.length,
    accountsWithBaseline: calc.accountsWithBaseline,
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

  return buildChainPeriodResult(
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
