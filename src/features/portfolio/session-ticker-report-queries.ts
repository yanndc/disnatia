import { prisma } from "@/lib/db/prisma";
import {
  loadUsdCadRateMap,
  usdCadRateOnDate,
} from "@/lib/fx/usd-cad-rate-map";
import {
  isoDateInToronto,
  isEquityMarketSessionOpen,
  isTradingDayDate,
  priorReferenceSessionDateIso,
  previousTradingDayIso,
  referenceTradingSessionDayIso,
  resolveDayPeriodLabels,
} from "@/lib/market/equity-session";
import { sessionGainFromPriorQuantity } from "./performance-session-gains";
import { quotesAreStale } from "@/features/portfolio/refresh-live-quotes";
import { normalizeCurrency } from "@/lib/utils";
import {
  ensureDailyClosesPersistedForPairs,
  loadDailyCloseMap,
} from "./daily-close-prices";
import { parseIsoDateLocal } from "./daily-close-key";
import {
  closeOnOrBefore,
  priorCloseDateForSeries,
} from "./performance-history-loader";
import { ensureDailyHoldingsUpToDate } from "./backfill-market-history";
import { checkSessionDataIntegrity } from "./session-data-integrity";
import type {
  PerformanceEnrichedHoldingRow,
  PerformanceIndicatorPayload,
  PerformanceSessionDataHealth,
} from "./performance-indicator-types";

export type SessionTickerRow = {
  ticker: string;
  securityName: string;
  currency: string;
  /** Variation $ / action (devise du titre). */
  changePerShare: number;
  /** P&L de la séance en CAD (toutes positions du symbole). */
  dayGainCad: number;
};

export type SessionTickerLists = {
  gainers: SessionTickerRow[];
  losers: SessionTickerRow[];
};

export type SessionTickerView = {
  sessionDate: string;
  sessionLabel: string;
  lists: SessionTickerLists;
  /** Total P&L titres — même source que « Séance préc. » (session_gains persistés). */
  totalGainCad: number | null;
  diagnostics?: SessionTickerDiagnostics;
};

export type SessionTickerHistoryPoint = {
  sessionDate: string;
  totalGainCad: number;
  isLive: boolean;
};

export type SessionTickerDiagnostics = {
  processing: string[];
  attemptedHoldingsRepair: boolean;
};

type BuildSessionTickerOptions = {
  repairHoldingsIfMissing?: boolean;
  nowForRepair?: Date;
};

export class SessionTickerDataError extends Error {
  readonly code: "HOLDINGS_MISSING";
  readonly diagnostics: SessionTickerDiagnostics;

  constructor(message: string, diagnostics: SessionTickerDiagnostics) {
    super(message);
    this.name = "SessionTickerDataError";
    this.code = "HOLDINGS_MISSING";
    this.diagnostics = diagnostics;
  }
}

/** Nombre max de séances ouvrées navigables en arrière. */
export const SESSION_TICKER_MAX_LOOKBACK_DAYS = 252;

export type SessionTickerMiniReport = {
  view: SessionTickerView;
  maxSessionDate: string;
  minSessionDate: string;
  history: SessionTickerHistoryPoint[];
  /** Même diagnostic que la carte Performance dynamique. */
  sessionDataHealth: PerformanceSessionDataHealth;
  /** Date « Séance préc. » dans Performance (séance complétée avant la référence). */
  previousSessionDate: string;
};

function toCad(
  value: number,
  currency: string,
  usdToCad: number | null,
): number {
  const cur = normalizeCurrency(currency);
  if (cur === "USD" && usdToCad !== null) return value * usdToCad;
  return value;
}

function positionKey(
  accountKey: string,
  ticker: string,
  currency: string,
): string {
  return `${accountKey}|${ticker.toUpperCase()}|${normalizeCurrency(currency)}`;
}

/** Σ gains persistés pour une séance — aligné carte Performance. */
export function sumPersistedSessionGainCad(
  payload: PerformanceIndicatorPayload,
  sessionDate: string,
  accountKeys: string[],
): number | null {
  let total = 0;
  let found = false;
  for (const accountKey of accountKeys) {
    const hit = payload.sessionGainsByAccount?.[accountKey]?.find(
      (g) => g.date === sessionDate,
    );
    if (hit) {
      total += hit.gainCad;
      found = true;
    }
  }
  return found ? total : null;
}

