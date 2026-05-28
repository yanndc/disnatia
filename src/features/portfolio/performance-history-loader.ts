import { prisma } from "@/lib/db/prisma";
import {
  isTradingDayDate,
  previousTradingDay,
} from "@/lib/market/equity-session";
import { normalizeCurrency } from "@/lib/utils";
import { dailyCloseKey, isoDateLocal, parseIsoDateLocal } from "./daily-close-key";
import type {
  PerformanceDailyTotalCad,
  PerformanceSessionGain,
  PerformanceSnapshotPoint,
} from "./performance-indicator-types";

function toCad(value: number, currency: string, usdToCad: number | null): number {
  const cur = normalizeCurrency(currency);
  if (cur === "USD") return usdToCad !== null ? value * usdToCad : value;
  return value;
}

function closeOnOrBefore(
  priceByDate: Map<string, number>,
  targetDate: string,
  maxSteps = 8,
): number | null {
  let cursor = parseIsoDateLocal(targetDate);
  for (let i = 0; i < maxSteps; i++) {
    const iso = isoDateLocal(cursor);
    const hit = priceByDate.get(iso);
    if (hit != null && hit > 0) return hit;
    cursor = previousTradingDay(cursor, 1);
  }
  return null;
}

function priorCloseDateForSeries(
  sessionEnd: string,
  priceByDate: Map<string, number>,
  maxSteps = 8,
): string | null {
  let cursor = parseIsoDateLocal(sessionEnd);
  for (let i = 0; i < maxSteps; i++) {
    cursor = previousTradingDay(cursor, 1);
    const iso = isoDateLocal(cursor);
    const hit = priceByDate.get(iso);
    if (hit != null && hit > 0) return iso;
  }
  return null;
}

export async function loadDailyTitresSessionGains(
  accountKeys: string[],
  fromDate: string,
  toDate: string,
  usdToCad: number | null,
): Promise<PerformanceSessionGain[]> {
  if (accountKeys.length === 0) return [];

  const holdings = await prisma.portfolioDailyHolding.findMany({
    where: {
      accountKey: { in: accountKeys },
      quantity: { gt: 0 },
      holdingDate: {
        gte: parseIsoDateLocal(fromDate),
        lte: parseIsoDateLocal(toDate),
      },
    },
    select: {
      holdingDate: true,
      ticker: true,
      currency: true,
      quantity: true,
    },
  });
  if (holdings.length === 0) return [];

  const pairSet = new Set<string>();
  for (const h of holdings) {
    pairSet.add(`${h.ticker.toUpperCase()}|${normalizeCurrency(h.currency)}`);
  }
  const pairs = [...pairSet].map((k) => {
    const [ticker, currency] = k.split("|");
    return { ticker: ticker!, currency: currency! };
  });

  const priceFrom = isoDateLocal(
    previousTradingDay(parseIsoDateLocal(fromDate), 10),
  );
  const prices = await prisma.portfolioDailyPrice.findMany({
    where: {
      OR: pairs.map((p) => ({ ticker: p.ticker, currency: p.currency })),
      priceDate: {
        gte: parseIsoDateLocal(priceFrom),
        lte: parseIsoDateLocal(toDate),
      },
    },
    select: {
      ticker: true,
      currency: true,
      priceDate: true,
      closePrice: true,
    },
  });

  const priceSeries = new Map<string, Map<string, number>>();
  for (const p of prices) {
    const key = `${p.ticker.toUpperCase()}|${normalizeCurrency(p.currency)}`;
    const date = isoDateLocal(p.priceDate);
    const series = priceSeries.get(key) ?? new Map<string, number>();
    series.set(date, p.closePrice);
    priceSeries.set(key, series);
  }

  const byDate = new Map<string, { gainCad: number; priorCad: number }>();

  for (const h of holdings) {
    const date = isoDateLocal(h.holdingDate);
    if (date < fromDate || date > toDate) continue;
    if (!isTradingDayDate(date)) continue;

    const seriesKey = `${h.ticker.toUpperCase()}|${normalizeCurrency(h.currency)}`;
    const series = priceSeries.get(seriesKey);
    if (!series) continue;

    const endClose = closeOnOrBefore(series, date);
    const priorDate = priorCloseDateForSeries(date, series);
    if (endClose == null || priorDate == null) continue;
    const baseClose = series.get(priorDate);
    if (baseClose == null || baseClose <= 0) continue;

    const gainNative = h.quantity * (endClose - baseClose);
    const priorNative = h.quantity * baseClose;
    const bucket = byDate.get(date) ?? { gainCad: 0, priorCad: 0 };
    bucket.gainCad += toCad(gainNative, h.currency, usdToCad);
    bucket.priorCad += toCad(priorNative, h.currency, usdToCad);
    byDate.set(date, bucket);
  }

  return [...byDate.entries()]
    .map(([date, v]) => ({
      date,
      gainCad: v.gainCad,
      priorCad: v.priorCad,
    }))
    .toSorted((a, b) => a.date.localeCompare(b.date));
}

