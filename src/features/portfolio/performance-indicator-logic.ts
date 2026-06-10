import {
  startOfYear,
  subMonths,
  subYears,
} from "date-fns";
import type {
  PerformanceAccountRef,
  PerformanceFilterState,
  PerformanceIndicatorPayload,
  PerformancePeriodId,
  PerformancePeriodResult,
  PerformanceScopePreset,
  PerformanceSessionGain,
} from "./performance-indicator-types";
import {
  isoDateInToronto,
  isBeforeTodaySessionOpen,
  isEquityMarketSessionOpen,
  latestAllowedFirstSessionDate,
  previousTradingDay,
  previousTradingDayIso,
  referenceTradingSessionDay,
  referenceTradingSessionDayIso,
  resolveDayPeriodLabels,
  yesterdayTradingSessionDay,
} from "@/lib/market/equity-session";
import { portfolioOwnersMatch } from "@/lib/portfolio/sanitize-portfolio-owner";
import {
  formatFlowAdjustmentNote,
  netExternalFlowsCad,
} from "./performance-cash-flows";
import { resolvePeriodReturnPercent } from "./performance-return-methods";
import { performanceScopeKey } from "./performance-snapshot-scope";

const SESSION_GAINS_UNAVAILABLE_NOTE =
  "Actualise les cours pour calculer le P&L de séance.";

const PERIOD_META: Record<
  Exclude<PerformancePeriodId, "day">,
  { label: string; shortLabel: string }
> = {
  yesterday: { label: "Séance précédente", shortLabel: "Préc." },
  month: { label: "1 mois", shortLabel: "1 mois" },
  month3: { label: "3 mois", shortLabel: "3 mois" },
  year: { label: "1 an", shortLabel: "1 an" },
  year3: { label: "3 ans", shortLabel: "3 ans" },
  ytd: { label: "Année à date", shortLabel: "AAJ" },
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
  _selectedYear: number,
  earliestSnapshotDate: string | null,
): { start: string | null; end: string; baselineLookup: string | null } {
  const refDay = referenceTradingSessionDay(now);
  const end = isoDate(refDay);

  switch (periodId) {
    case "day": {
      const baseline = isoDate(previousTradingDay(refDay, 1));
      return { start: end, end, baselineLookup: baseline };
    }
    case "yesterday": {
      const sessionEnd = isoDate(yesterdayTradingSessionDay(now));
      const baseline = isoDate(previousTradingDay(parseIsoDate(sessionEnd), 1));
      return { start: sessionEnd, end: sessionEnd, baselineLookup: baseline };
    }
    case "month": {
      const start = isoDate(subMonths(refDay, 1));
      return { start, end, baselineLookup: baselineBeforePeriodStart(start) };
    }
    case "month3": {
      const start = isoDate(subMonths(refDay, 3));
      return { start, end, baselineLookup: baselineBeforePeriodStart(start) };
    }
    case "year": {
      const start = isoDate(subYears(refDay, 1));
      return { start, end, baselineLookup: baselineBeforePeriodStart(start) };
    }
    case "year3": {
      const start = isoDate(subYears(refDay, 3));
      return { start, end, baselineLookup: baselineBeforePeriodStart(start) };
    }
    case "ytd": {
      const start = isoDate(startOfYear(refDay));
      return { start, end, baselineLookup: baselineBeforePeriodStart(start) };
    }
    case "all":
      return {
        start: earliestSnapshotDate,
        end,
        baselineLookup: earliestSnapshotDate,
      };
  }
}