/** P&L séance live — même source que « Aujourd'hui » dans Performance. */
function sumLiveDayGainCad(
  payload: PerformanceIndicatorPayload,
  accountKeys: string[],
): number | null {
  let total = 0;
  let found = false;
  for (const accountKey of accountKeys) {
    const cur = payload.currentByAccount[accountKey];
    if (!cur || cur.dayGainCad === null || !Number.isFinite(cur.dayGainCad)) continue;
    total += cur.dayGainCad;
    found = true;
  }
  return found ? total : null;
}

type TickerBucket = {
  ticker: string;
  securityName: string;
  currency: string;
  quantity: number;
  gainNative: number;
};

function pickSecurityName(current: string, next: string | null | undefined): string {
  const n = (next ?? "").trim();
  if (!current && n) return n;
  if (n.length > current.length) return n;
  return current || n;
}

function finalizeBuckets(
  buckets: Map<string, TickerBucket>,
  usdToCad: number | null,
): SessionTickerRow[] {
  const rows: SessionTickerRow[] = [];
  for (const b of buckets.values()) {
    if (b.quantity <= 0 || b.gainNative === 0) continue;
    rows.push({
      ticker: b.ticker,
      securityName: b.securityName || b.ticker,
      currency: b.currency,
      changePerShare: b.gainNative / b.quantity,
      dayGainCad: toCad(b.gainNative, b.currency, usdToCad),
    });
  }
  return rows;
}

function tickerRowKey(row: SessionTickerRow): string {
  return `${row.ticker}|${row.currency}`;
}

function mergeSessionTickerRows(
  primary: SessionTickerRow[],
  fallback: SessionTickerRow[],
): SessionTickerRow[] {
  const byKey = new Map<string, SessionTickerRow>();
  for (const row of fallback) {
    byKey.set(tickerRowKey(row), row);
  }
  for (const row of primary) {
    byKey.set(tickerRowKey(row), row);
  }
  return [...byKey.values()];
}

function enrichedHasSessionPnl(
  rows: PerformanceEnrichedHoldingRow[] | undefined,
): boolean {
  return (rows ?? []).some(
    (r) => r.displayDayGainLoss !== null && r.displayDayGainLoss !== 0,
  );
}

/** Cours du jour utilisables pour la séance courante (pas seulement 9 h 30–16 h). */
function shouldUseLiveForCurrentSession(
  payload: PerformanceIndicatorPayload,
  now: Date,
): boolean {
  if (isEquityMarketSessionOpen(now)) return true;

  const refDay = referenceTradingSessionDayIso(now);
  const today = isoDateInToronto(now);
  if (refDay !== today) return false;

  if (enrichedHasSessionPnl(payload.enrichedHoldings)) return true;

  if (!payload.quotesAsOf) return false;
  const fetchedAt = new Date(payload.quotesAsOf);
  if (Number.isNaN(fetchedAt.getTime())) return false;
  if (isoDateInToronto(fetchedAt) !== today) return false;
  return !quotesAreStale(fetchedAt, 24 * 60, now.getTime());
}

function splitGainersLosers(rows: SessionTickerRow[]): SessionTickerLists {
  return {
    gainers: rows
      .filter((r) => r.dayGainCad > 0)
      .toSorted((a, b) => b.dayGainCad - a.dayGainCad),
    losers: rows
      .filter((r) => r.dayGainCad < 0)
      .toSorted((a, b) => a.dayGainCad - b.dayGainCad),
  };
}

function closeSeriesForPair(
  dailyCloses: Record<string, number>,
  ticker: string,
  currency: string,
): Map<string, number> {
  const series = new Map<string, number>();
  const t = ticker.toUpperCase();
  const c = normalizeCurrency(currency);
  for (const [key, close] of Object.entries(dailyCloses)) {
    const parts = key.split("|");
    if (parts.length !== 3) continue;
    if (parts[0] === t && parts[1] === c && parts[2]) {
      series.set(parts[2], close);
    }
  }
  return series;
}

