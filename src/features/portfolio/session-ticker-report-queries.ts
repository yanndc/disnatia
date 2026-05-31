import { prisma } from "@/lib/db/prisma";
import {
  isoDateInToronto,
  isEquityMarketSessionOpen,
  isTradingDayDate,
  referenceTradingSessionDay,
  resolveDayPeriodLabels,
  yesterdayTradingSessionDay,
} from "@/lib/market/equity-session";
import { normalizeCurrency } from "@/lib/utils";
import { parseIsoDateLocal } from "./daily-close-key";
import {
  closeOnOrBefore,
  priorCloseDateForSeries,
} from "./performance-history-loader";
import type {
  PerformanceEnrichedHoldingRow,
  PerformanceIndicatorPayload,
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

export type SessionTickerMiniReport = {
  currentSessionDate: string;
  currentSessionLabel: string;
  previousSessionDate: string | null;
  previousSessionLabel: string | null;
  showPreviousSession: boolean;
  current: SessionTickerLists;
  previous: SessionTickerLists;
};

function toCad(value: number, currency: string, usdToCad: number | null): number {
  const cur = normalizeCurrency(currency);
  if (cur === "USD" && usdToCad !== null) return value * usdToCad;
  return value;
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
      ticker: true,
      securityName: true,
      currency: true,
      quantity: true,
    },
  });
  if (exact.length > 0) return exact;

  const latest = await prisma.portfolioDailyHolding.findFirst({
    where: {
      accountKey: { in: accountKeys },
      holdingDate: { lte: sessionDay },
      quantity: { gt: 0 },
    },
    orderBy: { holdingDate: "desc" },
    select: { holdingDate: true },
  });
  if (!latest) return [];

  return prisma.portfolioDailyHolding.findMany({
    where: {
      holdingDate: latest.holdingDate,
      accountKey: { in: accountKeys },
      quantity: { gt: 0 },
    },
    select: {
      ticker: true,
      securityName: true,
      currency: true,
      quantity: true,
    },
  });
}

async function aggregateFromDailyHoldings(
  sessionDate: string,
  accountKeys: string[],
  dailyCloses: Record<string, number>,
  usdToCad: number | null,
): Promise<SessionTickerRow[]> {
  if (!isTradingDayDate(sessionDate) || accountKeys.length === 0) return [];

  const holdings = await loadHoldingsForSessionDate(sessionDate, accountKeys);
  if (holdings.length === 0) return [];

  const buckets = new Map<string, TickerBucket>();

  for (const h of holdings) {
    const ticker = h.ticker.toUpperCase();
    const currency = normalizeCurrency(h.currency);
    const seriesKey = `${ticker}|${currency}`;
    const series = closeSeriesForPair(dailyCloses, ticker, currency);
    if (series.size === 0) continue;

    const endClose = closeOnOrBefore(series, sessionDate);
    const priorDate = priorCloseDateForSeries(sessionDate, series);
    if (endClose == null || priorDate == null) continue;
    const baseClose = series.get(priorDate);
    if (baseClose == null || baseClose <= 0) continue;

    const gainNative = h.quantity * (endClose - baseClose);
    if (gainNative === 0) continue;

    const existing = buckets.get(seriesKey);
    if (existing) {
      existing.quantity += h.quantity;
      existing.gainNative += gainNative;
      existing.securityName = pickSecurityName(existing.securityName, h.securityName);
    } else {
      buckets.set(seriesKey, {
        ticker,
        securityName: (h.securityName ?? "").trim() || ticker,
        currency,
        quantity: h.quantity,
        gainNative,
      });
    }
  }

  return finalizeBuckets(buckets, usdToCad);
}

function parsePayloadClock(asOfNow: string): Date {
  if (asOfNow.includes("T")) {
    const d = new Date(asOfNow);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const [y, m, d] = asOfNow.split("-").map(Number);
  const local = new Date(y!, m! - 1, d!);
  local.setHours(15, 0, 0, 0);
  return local;
}

export async function buildSessionTickerMiniReportFromPayload(
  payload: PerformanceIndicatorPayload,
): Promise<SessionTickerMiniReport> {
  const now = parsePayloadClock(payload.asOfNow);
  const marketOpen = isEquityMarketSessionOpen(now);
  const currentSessionDate = isoDateInToronto(referenceTradingSessionDay(now));
  const previousSessionDate = isoDateInToronto(yesterdayTradingSessionDay(now));
  const { label: currentSessionLabel } = resolveDayPeriodLabels(now);

  const disnatAccountKeys = payload.accounts
    .filter((a) => !a.isExternal)
    .map((a) => a.accountKey);

  const currentRows = marketOpen
    ? aggregateFromEnriched(payload.enrichedHoldings ?? [], payload.usdToCad)
    : await aggregateFromDailyHoldings(
        currentSessionDate,
        disnatAccountKeys,
        payload.dailyCloses,
        payload.usdToCad,
      );

  const previousRows =
    marketOpen
      ? await aggregateFromDailyHoldings(
          previousSessionDate,
          disnatAccountKeys,
          payload.dailyCloses,
          payload.usdToCad,
        )
      : [];

  return {
    currentSessionDate,
    currentSessionLabel: marketOpen ? currentSessionLabel : "Dernière séance",
    previousSessionDate: marketOpen ? previousSessionDate : null,
    previousSessionLabel: marketOpen ? "Séance précédente" : null,
    showPreviousSession: marketOpen,
    current: splitGainersLosers(currentRows),
    previous: splitGainersLosers(previousRows),
  };
}