/** Agrège les gains de séance pour les comptes filtrés. */
export function aggregateSessionGainsForAccounts(
  payload: PerformanceIndicatorPayload,
  accountKeys: string[],
): PerformanceSessionGain[] {
  const disnatKeys = disnatAccountKeysInScope(accountKeys, payload);
  const byDate = new Map<string, { gainCad: number; priorCad: number }>();

  for (const accountKey of disnatKeys) {
    for (const g of payload.sessionGainsByAccount?.[accountKey] ?? []) {
      const bucket = byDate.get(g.date) ?? { gainCad: 0, priorCad: 0 };
      bucket.gainCad += g.gainCad;
      bucket.priorCad += g.priorCad;
      byDate.set(g.date, bucket);
    }
  }

  return [...byDate.entries()]
    .map(([date, v]) => ({ date, gainCad: v.gainCad, priorCad: v.priorCad }))
    .toSorted((a, b) => a.date.localeCompare(b.date));
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
  const today = isoDateInToronto(now);
  const refDay = isoDate(referenceTradingSessionDay(now));
  const sessionHealthNote = payload.sessionDataHealth.message ?? SESSION_GAINS_UNAVAILABLE_NOTE;

  if (isBeforeTodaySessionOpen(now)) {
    return {
      gainCad: null,
      gainPct: null,
      currentCad: currentCadTotal(accountKeys, payload),
      baselineCad: null,
      baselineDate: null,
      periodStart: today,
      periodEnd: today,
      method: "unavailable",
      accountsIncluded: accountKeys.length,
      accountsWithBaseline: 0,
      incomplete: false,
      annualized: false,
      note: null,
    };
  }

  const onlyExternal =
    accountKeys.length > 0 &&
    accountKeys.every((k) => payload.accounts.find((a) => a.accountKey === k)?.isExternal);

  if (onlyExternal) {
    return {
      gainCad: null,
      gainPct: null,
      currentCad: currentCadTotal(accountKeys, payload),
      baselineCad: null,
      baselineDate: null,
      periodStart: refDay,
      periodEnd: refDay,
      method: "unavailable",
      accountsIncluded: accountKeys.length,
      accountsWithBaseline: 0,
      incomplete: true,
      annualized: false,
      note: "P&L jour disponible uniquement sur les titres Disnat avec cotation.",
    };
  }

  if (isEquityMarketSessionOpen(now)) {
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

    if (hasGain) {
      return {
        gainCad: gain,
        gainPct: hasPrior && prior > 0 ? (gain / prior) * 100 : null,
        currentCad,
        baselineCad: hasPrior ? prior : null,
        baselineDate: null,
        periodStart: refDay,
        periodEnd: refDay,
        method: "live-quotes",
        accountsIncluded: accountKeys.length,
        accountsWithBaseline: disnatWithDay,
        incomplete,
        annualized: false,
        note: incomplete
          ? joinNotes(
              "P&L partiel : cotation absente sur au moins une ligne titre.",
              payload.sessionDataHealth.ok ? null : sessionHealthNote,
            )
          : null,
      };
    }
  } else {
    const refSession = aggregateSessionGainsForAccounts(payload, accountKeys).find(
      (g) => g.date === refDay,
    );
    if (refSession) {
      return {
        gainCad: refSession.gainCad,
        gainPct:
          refSession.priorCad > 0
            ? (refSession.gainCad / refSession.priorCad) * 100
            : null,
        currentCad: currentCadTotal(accountKeys, payload),
        baselineCad: refSession.priorCad > 0 ? refSession.priorCad : null,
        baselineDate: refDay,
        periodStart: refDay,
        periodEnd: refDay,
        method: "session-chain",
        accountsIncluded: accountKeys.length,
        accountsWithBaseline: disnatAccountKeysInScope(accountKeys, payload).length,
        incomplete: false,
        annualized: false,
        note: null,
      };
    }
  }

  return {
    gainCad: null,
    gainPct: null,
    currentCad: currentCadTotal(accountKeys, payload),
    baselineCad: null,
    baselineDate: refDay,
    periodStart: refDay,
    periodEnd: refDay,
    method: "unavailable",
    accountsIncluded: accountKeys.length,
    accountsWithBaseline: 0,
    incomplete: true,
    annualized: false,
    note: sessionHealthNote,
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

function currentPositionsCadInGainScope(
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
): number {
  return disnatAccountKeysInScope(accountKeys, payload).reduce(
    (s, k) => s + (payload.currentByAccount[k]?.positionsCad ?? 0),
    0,
  );
}

function historyPointCad(
  valueNative: number,
  currency: string,
  usdToCad: number | null,
): number {
  if (currency.toUpperCase() === "USD") {
    return usdToCad !== null ? valueNative * usdToCad : valueNative;
  }
  return valueNative;
}

/** Historique plus vieux que ce seuil (jours ouvrés) → ignoré pour V(t). */
const TITRES_HISTORY_MAX_GAP_TRADING_DAYS = 5;

function minAcceptableHistoryAsOf(targetDate: string): string {
  return previousTradingDayIso(targetDate, TITRES_HISTORY_MAX_GAP_TRADING_DAYS);
}

/** Comptes Disnat avec titres en jeu (positions ou historique récent sur la période). */
function disnatTitresMaterialKeys(
  disnatKeys: string[],
  payload: PerformanceIndicatorPayload,
  baselineLookup: string,
  endDate: string,
): string[] {
  const minBase = minAcceptableHistoryAsOf(baselineLookup);
  const minEnd = minAcceptableHistoryAsOf(endDate);
  return disnatKeys.filter((k) => {
    if ((payload.currentByAccount[k]?.positionsCad ?? 0) > 0) return true;
    for (const pt of payload.historyPoints ?? []) {
      if (pt.accountKey !== k) continue;
      if (pt.asOf >= minBase && pt.asOf <= baselineLookup) return true;
      if (pt.asOf >= minEnd && pt.asOf <= endDate) return true;
    }
    return false;
  });
}

/** Valeur titres agrégée (CAD) au plus tard à `targetDate`, par compte. */
export function titresCadAtOrBefore(
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
  targetDate: string,
): { valueCad: number; asOf: string; accountsWithData: number } | null {
  const keys = new Set(accountKeys);
  const byAccount = new Map<string, { asOf: string; valueCad: number }>();
  const minAsOf = minAcceptableHistoryAsOf(targetDate);

  for (const pt of payload.historyPoints ?? []) {
    if (!keys.has(pt.accountKey)) continue;
    if (pt.asOf > targetDate || pt.asOf < minAsOf) continue;
    const valueCad = historyPointCad(
      pt.totalValueNative,
      pt.currency,
      payload.usdToCad,
    );
    const cur = byAccount.get(pt.accountKey);
    if (!cur || pt.asOf > cur.asOf) {
      byAccount.set(pt.accountKey, { asOf: pt.asOf, valueCad });
    }
  }

  if (byAccount.size === 0) return null;

  let total = 0;
  let coverageAsOf = targetDate;
  for (const row of byAccount.values()) {
    total += row.valueCad;
    if (row.asOf < coverageAsOf) coverageAsOf = row.asOf;
  }

  return {
    valueCad: total,
    asOf: coverageAsOf,
    accountsWithData: byAccount.size,
  };
}

function resolveEndTitresCad(
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
  endDate: string,
): number | null {
  const now = sessionClockForBounds(payload.asOfNow);
  const today = isoDateInToronto(now);
  const refDay = referenceTradingSessionDayIso(now);

  // Avant l'ouverture : pas de clôture « live » pour une séance passée (évite doublon Séance/Préc.)
  if (!isBeforeTodaySessionOpen(now)) {
    const useLiveEnd =
      endDate === refDay &&
      (isEquityMarketSessionOpen(now) || endDate === today);
    if (useLiveEnd) {
      const live = currentPositionsCadInGainScope(accountKeys, payload);
      if (live > 0) return live;
    }
  }

  return titresCadAtOrBefore(accountKeys, payload, endDate)?.valueCad ?? null;
}

/**
 * Gain titres = Δ valeur de marché − flux nets (cotisations / retraits).
 * Exclut les apports de capitaux du gain affiché en $.
 */
export function computeTitresPeriodGain(
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
  bounds: { start: string | null; end: string; baselineLookup: string | null },
): {
  usable: boolean;
  gainCad: number | null;
  gainPct: number | null;
  baselineCad: number | null;
  baselineDate: string | null;
  accountsWithBaseline: number;
  incomplete: boolean;
} {
  const disnatKeys = disnatAccountKeysInScope(accountKeys, payload);
  if (disnatKeys.length === 0 || !bounds.start) {
    return {
      usable: false,
      gainCad: null,
      gainPct: null,
      baselineCad: null,
      baselineDate: null,
      accountsWithBaseline: 0,
      incomplete: true,
    };
  }

  const lookup =
    bounds.baselineLookup ?? baselineBeforePeriodStart(bounds.start);
  const materialKeys = disnatTitresMaterialKeys(
    disnatKeys,
    payload,
    lookup,
    bounds.end,
  );
  if (materialKeys.length === 0) {
    return {
      usable: false,
      gainCad: null,
      gainPct: null,
      baselineCad: null,
      baselineDate: null,
      accountsWithBaseline: 0,
      incomplete: true,
    };
  }

  const startHit = titresCadAtOrBefore(materialKeys, payload, lookup);
  const endCad = resolveEndTitresCad(materialKeys, payload, bounds.end);

  if (!startHit || endCad === null) {
    return {
      usable: false,
      gainCad: null,
      gainPct: null,
      baselineCad: null,
      baselineDate: null,
      accountsWithBaseline: 0,
      incomplete: true,
    };
  }

  const netFlowsCad = netExternalFlowsCad(
    payload.cashFlows,
    accountKeys,
    bounds.start,
    bounds.end,
  );
  const baselineCad = startHit.valueCad + netFlowsCad;
  const gainCad = endCad - startHit.valueCad - netFlowsCad;
  const gainPct =
    baselineCad > 0 && Number.isFinite(gainCad)
      ? (gainCad / baselineCad) * 100
      : null;

  const incomplete =
    bounds.start != null &&
    (startHit.asOf > latestAllowedFirstSessionDate(bounds.start) ||
      startHit.accountsWithData < materialKeys.length);

  return {
    usable: true,
    gainCad,
    gainPct,
    baselineCad: baselineCad > 0 ? baselineCad : null,
    baselineDate: lookup,
    accountsWithBaseline: startHit.accountsWithData,
    incomplete,
  };
}

function dayPeriodFromTitresDelta(
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
  sessionEnd: string,
): Omit<PerformancePeriodResult, "periodId" | "label" | "shortLabel"> | null {
  const priorDay = isoDate(previousTradingDay(parseIsoDate(sessionEnd), 1));
  const calc = computeTitresPeriodGain(accountKeys, payload, {
    start: sessionEnd,
    end: sessionEnd,
    baselineLookup: priorDay,
  });
  if (!calc.usable || calc.gainCad === null) return null;

  return {
    gainCad: calc.gainCad,
    gainPct: calc.gainPct,
    currentCad: currentCadTotal(accountKeys, payload),
    baselineCad: calc.baselineCad,
    baselineDate: priorDay,
    periodStart: sessionEnd,
    periodEnd: sessionEnd,
    method: "session-chain",
    accountsIncluded: accountKeys.length,
    accountsWithBaseline: calc.accountsWithBaseline,
    incomplete: calc.incomplete,
    annualized: false,
    note: formatFlowAdjustmentNote(
      netExternalFlowsCad(payload.cashFlows, accountKeys, sessionEnd, sessionEnd),
    ),
  };
}

/**
 * % de rendement sur une chaîne de séances.
 * Baseline = valeur titres au début + flux nets (cotisations / retraits), sauf couverture
 * partielle au démarrage (1re séance sous-estimée → baseline implicite).
 */
export function resolveSessionChainGainPct(
  gainCad: number,
  firstSessionPriorCad: number,
  positionsCadNow: number,
  sessionCount: number,
  netFlowsCad = 0,
): { gainPct: number | null; baselineCad: number | null } {
  const impliedStart = positionsCadNow - gainCad;
  const partialCoverage =
    sessionCount > 1 &&
    firstSessionPriorCad > 0 &&
    impliedStart > 0 &&
    firstSessionPriorCad < impliedStart * 0.15;

  if (sessionCount <= 1) {
    const baseline =
      firstSessionPriorCad > 0
        ? firstSessionPriorCad
        : impliedStart > 0
          ? impliedStart
          : null;
    if (baseline === null || baseline <= 0) {
      return { gainPct: null, baselineCad: null };
    }
    return {
      gainPct: (gainCad / baseline) * 100,
      baselineCad: baseline,
    };
  }

  let baselineCad: number | null;
  if (partialCoverage) {
    baselineCad = impliedStart > 0 ? impliedStart : null;
  } else {
    const flowAdjusted = firstSessionPriorCad + netFlowsCad;
    baselineCad =
      flowAdjusted > 0
        ? flowAdjusted
        : impliedStart > 0
          ? impliedStart
          : firstSessionPriorCad > 0
            ? firstSessionPriorCad
            : null;
  }

  if (baselineCad === null || baselineCad <= 0) {
    return { gainPct: null, baselineCad: null };
  }
  return {
    gainPct: (gainCad / baselineCad) * 100,
    baselineCad,
  };
}

/** P&L titres sur la période : Δ valeur marché − flux nets (priorité historique titres). */
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
  annualized: boolean;
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
      annualized: false,
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
      annualized: false,
      note: "P&L disponible uniquement sur les comptes Disnat.",
    };
  }

  // « Séance précédente » et multi-périodes : uniquement la chaîne session_gains persistée.
  const filteredSessions = aggregateSessionGainsForAccounts(payload, accountKeys);
  const sessions =
    periodId === "all"
      ? [...filteredSessions]
      : filteredSessions
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
      annualized: false,
      note: joinNotes(
        "Historique titres indisponible pour cette période.",
        payload.sessionDataHealth.message ?? SESSION_GAINS_UNAVAILABLE_NOTE,
      ),
    };
  }

  let gainCad = sessions.reduce((s, g) => s + g.gainCad, 0);
  const incomplete =
    periodId === "all"
      ? false
      : bounds.start != null &&
        sessions[0]!.date > latestAllowedFirstSessionDate(bounds.start);

  // En séance ouverte, remplace le P&L persisté du jour par le P&L live.
  const now = sessionClockForBounds(payload.asOfNow);
  const refDay = isoDate(referenceTradingSessionDay(now));
  const endIsToday = bounds.end === refDay;
  if (endIsToday && periodId !== "yesterday" && isEquityMarketSessionOpen(now)) {
    const chainToday = sessions.find((g) => g.date === refDay);
    const liveToday = sumLiveDayGainCad(accountKeys, payload);
    if (chainToday) gainCad -= chainToday.gainCad;
    gainCad += liveToday;
  }

  const lookup =
    bounds.baselineLookup ?? baselineBeforePeriodStart(bounds.start!);
  const materialKeys = disnatTitresMaterialKeys(
    disnatKeys,
    payload,
    lookup,
    bounds.end,
  );
  const startHit = titresCadAtOrBefore(materialKeys, payload, lookup);
  const endCad = resolveEndTitresCad(materialKeys, payload, bounds.end);

  const ret = resolvePeriodReturnPercent({
    sessions,
    periodStart: bounds.start!,
    periodEnd: bounds.end,
    bmv: startHit?.valueCad ?? null,
    emv: endCad,
    flows: payload.cashFlows,
    accountKeys,
  });

  return {
    usable: true,
    gainCad,
    gainPct: ret.gainPct,
    currentCad,
    baselineCad: ret.baselineCad,
    baselineDate: startHit?.asOf ?? sessions[0]?.date ?? bounds.baselineLookup,
    accountsWithBaseline: disnatKeys.length,
    incomplete,
    annualized: ret.annualized,
    note:
      periodId === "all" || !incomplete
        ? null
        : "P&L partiel : historique de séances incomplet sur la période.",
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

  if (!payload.sessionDataHealth.ok) {
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
      annualized: false,
      note: payload.sessionDataHealth.message ?? SESSION_GAINS_UNAVAILABLE_NOTE,
    };
  }

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
      annualized: false,
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
      annualized: false,
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
    annualized: calc.annualized,
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
      annualized: false,
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
    "month",
    "month3",
    "year",
    "year3",
    "ytd",
    "all",
  ];
  return ids.map((id) => computePeriodResult(payload, filters, id));
}