export async function loadPerformanceDailyTotalsCad(
  usdToCad: number | null,
): Promise<PerformanceDailyTotalCad[]> {
  const rows = await prisma.portfolioDailyValue.findMany({
    orderBy: { valueDate: "asc" },
    select: { valueDate: true, currency: true, positionsValue: true },
  });
  if (rows.length === 0) return [];

  const byDate = new Map<string, { cad: number; usd: number }>();
  for (const row of rows) {
    const date = isoDateLocal(row.valueDate);
    const bucket = byDate.get(date) ?? { cad: 0, usd: 0 };
    const cur = normalizeCurrency(row.currency);
    if (cur === "USD") bucket.usd += row.positionsValue;
    else bucket.cad += row.positionsValue;
    byDate.set(date, bucket);
  }

  const fx = usdToCad ?? 1;
  return [...byDate.entries()]
    .map(([date, v]) => ({
      date,
      totalCad: v.cad + v.usd * fx,
    }))
    .toSorted((a, b) => a.date.localeCompare(b.date));
}

export async function loadPerformanceAccountHistory(): Promise<
  PerformanceSnapshotPoint[]
> {
  const holdingCount = await prisma.portfolioDailyHolding.count();
  if (holdingCount === 0) return [];

  const [holdings, prices] = await Promise.all([
    prisma.portfolioDailyHolding.findMany({
      where: { quantity: { gt: 0 } },
      select: {
        holdingDate: true,
        accountKey: true,
        ticker: true,
        currency: true,
        quantity: true,
      },
    }),
    prisma.portfolioDailyPrice.findMany({
      select: {
        ticker: true,
        currency: true,
        priceDate: true,
        closePrice: true,
      },
    }),
  ]);

  if (holdings.length === 0 || prices.length === 0) return [];

  const priceSeries = new Map<string, Map<string, number>>();
  for (const p of prices) {
    const key = `${p.ticker.toUpperCase()}|${normalizeCurrency(p.currency)}`;
    const date = isoDateLocal(p.priceDate);
    const series = priceSeries.get(key) ?? new Map<string, number>();
    series.set(date, p.closePrice);
    priceSeries.set(key, series);
  }

  const agg = new Map<string, number>();
  const KEY_SEP = "\u001F";
  for (const h of holdings) {
    const date = isoDateLocal(h.holdingDate);
    const seriesKey = `${h.ticker.toUpperCase()}|${normalizeCurrency(h.currency)}`;
    const series = priceSeries.get(seriesKey);
    if (!series) continue;
    const close = closeOnOrBefore(series, date);
    if (close == null) continue;
    const value = h.quantity * close;
    const aggKey = `${h.accountKey}${KEY_SEP}${normalizeCurrency(h.currency)}${KEY_SEP}${date}`;
    agg.set(aggKey, (agg.get(aggKey) ?? 0) + value);
  }

  const out: PerformanceSnapshotPoint[] = [];
  for (const [key, totalValueNative] of agg) {
    const parts = key.split(KEY_SEP);
    const accountKey = parts[0];
    const currency = parts[1];
    const asOf = parts[2];
    if (!accountKey || !currency || !asOf) continue;
    out.push({
      accountKey,
      asOf,
      totalValueNative,
      currency,
    });
  }

  return out;
}

export function dailyCloseIndexFromPrices(
  prices: { ticker: string; currency: string; priceDate: Date; closePrice: number }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of prices) {
    out[dailyCloseKey(p.ticker, p.currency, isoDateLocal(p.priceDate))] = p.closePrice;
  }
  return out;
}
