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
  addCalendarDays,
  isoDateInToronto,
  isBeforeTodaySessionOpen,
  isEquityMarketSessionOpen,
  latestAllowedFirstSessionDate,
  parseIsoCalendarDate,
  previousTradingDayIso,
  priorReferenceSessionDateIso,
  referenceTradingSessionDay,
  referenceTradingSessionDayIso,
  resolveDayPeriodLabels,
} from "@/lib/market/equity-session";
import { portfolioOwnersMatch } from "@/lib/portfolio/sanitize-portfolio-owner";
import {
  formatFlowAdjustmentNote,
  netExternalFlowsCad,
} from "./performance-cash-flows";
import {
  cashCadAtOrBefore,
  cashLedgerReliableForAccount,
} from "./performance-cash-ledger";
import {
  resolvePeriodReturnPercent,
  weightedExternalFlowsForDietz,
  gainCadFromPeriodReturn,
  type PeriodReturnPercent,
} from "./performance-return-methods";

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

/**
 * Parse une date ISO. Les dates calendrier (`YYYY-MM-DD`) sont ancrées à midi UTC :
 * les reconvertir en date Toronto ne doit jamais décaler d'un jour selon le fuseau
 * du process (Vercel = UTC, navigateur = America/Toronto).
 */
function parseIsoDate(s: string): Date {
  const raw = s.trim();
  if (raw.includes("T")) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return parseIsoCalendarDate(raw);
  }
  return new Date();
}

/** Date JS → ISO calendrier (composantes UTC). */
function isoFromUtcDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Décale une date calendrier ISO de N mois (clamp de fin de mois : 31 mai → 28/29 févr.). */
function shiftCalendarMonthsIso(iso: string, months: number): string {
  const base = parseIsoCalendarDate(iso);
  const dayOfMonth = base.getUTCDate();
  const target = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1, 12),
  );
  const lastDayOfTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12),
  ).getUTCDate();
  target.setUTCDate(Math.min(dayOfMonth, lastDayOfTargetMonth));
  return isoFromUtcDate(target);
}

function shiftCalendarYearsIso(iso: string, years: number): string {
  return shiftCalendarMonthsIso(iso, years * 12);
}

function baselineBeforePeriodStart(startIso: string): string {
  return previousTradingDayIso(startIso, 1);
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
  portfolioKey: string | null,
  portfolioScopes: { portfolioKey: string; accountKeys: string[] }[],
): string[] {
  let keys = accounts.map((a) => a.accountKey);

  if (portfolioKey) {
    const scoped = portfolioScopes.find((p) => p.portfolioKey === portfolioKey);
    if (!scoped) return [];
    const set = new Set(scoped.accountKeys);
    keys = keys.filter((k) => set.has(k));
  }

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

/**
 * Bornes de période — **calcul 100 % calendrier** (chaînes ISO + arithmétique UTC).
 * Aucune conversion via le fuseau du process : les mêmes entrées doivent produire les
 * mêmes bornes sur Vercel (UTC), dans un navigateur (America/Toronto) et dans les tests.
 *
 * `selectedYear` pilote l'« année à date » : on peut consulter l'AAJ d'une année passée
 * (bornes 1er janv. → 31 déc. de cette année, tronquées à la séance de référence).
 */
export function resolvePeriodBounds(
  periodId: PerformancePeriodId,
  now: Date,
  selectedYear: number,
  earliestSnapshotDate: string | null,
): { start: string | null; end: string; baselineLookup: string | null } {
  const end = referenceTradingSessionDayIso(now);

  switch (periodId) {
    case "day": {
      const baseline = previousTradingDayIso(end, 1);
      return { start: end, end, baselineLookup: baseline };
    }
    case "yesterday": {
      const sessionEnd = priorReferenceSessionDateIso(now);
      const baseline = previousTradingDayIso(sessionEnd, 1);
      return { start: sessionEnd, end: sessionEnd, baselineLookup: baseline };
    }
    case "month": {
      const start = previousTradingDayIso(end, 20);
      return { start, end, baselineLookup: baselineBeforePeriodStart(start) };
    }
    case "month3": {
      const start = shiftCalendarMonthsIso(end, -3);
      return { start, end, baselineLookup: baselineBeforePeriodStart(start) };
    }
    case "year": {
      const start = shiftCalendarYearsIso(end, -1);
      return { start, end, baselineLookup: baselineBeforePeriodStart(start) };
    }
    case "year3": {
      const start = shiftCalendarYearsIso(end, -3);
      return { start, end, baselineLookup: baselineBeforePeriodStart(start) };
    }
    case "ytd": {
      // `selectedYear` rend le sélecteur d'année fonctionnel : l'AAJ se calcule sur
      // l'année choisie (tronquée à la séance de référence si c'est l'année courante).
      const currentYear = Number(end.slice(0, 4));
      const year =
        Number.isFinite(selectedYear) && selectedYear >= 1900
          ? selectedYear
          : currentYear;
      const start = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;
      const periodEnd = end > yearEnd ? yearEnd : end;
      return { start, end: periodEnd, baselineLookup: baselineBeforePeriodStart(start) };
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
      incompleteReason: null,
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
      incompleteReason: "P&L jour disponible uniquement sur les titres Disnat avec cotation.",
      annualized: false,
      note: "P&L jour disponible uniquement sur les titres Disnat avec cotation.",
    };
  }

  const liveQuotesUsable =
    canUseLiveValuesForAsOf(payload) && isEquityMarketSessionOpen(now);

  if (liveQuotesUsable) {
    let gain = 0;
    let prior = 0;
    let hasGain = false;
    let hasPrior = false;
    let incomplete = false;
    let currentCad = 0;
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
        incompleteReason: incomplete
          ? joinNotes(
              "Cotation absente sur au moins une ligne titre : P&L partiel.",
              payload.sessionDataHealth.ok ? null : sessionHealthNote,
            )
          : null,
        annualized: false,
        note: incomplete
          ? joinNotes(
              "P&L partiel : cotation absente sur au moins une ligne titre.",
              payload.sessionDataHealth.ok ? null : sessionHealthNote,
            )
          : null,
      };
    }
  }

  // Repli : chaîne de séances persistée. Vaut pour une séance fermée **et** pour une séance
  // ouverte sans cotation exploitable (Yahoo indisponible, lignes sans prix…), sinon on
  // afficherait « — » alors que le P&L de séance existe en base.
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
      incomplete: liveQuotesUsable,
      incompleteReason: liveQuotesUsable
        ? joinNotes(
            "Cotations indisponibles : P&L de séance persisté utilisé.",
            payload.sessionDataHealth.ok ? null : sessionHealthNote,
          )
        : null,
      annualized: false,
      note: liveQuotesUsable
        ? joinNotes(
            "Cotations indisponibles : P&L de séance persisté utilisé.",
            payload.sessionDataHealth.ok ? null : sessionHealthNote,
          )
        : null,
    };
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
    incompleteReason: sessionHealthNote,
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