const SNAPSHOT_PERIOD_IDS: PerformancePeriodId[] = [
  "day",
  "yesterday",
  "month",
  "month3",
  "year",
  "year3",
  "ytd",
  "all",
];

function snapshotRowsForFilters(
  payload: PerformanceIndicatorPayload,
  filters: Pick<
    PerformanceFilterState,
    "preset" | "owner" | "includedAccountKeys" | "excludedAccountKeys"
  >,
): PerformancePeriodResult[] | null {
  const key = performanceScopeKey(filters);
  return payload.performanceSnapshots?.byScopeKey[key] ?? null;
}

/** Lit les snapshots persistés ; recalcule le jour en live si séance ouverte. */
export function computePeriodResultWithSnapshots(
  payload: PerformanceIndicatorPayload,
  filters: PerformanceFilterState,
  periodId: PerformancePeriodId,
): PerformancePeriodResult {
  if (periodId !== "day") {
    const rows = snapshotRowsForFilters(payload, filters);
    const hit = rows?.find((r) => r.periodId === periodId);
    if (hit) return hit;
  }
  return computePeriodResult(payload, filters, periodId);
}

export function computeAllPeriodResultsWithSnapshots(
  payload: PerformanceIndicatorPayload,
  filters: Pick<
    PerformanceFilterState,
    | "preset"
    | "owner"
    | "includedAccountKeys"
    | "excludedAccountKeys"
    | "selectedYear"
    | "activePeriod"
  >,
): PerformancePeriodResult[] {
  const rows = snapshotRowsForFilters(payload, filters);
  if (!rows?.length) {
    return computeAllPeriodResults(payload, filters);
  }
  const byId = new Map(rows.map((r) => [r.periodId, r]));
  return SNAPSHOT_PERIOD_IDS.map((id) => {
    if (id === "day") {
      return computePeriodResult(payload, filters, "day");
    }
    return byId.get(id) ?? computePeriodResult(payload, filters, id);
  });
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