function aggregateFromEnriched(
  rows: PerformanceEnrichedHoldingRow[],
  usdToCad: number | null,
): SessionTickerRow[] {
  const buckets = new Map<string, TickerBucket>();

  for (const h of rows) {
    const delta = h.quoteChangePerShare;
    const gain = h.displayDayGainLoss;
    if (delta === null || gain === null || gain === 0) continue;

    const key = `${h.ticker}|${h.currency}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.quantity += h.quantity;
      existing.gainNative += gain;
      existing.securityName = pickSecurityName(existing.securityName, h.securityName);
    } else {
      buckets.set(key, {
        ticker: h.ticker,
        securityName: h.securityName,
        currency: h.currency,
        quantity: h.quantity,
        gainNative: gain,
      });
    }
  }

  return finalizeBuckets(buckets, usdToCad);
}

async function loadHoldingsForSessionDate(
  sessionDate: string,
  accountKeys: string[],
) {
  if (!isTradingDayDate(sessionDate) || accountKeys.length === 0) return [];

  const sessionDay = parseIsoDateLocal(sessionDate);
  const exact = await prisma.portfolioDailyHolding.findMany({
    where: {
      holdingDate: sessionDay,
      accountKey: { in: accountKeys },
      quantity: { gt: 0 },
    },
    select: {
      accountKey: true,
      ticker: true,
      securityName: true,
      currency: true,
      quantity: true,
    },
  });
  if (exact.length > 0) return exact;

  return [];
}

async function loadHoldingsForSessionWindow(
  sessionDate: string,
  accountKeys: string[],
): Promise<{
  holdings: Awaited<ReturnType<typeof loadHoldingsForSessionDate>>;
  priorHoldings: Awaited<ReturnType<typeof loadHoldingsForSessionDate>>;
  priorSessionDate: string;
}> {
  const priorSessionDate = previousTradingDayIso(sessionDate, 1);
  const [holdings, priorHoldings] = await Promise.all([
    loadHoldingsForSessionDate(sessionDate, accountKeys),
    loadHoldingsForSessionDate(priorSessionDate, accountKeys),
  ]);
  return { holdings, priorHoldings, priorSessionDate };
}

async function ensureHoldingsForSessionWindow(
  sessionDate: string,
  accountKeys: string[],
  options?: BuildSessionTickerOptions,
): Promise<{
  holdings: Awaited<ReturnType<typeof loadHoldingsForSessionDate>>;
  priorHoldings: Awaited<ReturnType<typeof loadHoldingsForSessionDate>>;
  diagnostics: SessionTickerDiagnostics;
}> {
  const processing: string[] = [];
  const initial = await loadHoldingsForSessionWindow(sessionDate, accountKeys);
  if (initial.holdings.length > 0 && initial.priorHoldings.length > 0) {
    return {
      holdings: initial.holdings,
      priorHoldings: initial.priorHoldings,
      diagnostics: { processing, attemptedHoldingsRepair: false },
    };
  }

  if (!options?.repairHoldingsIfMissing) {
    return {
      holdings: [],
      priorHoldings: [],
      diagnostics: {
        processing: [
          `Holdings absents pour ${sessionDate} et/ou ${initial.priorSessionDate}.`,
          "Aucun fallback vers une date antérieure n'est autorisé.",
        ],
        attemptedHoldingsRepair: false,
      },
    };
  }

  processing.push(
    `Holdings absents pour ${sessionDate} ou ${initial.priorSessionDate}: tentative de mise à jour persistante.`,
  );
  await ensureDailyHoldingsUpToDate(options.nowForRepair ?? new Date());

  const afterRepair = await loadHoldingsForSessionWindow(sessionDate, accountKeys);
  if (afterRepair.holdings.length > 0 && afterRepair.priorHoldings.length > 0) {
    processing.push("Mise à jour holdings complétée et validée pour la séance demandée.");
    return {
      holdings: afterRepair.holdings,
      priorHoldings: afterRepair.priorHoldings,
      diagnostics: { processing, attemptedHoldingsRepair: true },
    };
  }

  const integrity = await checkSessionDataIntegrity(sessionDate);
  processing.push("Mise à jour holdings incomplète après tentative de réparation.");
  throw new SessionTickerDataError(
    `Holdings incomplets après réparation pour ${sessionDate}.`,
    {
      processing: [
        ...processing,
        ...integrity.issues.map((issue) => `Intégrité: ${issue}`),
      ],
      attemptedHoldingsRepair: true,
    },
  );
}

async function aggregateFromDailyHoldings(
  sessionDate: string,
  accountKeys: string[],
  dailyCloses: Record<string, number>,
  usdToCad: number | null,
  options?: BuildSessionTickerOptions,
): Promise<{ rows: SessionTickerRow[]; diagnostics: SessionTickerDiagnostics }> {
  if (!isTradingDayDate(sessionDate) || accountKeys.length === 0) {
    return {
      rows: [],
      diagnostics: { processing: [], attemptedHoldingsRepair: false },
    };
  }

  const { holdings, priorHoldings, diagnostics } = await ensureHoldingsForSessionWindow(
    sessionDate,
    accountKeys,
    options,
  );

  const fxFrom = previousTradingDayIso(sessionDate, 14);
  const rateMap = await loadUsdCadRateMap(fxFrom, sessionDate);
  const sessionFx = usdCadRateOnDate(rateMap, sessionDate) ?? usdToCad;

  const qtyAtOpen = new Map<string, number>();
  for (const h of priorHoldings) {
    const key = positionKey(h.accountKey, h.ticker, h.currency);
    qtyAtOpen.set(key, (qtyAtOpen.get(key) ?? 0) + h.quantity);
  }

  const buckets = new Map<string, TickerBucket>();

  for (const h of holdings) {
    const ticker = h.ticker.toUpperCase();
    const currency = normalizeCurrency(h.currency);
    const seriesKey = `${ticker}|${currency}`;
    const posKey = positionKey(h.accountKey, ticker, currency);
    const series = closeSeriesForPair(dailyCloses, ticker, currency);
    if (series.size === 0) continue;

    const endClose = closeOnOrBefore(series, sessionDate);
    const priorDate = priorCloseDateForSeries(sessionDate, series);
    if (endClose == null || priorDate == null) continue;
    const baseClose = series.get(priorDate);
    if (baseClose == null || baseClose <= 0) continue;

    const qtyHeld = qtyAtOpen.get(posKey) ?? 0;
    if (qtyHeld <= 0) continue;

    const { gainNative } = sessionGainFromPriorQuantity(qtyHeld, endClose, baseClose);
    if (gainNative === 0) continue;

    const existing = buckets.get(seriesKey);
    if (existing) {
      existing.quantity += qtyHeld;
      existing.gainNative += gainNative;
      existing.securityName = pickSecurityName(existing.securityName, h.securityName);
    } else {
      buckets.set(seriesKey, {
        ticker,
        securityName: (h.securityName ?? "").trim() || ticker,
        currency,
        quantity: qtyHeld,
        gainNative,
      });
    }
  }

  return { rows: finalizeBuckets(buckets, sessionFx), diagnostics };
}

export function parsePayloadClock(asOfNow: string): Date {
  const raw = asOfNow.trim();
  if (raw.includes("T")) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }

  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const local = new Date(y, m - 1, d);
    if (
      !Number.isNaN(local.getTime()) &&
      local.getFullYear() === y &&
      local.getMonth() === m - 1 &&
      local.getDate() === d
    ) {
      local.setHours(15, 0, 0, 0);
      return local;
    }
  }

  return new Date();
}

function resolveSessionLabel(
  sessionDate: string,
  now: Date,
  useLive: boolean,
): string {
  const refSessionDate = referenceTradingSessionDayIso(now);
  const yesterday = previousTradingDayIso(refSessionDate, 1);
  const dayBeforeYesterday = previousTradingDayIso(refSessionDate, 2);

  if (sessionDate === refSessionDate) {
    if (useLive) return resolveDayPeriodLabels(now).label;
    return "Dernière séance";
  }
  if (sessionDate === yesterday) return "Hier";
  if (sessionDate === dayBeforeYesterday) return "Avant-hier";

  const [y, m, d] = sessionDate.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("fr-CA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "America/Toronto",
  });
}

function disnatAccountKeysFromPayload(payload: PerformanceIndicatorPayload): string[] {
  return payload.accounts.filter((a) => !a.isExternal).map((a) => a.accountKey);
}

function buildSessionTickerHistory(
  payload: PerformanceIndicatorPayload,
  now: Date,
  lookbackDays = 30,
): SessionTickerHistoryPoint[] {
  const maxSessionDate = referenceTradingSessionDayIso(now);
  const minSessionDate = previousTradingDayIso(maxSessionDate, lookbackDays - 1);
  const disnatAccountKeys = disnatAccountKeysFromPayload(payload);
  const totalsByDate = new Map<string, number>();

  for (const accountKey of disnatAccountKeys) {
    for (const gain of payload.sessionGainsByAccount[accountKey] ?? []) {
      if (gain.date < minSessionDate || gain.date > maxSessionDate) continue;
      totalsByDate.set(gain.date, (totalsByDate.get(gain.date) ?? 0) + gain.gainCad);
    }
  }

  const useLive = shouldUseLiveForCurrentSession(payload, now);
  const liveTotal = useLive ? sumLiveDayGainCad(payload, disnatAccountKeys) : null;
  if (liveTotal !== null) {
    totalsByDate.set(maxSessionDate, liveTotal);
  }

  return [...totalsByDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-lookbackDays)
    .map(([sessionDate, totalGainCad]) => ({
      sessionDate,
      totalGainCad,
      isLive: useLive && sessionDate === maxSessionDate,
    }));
}

function holdingPairsFromPayload(payload: PerformanceIndicatorPayload) {
  return [
    ...new Map(
      (payload.holdings ?? []).map((h) => [
        `${h.ticker}|${h.currency}`,
        { ticker: h.ticker, currency: h.currency },
      ]),
    ).values(),
  ];
}

/** Charge assez d'historique de clôtures pour calculer le P&L d'une séance passée. */
async function resolveDailyClosesForSessionDate(
  payload: PerformanceIndicatorPayload,
  sessionDate: string,
): Promise<Record<string, number>> {
  const pairs = holdingPairsFromPayload(payload);
  const merged: Record<string, number> = { ...payload.dailyCloses };
  if (pairs.length === 0) return merged;

  const priorDate = previousTradingDayIso(sessionDate, 1);
  const fromDate = previousTradingDayIso(sessionDate, 12);
  const todayIso = isoDateInToronto(new Date());
  const toDate = sessionDate > todayIso ? todayIso : sessionDate;

  await ensureDailyClosesPersistedForPairs(pairs, [sessionDate, priorDate]);

  const closeMap = await loadDailyCloseMap(pairs, fromDate, toDate);
  for (const [key, value] of closeMap) {
    merged[key] = value;
  }

  return merged;
}

export async function buildSessionTickerViewForDate(
  payload: PerformanceIndicatorPayload,
  sessionDate: string,
  now = parsePayloadClock(payload.asOfNow),
  options?: BuildSessionTickerOptions,
): Promise<SessionTickerView> {
  const refSessionDate = referenceTradingSessionDayIso(now);
  const disnatAccountKeys = disnatAccountKeysFromPayload(payload);
  const useLive =
    sessionDate === refSessionDate && shouldUseLiveForCurrentSession(payload, now);

  const dailyCloses = useLive
    ? payload.dailyCloses
    : await resolveDailyClosesForSessionDate(payload, sessionDate);

  const { rows: dailyRows, diagnostics } = await aggregateFromDailyHoldings(
    sessionDate,
    disnatAccountKeys,
    dailyCloses,
    payload.usdToCad,
    options,
  );

  const rows = useLive
    ? mergeSessionTickerRows(
        aggregateFromEnriched(payload.enrichedHoldings ?? [], payload.usdToCad),
        dailyRows,
      )
    : dailyRows;

  const persistedTotal = sumPersistedSessionGainCad(
    payload,
    sessionDate,
    disnatAccountKeys,
  );
  const liveTotal = useLive
    ? sumLiveDayGainCad(payload, disnatAccountKeys)
    : null;
  const rowTotal = rows.reduce((sum, row) => sum + row.dayGainCad, 0);
  const totalGainCad =
    liveTotal ??
    persistedTotal ??
    (rows.length > 0 && Number.isFinite(rowTotal) ? rowTotal : null);

  return {
    sessionDate,
    sessionLabel: resolveSessionLabel(sessionDate, now, useLive),
    lists: splitGainersLosers(rows),
    totalGainCad,
    diagnostics,
  };
}

export async function buildSessionTickerMiniReportFromPayload(
  payload: PerformanceIndicatorPayload,
): Promise<SessionTickerMiniReport> {
  const now = parsePayloadClock(payload.asOfNow);
  const maxSessionDate = referenceTradingSessionDayIso(now);
  const minSessionDate = previousTradingDayIso(
    maxSessionDate,
    SESSION_TICKER_MAX_LOOKBACK_DAYS,
  );
  const view = await buildSessionTickerViewForDate(payload, maxSessionDate, now, {
    repairHoldingsIfMissing: false,
  });

  return {
    view,
    maxSessionDate,
    minSessionDate,
    history: buildSessionTickerHistory(payload, now),
    sessionDataHealth: payload.sessionDataHealth,
    previousSessionDate: priorReferenceSessionDateIso(now),
  };
}