/** Taux USD→CAD à une date donnée, avec repli sur le taux courant si absent de la carte historique. */
function usdCadRateForDate(
  payload: PerformanceIndicatorPayload,
  dateIso: string,
): number | null {
  return payload.usdCadRateByDate[dateIso] ?? payload.usdToCad;
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

/**
 * Vrai seulement si les cotations live du payload sont fraîches pour le jour visé —
 * pas seulement si l'horloge réelle est aussi sur ce jour. Ça évite qu'une simulation
 * historique (asOfNow forcé à une date passée, ex. l'outil de conciliation) réutilise
 * silencieusement des cotations live d'un autre jour.
 */
function canUseLiveValuesForAsOf(payload: PerformanceIndicatorPayload): boolean {
  if (!payload.asOfNow) return true;
  const asOfDay = isoDateInToronto(parseIsoDate(payload.asOfNow));
  const quotesDay = payload.quotesAsOf
    ? isoDateInToronto(parseIsoDate(payload.quotesAsOf))
    : isoDateInToronto(new Date());
  return asOfDay === quotesDay;
}

/** Plus ancien / plus récent point titres (historyPoints/snapshots) connu pour un compte. */
function titresAsOfBoundsForAccount(
  accountKey: string,
  payload: PerformanceIndicatorPayload,
): { earliest: string | null; latest: string | null } {
  const dates = [
    ...(payload.historyPoints ?? [])
      .filter((p) => p.accountKey === accountKey)
      .map((p) => p.asOf),
    ...(payload.snapshots ?? [])
      .filter((p) => p.accountKey === accountKey)
      .map((p) => p.asOf),
  ];
  if (dates.length === 0) return { earliest: null, latest: null };
  const sorted = dates.toSorted();
  return { earliest: sorted[0]!, latest: sorted[sorted.length - 1]! };
}

/**
 * Encaisse réelle observée dans le dernier import Disnat du compte
 * (`totalValueNative − marketValueNative`, convertie en CAD), utilisée comme contrôle
 * indépendant du ledger reconstruit.
 */
function expectedCashFromLatestImport(
  accountKey: string,
  payload: PerformanceIndicatorPayload,
): { asOf: string; cad: number } | null {
  let best: { asOf: string; cad: number } | null = null;
  for (const pt of payload.snapshots ?? []) {
    if (pt.accountKey !== accountKey) continue;
    if (pt.marketValueNative == null) continue;
    if (!best || pt.asOf > best.asOf) {
      const cashNative = pt.totalValueNative - pt.marketValueNative;
      best = {
        asOf: pt.asOf,
        cad: historyPointCad(
          cashNative,
          pt.currency,
          usdCadRateForDate(payload, pt.asOf),
        ),
      };
    }
  }
  return best;
}

/** Mémoïse la fiabilité du ledger cash par compte pour un payload donné (évite un rescan). */
const cashLedgerReliabilityCache = new WeakMap<
  PerformanceIndicatorPayload,
  Map<string, boolean>
>();

function isCashLedgerReliable(
  accountKey: string,
  payload: PerformanceIndicatorPayload,
): boolean {
  let cache = cashLedgerReliabilityCache.get(payload);
  if (!cache) {
    cache = new Map();
    cashLedgerReliabilityCache.set(payload, cache);
  }
  const cached = cache.get(accountKey);
  if (cached !== undefined) return cached;

  const { earliest, latest } = titresAsOfBoundsForAccount(accountKey, payload);
  const reliable = cashLedgerReliableForAccount(
    accountKey,
    payload.accountCashLedgers,
    earliest,
    latest,
    expectedCashFromLatestImport(accountKey, payload),
  );
  cache.set(accountKey, reliable);
  return reliable;
}

/**
 * Ajoute l'encaisse (ledger) à une valeur titres, uniquement si le ledger cash de ce
 * compte est jugé fiable (voir cashLedgerReliableForAccount) — sinon retourne la valeur
 * titres seule (comportement historique), pour éviter d'introduire un delta cash faux
 * quand le ledger démarre au milieu de la fenêtre mesurée (financement initial manquant)
 * ou s'est arrêté d'être alimenté bien avant la fin de l'historique titres connu.
 */
function cashAdjustedTitresCad(
  accountKey: string,
  payload: PerformanceIndicatorPayload,
  titresValueCad: number,
  anchorDate: string,
): number {
  if (!isCashLedgerReliable(accountKey, payload)) {
    return titresValueCad;
  }
  return (
    titresValueCad +
    cashCadAtOrBefore([accountKey], payload.accountCashLedgers, anchorDate)
  );
}

/** Historique plus vieux que ce seuil (jours ouvrés) → ignoré pour V(t). */
export const TITRES_HISTORY_MAX_GAP_TRADING_DAYS = 5;

export function minAcceptableHistoryAsOf(targetDate: string): string {
  return previousTradingDayIso(targetDate, TITRES_HISTORY_MAX_GAP_TRADING_DAYS);
}

/** Comptes Disnat avec titres en jeu (positions ou historique récent sur la période). */
export function disnatTitresMaterialKeys(
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

/**
 * Valeur titres agrégée (CAD) au plus tard à `targetDate`, par compte.
 *
 * - Un compte peut détenir des titres dans **plusieurs devises** : on agrège d'abord par
 *   (compte, date) puis on retient la date la plus récente, sinon une des poches de
 *   devises serait silencieusement ignorée.
 * - Base **marché uniquement** : `historyPoints` n'inclut pas l'encaisse (on ajoute le
 *   ledger si fiable), et les snapshots d'import utilisent `marketValueNative` (jamais
 *   `totalValueNative` qui mélangerait titres + encaisse dans une base titres).
 * - L'historique projeté prime sur un import le même jour (comportement historique).
 */
export function titresCadAtOrBefore(
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
  targetDate: string,
  options?: { includeCash?: boolean },
): { valueCad: number; asOf: string; accountsWithData: number } | null {
  const includeCash = options?.includeCash ?? true;
  const keys = new Set(accountKeys);
  const minAsOf = minAcceptableHistoryAsOf(targetDate);

  const historyByAccountDate = new Map<string, Map<string, number>>();
  const snapshotByAccountDate = new Map<string, Map<string, number>>();

  const addValue = (
    buckets: Map<string, Map<string, number>>,
    accountKey: string,
    asOf: string,
    valueCad: number,
  ) => {
    const perDate = buckets.get(accountKey) ?? new Map<string, number>();
    perDate.set(asOf, (perDate.get(asOf) ?? 0) + valueCad);
    buckets.set(accountKey, perDate);
  };

  for (const pt of payload.historyPoints ?? []) {
    if (!keys.has(pt.accountKey)) continue;
    if (pt.asOf > targetDate || pt.asOf < minAsOf) continue;
    addValue(
      historyByAccountDate,
      pt.accountKey,
      pt.asOf,
      historyPointCad(
        pt.totalValueNative,
        pt.currency,
        usdCadRateForDate(payload, pt.asOf),
      ),
    );
  }

  for (const pt of payload.snapshots ?? []) {
    if (!keys.has(pt.accountKey)) continue;
    if (pt.asOf > targetDate || pt.asOf < minAsOf) continue;
    const native = pt.marketValueNative ?? pt.totalValueNative;
    addValue(
      snapshotByAccountDate,
      pt.accountKey,
      pt.asOf,
      historyPointCad(native, pt.currency, usdCadRateForDate(payload, pt.asOf)),
    );
  }

  const accountsWithData = new Set([
    ...historyByAccountDate.keys(),
    ...snapshotByAccountDate.keys(),
  ]);
  if (accountsWithData.size === 0) return null;

  let total = 0;
  let coverageAsOf = targetDate;
  for (const accountKey of accountsWithData) {
    const history = historyByAccountDate.get(accountKey);
    const snapshot = snapshotByAccountDate.get(accountKey);
    const dates = new Set<string>([
      ...(history?.keys() ?? []),
      ...(snapshot?.keys() ?? []),
    ]);
    const latestDate = [...dates].toSorted().at(-1);
    if (!latestDate) continue;

    let valueCad = history?.get(latestDate) ?? snapshot?.get(latestDate) ?? 0;
    // L'encaisse vient du ledger (une seule fois par compte, pas par devise).
    if (includeCash) {
      valueCad = cashAdjustedTitresCad(accountKey, payload, valueCad, latestDate);
    }

    total += valueCad;
    if (latestDate < coverageAsOf) coverageAsOf = latestDate;
  }

  return {
    valueCad: total,
    asOf: coverageAsOf,
    accountsWithData: accountsWithData.size,
  };
}

/**
 * Valeur titres agrégée uniquement si chaque compte est résolu.
 * Compte sans titres actuels et sans historique à la date → 0.
 */
export function titresCadFullCoverageAtOrBefore(
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
  targetDate: string,
  options?: { includeCash?: boolean },
): { valueCad: number; asOf: string } | null {
  if (accountKeys.length === 0) return null;

  let total = 0;
  let coverageAsOf = targetDate;

  for (const key of accountKeys) {
    const hit = titresCadAtOrBefore([key], payload, targetDate, options);
    if (hit) {
      total += hit.valueCad;
      if (hit.asOf < coverageAsOf) coverageAsOf = hit.asOf;
      continue;
    }
    const positionsNow = payload.currentByAccount[key]?.positionsCad ?? 0;
    if (positionsNow <= 0) continue;
    return null;
  }

  return { valueCad: total, asOf: coverageAsOf };
}

function titresCadAtPeriodEnd(
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
  endDate: string,
): { valueCad: number; asOf: string } | null {
  const now = sessionClockForBounds(payload.asOfNow);
  const refDay = referenceTradingSessionDayIso(now);

  if (
    canUseLiveValuesForAsOf(payload) &&
    !isBeforeTodaySessionOpen(now) &&
    endDate === refDay &&
    isEquityMarketSessionOpen(now)
  ) {
    let total = 0;
    for (const key of accountKeys) {
      const cur = payload.currentByAccount[key];
      if (!cur) return null;
      if (cur.positionsCad > 0) {
        total += cashAdjustedTitresCad(key, payload, cur.positionsCad, endDate);
        continue;
      }
      const hit = titresCadAtOrBefore([key], payload, endDate);
      if (hit) {
        total += hit.valueCad;
        continue;
      }
      continue;
    }
    return { valueCad: total, asOf: endDate };
  }

  return titresCadFullCoverageAtOrBefore(accountKeys, payload, endDate);
}

/** Plus ancien point de valeur titres **du compte** dans `[fromIso, toIso]` (base marché). */
function earliestAccountTitresPointInRange(
  accountKey: string,
  payload: PerformanceIndicatorPayload,
  fromIso: string,
  toIso: string,
): { valueCad: number; asOf: string } | null {
  let best: { valueCad: number; asOf: string } | null = null;
  const consider = (asOf: string, valueCad: number) => {
    if (asOf < fromIso || asOf > toIso) return;
    if (!best || asOf < best.asOf) best = { valueCad, asOf };
  };
  for (const pt of payload.historyPoints ?? []) {
    if (pt.accountKey !== accountKey) continue;
    consider(
      pt.asOf,
      cashAdjustedTitresCad(
        accountKey,
        payload,
        historyPointCad(
          pt.totalValueNative,
          pt.currency,
          usdCadRateForDate(payload, pt.asOf),
        ),
        pt.asOf,
      ),
    );
  }
  for (const pt of payload.snapshots ?? []) {
    if (pt.accountKey !== accountKey) continue;
    const native = pt.marketValueNative ?? pt.totalValueNative;
    consider(
      pt.asOf,
      historyPointCad(native, pt.currency, usdCadRateForDate(payload, pt.asOf)),
    );
  }
  return best;
}

/**
 * BMV titres au début de période : prior de la 1re séance **couverte** (Disnat),
 * sinon historique projeté, sinon **premier point connu du compte** dans la période.
 *
 * Le 3e repli est indispensable pour « 3 ans » / « Total » : un compte ouvert après le
 * début de la période a une 1re séance avec `priorCad = 0` (jour d'ouverture) et aucun
 * point d'historique avant la borne → sans ce repli son BMV était `null` et **le compte
 * entier disparaissait du gain** (Total < 3 ans, ex. 74 208 $ vs 115 621 $).
 */
function accountBmvTitresCad(
  accountKey: string,
  payload: PerformanceIndicatorPayload,
  periodStart: string,
  baselineLookup: string,
  periodEnd: string,
): { valueCad: number; asOf: string } | null {
  const sessions = payload.sessionGainsByAccount?.[accountKey] ?? [];
  // Attention : la 1re séance d'un compte a souvent `priorCad = 0` (rien détenu la veille).
  const firstCoveredSession = sessions.find(
    (s) => s.date >= periodStart && s.priorCad > 0,
  );
  const latestAllowed = latestAllowedFirstSessionDate(periodStart);
  const historyHit = titresCadAtOrBefore([accountKey], payload, baselineLookup);

  if (
    firstCoveredSession &&
    firstCoveredSession.date <= latestAllowed
  ) {
    return {
      valueCad: cashAdjustedTitresCad(
        accountKey,
        payload,
        firstCoveredSession.priorCad,
        firstCoveredSession.date,
      ),
      asOf: firstCoveredSession.date,
    };
  }
  if (historyHit) {
    return { valueCad: historyHit.valueCad, asOf: historyHit.asOf };
  }
  // Compte suivi seulement à partir d'une date postérieure au début de période :
  // on prend son premier point connu **dans** la période (pas de BMV inventé).
  const firstPoint = earliestAccountTitresPointInRange(
    accountKey,
    payload,
    periodStart,
    periodEnd,
  );
  if (firstPoint) return firstPoint;
  if (firstCoveredSession) {
    return {
      valueCad: cashAdjustedTitresCad(
        accountKey,
        payload,
        firstCoveredSession.priorCad,
        firstCoveredSession.date,
      ),
      asOf: firstCoveredSession.date,
    };
  }
  return null;
}

/**
 * Si le 1er import de la période montre un portefeuille nettement plus élevé que le BMV titres
 * projeté (import manquant au début de période), la valeur importée sert de base $.
 * Le seuil est **neutre des apports** : on compare l'import au BMV projeté *augmenté des
 * cotisations/transferts reçus depuis la borne*, sinon toute période avec cotisations
 * déclenche le plancher et les apports sont comptés deux fois (régression AAJ).
 */
const IMPORT_BMV_FLOOR_RATIO = 1.2;

function firstImportMarketCadInPeriod(
  accountKey: string,
  payload: PerformanceIndicatorPayload,
  periodStart: string,
  periodEnd: string,
): { valueCad: number; asOf: string } | null {
  let best: { asOf: string; valueCad: number } | null = null;
  for (const pt of payload.snapshots ?? []) {
    if (pt.accountKey !== accountKey) continue;
    if (pt.asOf < periodStart || pt.asOf > periodEnd) continue;
    const native = pt.marketValueNative ?? pt.totalValueNative;
    const valueCad = historyPointCad(
      native,
      pt.currency,
      usdCadRateForDate(payload, pt.asOf),
    );
    if (!best || pt.asOf < best.asOf) {
      best = { asOf: pt.asOf, valueCad };
    }
  }
  return best;
}

/** BMV $ affiché : max(historique, prior séance), plancher import si ancrage tardif. */
function resolveBmvCadForPeriodGain(
  accountKey: string,
  payload: PerformanceIndicatorPayload,
  titresBmv: { valueCad: number; asOf: string },
  periodStart: string,
  periodEnd: string,
  baselineLookup: string,
): number {
  const historyHit =
    titresCadFullCoverageAtOrBefore(
      [accountKey],
      payload,
      baselineLookup,
    ) ?? titresCadAtOrBefore([accountKey], payload, baselineLookup);
  const historyCad = historyHit?.valueCad ?? titresBmv.valueCad;
  const anchorCad = Math.max(titresBmv.valueCad, historyCad);

  const isCalendarYtdStart = periodStart.endsWith("-01-01");
  const importHit = firstImportMarketCadInPeriod(
    accountKey,
    payload,
    periodStart,
    periodEnd,
  );
  const hasSnapAtBaseline = (payload.snapshots ?? []).some(
    (pt) => pt.accountKey === accountKey && pt.asOf <= baselineLookup,
  );

  // Seuil marché-seulement (comme `importHit`) et **hors apports** : sans ça, un portefeuille
  // qui reçoit des cotisations dans la période paraît « nettement plus élevé » et le BMV est
  // remplacé à tort (cf. performance-contributions-disnat.test.ts, AAJ 5KFZEZ2).
  const historyCadMarketOnly =
    (titresCadFullCoverageAtOrBefore([accountKey], payload, baselineLookup, {
      includeCash: false,
    })?.valueCad ??
      titresCadAtOrBefore([accountKey], payload, baselineLookup, {
        includeCash: false,
      })?.valueCad) ??
    historyCad;

  if (
    isCalendarYtdStart &&
    !hasSnapAtBaseline &&
    importHit &&
    importHit.asOf > baselineLookup &&
    importHit.valueCad >
      (historyCadMarketOnly +
        netExternalFlowsCad(
          payload.cashFlows,
          [accountKey],
          addCalendarDays(baselineLookup, 1),
          importHit.asOf,
        )) *
        IMPORT_BMV_FLOOR_RATIO
  ) {
    // Base marché uniquement : l'EMV utilisé pour le gain est lui aussi marché uniquement,
    // donc on n'injecte pas l'encaisse du snapshot dans une base titres.
    return importHit.valueCad;
  }

  return anchorCad;
}

/** BMV agrégée (somme des comptes) pour Dietz / affichage. */
function aggregateBmvTitresCad(
  accountKeys: string[],
  payload: PerformanceIndicatorPayload,
  periodStart: string,
  baselineLookup: string,
  periodEnd: string,
): { valueCad: number; asOf: string } | null {
  if (accountKeys.length === 0) return null;
  let total = 0;
  let asOf = baselineLookup;
  for (const key of accountKeys) {
    const hit = accountBmvTitresCad(
      key,
      payload,
      periodStart,
      baselineLookup,
      periodEnd,
    );
    if (!hit) return null;
    total += hit.valueCad;
    if (hit.asOf < asOf) asOf = hit.asOf;
  }
  return { valueCad: total, asOf };
}

/** EMV titres pour gain $ : clôture historique (pas le live en séance). */
function resolveAccountEmvTitresCad(
  accountKey: string,
  payload: PerformanceIndicatorPayload,
  endDate: string,
): number | null {
  const hist =
    titresCadAtPeriodEnd([accountKey], payload, endDate)?.valueCad ??
    titresCadFullCoverageAtOrBefore([accountKey], payload, endDate)?.valueCad ??
    null;
  if (hist != null) return hist;
  const live = payload.currentByAccount[accountKey]?.positionsCad ?? 0;
  return live > 0 ? cashAdjustedTitresCad(accountKey, payload, live, endDate) : null;
}

/** Gain $ titres classique = EMV − BMV − flux (séance, mois, total, etc.). */
function accountLegacyTitresGainCad(
  accountKey: string,
  payload: PerformanceIndicatorPayload,
  bounds: { start: string; end: string; baselineLookup: string | null },
): { gainCad: number; baselineCad: number } | null {
  const lookup =
    bounds.baselineLookup ?? baselineBeforePeriodStart(bounds.start);
  const bmv = accountBmvTitresCad(
    accountKey,
    payload,
    bounds.start,
    lookup,
    bounds.end,
  );
  const emvCad = resolveAccountEmvTitresCad(accountKey, payload, bounds.end);
  if (!bmv || emvCad == null) return null;

  const sumFlows = netExternalFlowsCad(
    payload.cashFlows,
    [accountKey],
    bounds.start,
    bounds.end,
  );
  const bmvCadForGain = resolveBmvCadForPeriodGain(
    accountKey,
    payload,
    bmv,
    bounds.start,
    bounds.end,
    lookup,
  );
  return {
    gainCad: emvCad - bmvCadForGain - sumFlows,
    baselineCad: bmvCadForGain + sumFlows,
  };
}

/**
 * Gain $ affiché = Σ par compte (EMV − BMV − flux), additif et aligné sur le tableau Disnat.
 * `baselineCad` (Σ BMV + apports) permet de recalculer un % sur **la même base** que le $
 * quand la méthode de rendement résolue produit un résultat incohérent (signe opposé).
 */
function sumPerAccountDisplayGainCad(
  materialKeys: string[],
  payload: PerformanceIndicatorPayload,
  bounds: { start: string; end: string; baselineLookup: string | null },
  periodId: PerformancePeriodId,
): {
  gainCad: number | null;
  baselineCad: number | null;
  accountsWithBaseline: number;
  /** Comptes dont le BMV est postérieur au début de période (historique plus récent). */
  lateBaselineAccounts: number;
  incomplete: boolean;
} {
  const lookup =
    bounds.baselineLookup ?? baselineBeforePeriodStart(bounds.start);
  let total = 0;
  let totalBaseline = 0;
  let count = 0;
  let lateBaselineAccounts = 0;
  let incomplete = false;

  for (const key of materialKeys) {
    const sessions =
      periodId === "all"
        ? [...(payload.sessionGainsByAccount?.[key] ?? [])]
        : (payload.sessionGainsByAccount?.[key] ?? []).filter(
            (g) => g.date >= bounds.start && g.date <= bounds.end,
          );

    const dollars = accountLegacyTitresGainCad(key, payload, bounds);

    if (dollars == null || !Number.isFinite(dollars.gainCad)) {
      incomplete = true;
      continue;
    }

    total += dollars.gainCad;
    totalBaseline += dollars.baselineCad;
    count++;

    const bmv = accountBmvTitresCad(
      key,
      payload,
      bounds.start,
      lookup,
      bounds.end,
    );
    // En 3 ans / total, l'absence de sessions sur un compte ne rend pas
    // forcément le résultat partiel si les bornes titres sont complètes.
    if (sessions.length === 0 && periodId !== "year3" && periodId !== "all") {
      incomplete = true;
    }
    if (bmv && bmv.asOf > latestAllowedFirstSessionDate(bounds.start)) {
      incomplete = true;
      lateBaselineAccounts++;
    }
  }

  return {
    gainCad: count > 0 ? total : null,
    baselineCad: count > 0 && totalBaseline > 0 ? totalBaseline : null,
    accountsWithBaseline: count,
    lateBaselineAccounts,
    incomplete,
  };
}

/** Gain titres d'un compte = EMV − BMV − flux (aligné Dietz / Disnat $). */
function computeAccountTitresPeriodGain(
  accountKey: string,
  payload: PerformanceIndicatorPayload,
  bounds: { start: string; end: string; baselineLookup: string | null },
): {
  usable: boolean;
  gainCad: number | null;
  baselineCad: number | null;
  baselineDate: string | null;
  incomplete: boolean;
} {
  const lookup =
    bounds.baselineLookup ?? baselineBeforePeriodStart(bounds.start);
  const bmv = accountBmvTitresCad(
    accountKey,
    payload,
    bounds.start,
    lookup,
    bounds.end,
  );
  const emvCad = resolveAccountEmvTitresCad(accountKey, payload, bounds.end);

  if (!bmv || emvCad == null) {
    return {
      usable: false,
      gainCad: null,
      baselineCad: null,
      baselineDate: null,
      incomplete: true,
    };
  }

  const netFlows = netExternalFlowsCad(
    payload.cashFlows,
    [accountKey],
    bounds.start,
    bounds.end,
  );
  const bmvCadForGain = resolveBmvCadForPeriodGain(
    accountKey,
    payload,
    bmv,
    bounds.start,
    bounds.end,
    lookup,
  );
  const gainCad = emvCad - bmvCadForGain - netFlows;
  const baselineCad = bmv.valueCad + netFlows;
  const endHist = titresCadFullCoverageAtOrBefore(
    [accountKey],
    payload,
    bounds.end,
  );
  const incomplete =
    bmv.asOf > latestAllowedFirstSessionDate(bounds.start) || endHist == null;

  return {
    usable: true,
    gainCad,
    baselineCad: baselineCad > 0 ? baselineCad : null,
    baselineDate: lookup,
    incomplete,
  };
}

/**
 * Gain titres = Δ valeur de marché − flux nets (cotisations / retraits).
 * Agrégé par somme compte par compte (comme le tableau Disnat).
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

  let gainCad = 0;
  let baselineCad = 0;
  let accountsWithBaseline = 0;
  let incomplete = false;
  const periodBounds = {
    start: bounds.start,
    end: bounds.end,
    baselineLookup: bounds.baselineLookup,
  };

  for (const key of materialKeys) {
    const hit = computeAccountTitresPeriodGain(key, payload, periodBounds);
    if (!hit.usable || hit.gainCad === null) {
      incomplete = true;
      continue;
    }
    gainCad += hit.gainCad;
    if (hit.baselineCad != null) baselineCad += hit.baselineCad;
    accountsWithBaseline++;
    if (hit.incomplete) incomplete = true;
  }

  if (accountsWithBaseline === 0) {
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

  const gainPct =
    baselineCad > 0 && Number.isFinite(gainCad)
      ? (gainCad / baselineCad) * 100
      : null;

  return {
    usable: true,
    gainCad,
    gainPct,
    baselineCad: baselineCad > 0 ? baselineCad : null,
    baselineDate: lookup,
    accountsWithBaseline,
    incomplete,
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

/** $ affiché : montant de période privilégié selon la meilleure couverture. */
function pickPeriodGainCad(params: {
  ret: PeriodReturnPercent;
  displayGainCad: number | null;
  gainCadFromPct: number | null;
  portfolioDietzNumerator: number | null;
  sessionGainCad: number;
  periodId: PerformancePeriodId;
}): number | null {
  const {
    ret,
    displayGainCad,
    gainCadFromPct,
    portfolioDietzNumerator,
    sessionGainCad,
    periodId,
  } = params;

  if (ret.annualized && gainCadFromPct != null) return gainCadFromPct;

  if (periodId === "month" || periodId === "month3" || periodId === "year") {
    return (
      displayGainCad ??
      portfolioDietzNumerator ??
      gainCadFromPct ??
      sessionGainCad
    );
  }

  return (
    displayGainCad ??
    gainCadFromPct ??
    portfolioDietzNumerator ??
    sessionGainCad
  );
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
  incompleteReason: string | null;
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
      incompleteReason: SESSION_GAINS_UNAVAILABLE_NOTE,
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
      incompleteReason: "P&L disponible uniquement sur les comptes Disnat.",
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
      incompleteReason: joinNotes(
        "Historique titres indisponible pour cette période.",
        payload.sessionDataHealth.message ?? SESSION_GAINS_UNAVAILABLE_NOTE,
      ),
      annualized: false,
      note: joinNotes(
        "Historique titres indisponible pour cette période.",
        payload.sessionDataHealth.message ?? SESSION_GAINS_UNAVAILABLE_NOTE,
      ),
    };
  }

  let sessionGainCad = sessions.reduce((s, g) => s + g.gainCad, 0);

  // En séance ouverte, remplace le P&L persisté du jour par le P&L live (repli seulement).
  const now = sessionClockForBounds(payload.asOfNow);
  const refDay = isoDate(referenceTradingSessionDay(now));
  const endIsToday = bounds.end === refDay;
  if (
    endIsToday &&
    periodId !== "yesterday" &&
    canUseLiveValuesForAsOf(payload) &&
    isEquityMarketSessionOpen(now)
  ) {
    const chainToday = sessions.find((g) => g.date === refDay);
    const liveToday = sumLiveDayGainCad(accountKeys, payload);
    if (chainToday) sessionGainCad -= chainToday.gainCad;
    sessionGainCad += liveToday;
  }

  const titresCalc = computeTitresPeriodGain(accountKeys, payload, bounds);

  const lookup =
    bounds.baselineLookup ?? baselineBeforePeriodStart(bounds.start!);
  const materialKeys = disnatTitresMaterialKeys(
    disnatKeys,
    payload,
    lookup,
    bounds.end,
  );
  const baselineHit =
    aggregateBmvTitresCad(
      materialKeys,
      payload,
      bounds.start!,
      lookup,
      bounds.end,
    ) ?? titresCadFullCoverageAtOrBefore(materialKeys, payload, lookup);
  const endHit = titresCadAtPeriodEnd(materialKeys, payload, bounds.end);
  const boundaryCoverageComplete = baselineHit != null && endHit != null;
  const dietzBmv =
    periodId === "month3"
      ? (titresCadFullCoverageAtOrBefore(materialKeys, payload, lookup)?.valueCad ??
        baselineHit?.valueCad ??
        null)
      : (baselineHit?.valueCad ?? null);

  const ret = resolvePeriodReturnPercent({
    sessions,
    periodStart: bounds.start!,
    periodEnd: bounds.end,
    bmv: dietzBmv,
    emv: endHit?.valueCad ?? null,
    boundaryCoverageComplete,
    flows: payload.cashFlows,
    accountKeys: materialKeys,
    periodId,
  });

  const sessionsIncomplete =
    periodId !== "all" &&
    bounds.start != null &&
    sessions[0]!.date > latestAllowedFirstSessionDate(bounds.start);
  const boundaryIncomplete = !boundaryCoverageComplete;

  const displayGain = sumPerAccountDisplayGainCad(
    materialKeys,
    payload,
    {
      start: bounds.start!,
      end: bounds.end,
      baselineLookup: bounds.baselineLookup,
    },
    periodId,
  );

  const portfolioDietzNumerator =
    boundaryCoverageComplete && baselineHit != null && endHit != null
      ? endHit.valueCad -
        baselineHit.valueCad -
        weightedExternalFlowsForDietz(
          payload.cashFlows,
          materialKeys,
          bounds.start!,
          bounds.end,
        ).sumFlows
      : null;

  const gainCadFromPct = gainCadFromPeriodReturn(
    ret,
    bounds.start!,
    bounds.end,
  );

  const gainCad = pickPeriodGainCad({
    ret,
    displayGainCad: displayGain.gainCad,
    gainCadFromPct,
    portfolioDietzNumerator,
    sessionGainCad,
    periodId,
  });

  // Cohérence $ / % : le $ affiché est Σ(EMV − BMV − apports) par compte (additif, aligné
  // Disnat) et le % Dietz partage le **même numérateur**. Quand les deux divergent de signe
  // (plancher BMV, choix de BMV par compte…), on recalcule le % sur la base du $.
  // On ne touche pas au TWR : un $ positif avec un % négatif y est légitime (grosse
  // cotisation dans un mois baissier).
  let gainPct = ret.gainPct;
  let annualized = ret.annualized;
  let baselineCad = ret.baselineCad ?? titresCalc.baselineCad;
  const signMismatch =
    ret.algorithm === "modified-dietz" &&
    gainCad != null &&
    gainPct != null &&
    Math.abs(gainCad) >= 1 &&
    Math.abs(gainPct) >= 0.01 &&
    Math.sign(gainCad) !== Math.sign(gainPct);
  if (signMismatch) {
    const coherentBase =
      displayGain.baselineCad != null && displayGain.baselineCad > 0
        ? displayGain.baselineCad
        : titresCalc.baselineCad;
    if (coherentBase != null && coherentBase > 0) {
      gainPct = (gainCad / coherentBase) * 100;
      annualized = false;
      baselineCad = coherentBase;
    }
  }

  const incomplete =
    displayGain.gainCad != null
      ? displayGain.incomplete
      : periodId === "all"
        ? boundaryIncomplete
        : sessionsIncomplete || boundaryIncomplete;

  const netFlowsCad = netExternalFlowsCad(
    payload.cashFlows,
    materialKeys,
    bounds.start!,
    bounds.end,
  );

  return {
    usable: true,
    gainCad,
    gainPct,
    currentCad,
    baselineCad,
    baselineDate:
      titresCalc.baselineDate ??
      baselineHit?.asOf ??
      sessions[0]?.date ??
      bounds.baselineLookup,
    accountsWithBaseline:
      displayGain.accountsWithBaseline > 0
        ? displayGain.accountsWithBaseline
        : boundaryCoverageComplete
          ? materialKeys.length
          : 0,
    incomplete,
    incompleteReason: incomplete
      ? joinNotes(
          displayGain.lateBaselineAccounts > 0
            ? `Historique de ${displayGain.lateBaselineAccounts} compte(s) plus récent que le début de la période : leur gain est mesuré depuis leur première valeur connue.`
            : null,
          displayGain.gainCad != null &&
            displayGain.accountsWithBaseline > 0 &&
            displayGain.accountsWithBaseline < materialKeys.length
            ? `Couverture partielle : ${materialKeys.length - displayGain.accountsWithBaseline} compte(s) sans valeur exploitable sur la période.`
            : null,
          sessionsIncomplete
            ? "Séances incomplètes sur la période (première séance tardive)."
            : null,
          boundaryIncomplete
            ? "Historique titres incomplet aux bornes de la période."
            : null,
          payload.sessionDataHealth.ok
            ? null
            : (payload.sessionDataHealth.message ?? SESSION_GAINS_UNAVAILABLE_NOTE),
        ) ?? "Données partielles."
      : null,
    annualized,
    // `note` = information normale (apports), jamais une alerte de qualité de données.
    note:
      Math.abs(netFlowsCad) >= 0.01
        ? formatFlowAdjustmentNote(netFlowsCad)
        : null,
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

  const sessionHealthNote =
    payload.sessionDataHealth.message ?? SESSION_GAINS_UNAVAILABLE_NOTE;

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
      incompleteReason: SESSION_GAINS_UNAVAILABLE_NOTE,
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
      note: joinNotes(
        !payload.sessionDataHealth.ok ? sessionHealthNote : null,
        calc.note ?? SESSION_GAINS_UNAVAILABLE_NOTE,
      ),
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
    incomplete: calc.incomplete || !payload.sessionDataHealth.ok,
    incompleteReason: joinNotes(
      !payload.sessionDataHealth.ok ? sessionHealthNote : null,
      calc.incompleteReason,
    ),
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
    | "portfolioKey"
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
    filters.portfolioKey ?? null,
    payload.portfolioScopes ?? [],
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
    | "portfolioKey"
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

/** Recalcule en live ; les snapshots DB servent uniquement au rebuild / audit. */
export function computePeriodResultWithSnapshots(
  payload: PerformanceIndicatorPayload,
  filters: PerformanceFilterState,
  periodId: PerformancePeriodId,
): PerformancePeriodResult {
  return computePeriodResult(payload, filters, periodId);
}

export function computeAllPeriodResultsWithSnapshots(
  payload: PerformanceIndicatorPayload,
  filters: Pick<
    PerformanceFilterState,
    | "preset"
    | "owner"
    | "portfolioKey"
    | "includedAccountKeys"
    | "excludedAccountKeys"
    | "selectedYear"
    | "activePeriod"
  >,
): PerformancePeriodResult[] {
  return computeAllPeriodResults(payload, filters);
}

export function defaultPerformanceFilters(
  payload: PerformanceIndicatorPayload,
): PerformanceFilterState {
  const currentYear = parseIsoDate(payload.asOfNow).getFullYear();
  return {
    preset: "all",
    owner: null,
    portfolioKey: null,
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
