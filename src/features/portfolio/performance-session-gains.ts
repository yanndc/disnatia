import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import {
  isTradingDayDate,
  previousTradingDay,
} from "@/lib/market/equity-session";
import { normalizeCurrency } from "@/lib/utils";
import { isoDateLocal, isoDateFromDbDate, parseIsoDateLocal } from "./daily-close-key";
import type { PerformanceSessionGain } from "./performance-indicator-types";

const ACCOUNT_DATE_KEY_SEP = "\u001F";

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

/** Recalcule et persiste le P&L titres par compte / séance. */
export async function recomputeAndPersistSessionGains(
  accountKeys: string[],
  fromDate: string,
  toDate: string,
  usdToCad: number | null,
): Promise<{ rowsWritten: number }> {
  if (accountKeys.length === 0) return { rowsWritten: 0 };

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
      accountKey: true,
      ticker: true,
      currency: true,
      quantity: true,
    },
  });
  if (holdings.length === 0) return { rowsWritten: 0 };

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
    const date = isoDateFromDbDate(p.priceDate);
    const series = priceSeries.get(key) ?? new Map<string, number>();
    series.set(date, p.closePrice);
    priceSeries.set(key, series);
  }

  const byAccountDate = new Map<string, { gainCad: number; priorCad: number }>();

  for (const h of holdings) {
    const date = isoDateFromDbDate(h.holdingDate);
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

    const aggKey = `${h.accountKey}${ACCOUNT_DATE_KEY_SEP}${date}`;
    const bucket = byAccountDate.get(aggKey) ?? { gainCad: 0, priorCad: 0 };
    const gainNative = h.quantity * (endClose - baseClose);
    const priorNative = h.quantity * baseClose;
    bucket.gainCad += toCad(gainNative, h.currency, usdToCad);
    bucket.priorCad += toCad(priorNative, h.currency, usdToCad);
    byAccountDate.set(aggKey, bucket);
  }

  await prisma.portfolioDailyAccountSessionGain.deleteMany({
    where: {
      accountKey: { in: accountKeys },
      sessionDate: {
        gte: parseIsoDateLocal(fromDate),
        lte: parseIsoDateLocal(toDate),
      },
    },
  });

  const rows = [...byAccountDate.entries()].map(([key, v]) => {
    const sepIdx = key.lastIndexOf(ACCOUNT_DATE_KEY_SEP);
    const accountKey = key.slice(0, sepIdx);
    const dateStr = key.slice(sepIdx + 1);
    return {
      id: randomUUID(),
      sessionDate: parseIsoDateLocal(dateStr),
      accountKey,
      currency: "CAD",
      gainNative: v.gainCad,
      priorNative: v.priorCad,
      source: "holdings_closes",
      updatedAt: new Date(),
    };
  });

  if (rows.length === 0) return { rowsWritten: 0 };

  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await prisma.portfolioDailyAccountSessionGain.createMany({
      data: rows.slice(i, i + chunkSize),
    });
  }

  return { rowsWritten: rows.length };
}

/** Charge le P&L agrégé en CAD depuis la table persistée (lecture rapide). */
export async function loadPersistedSessionGains(
  accountKeys: string[],
  fromDate: string,
  toDate: string,
  usdToCad: number | null,
): Promise<PerformanceSessionGain[]> {
  if (accountKeys.length === 0) return [];

  const rows = await prisma.portfolioDailyAccountSessionGain.findMany({
    where: {
      accountKey: { in: accountKeys },
      sessionDate: {
        gte: parseIsoDateLocal(fromDate),
        lte: parseIsoDateLocal(toDate),
      },
    },
    select: {
      sessionDate: true,
      currency: true,
      gainNative: true,
      priorNative: true,
    },
    orderBy: { sessionDate: "asc" },
  });

  const byDate = new Map<string, { gainCad: number; priorCad: number }>();
  for (const row of rows) {
    const date = isoDateFromDbDate(row.sessionDate);
    const bucket = byDate.get(date) ?? { gainCad: 0, priorCad: 0 };
    bucket.gainCad += toCad(row.gainNative, row.currency, usdToCad);
    bucket.priorCad += toCad(row.priorNative, row.currency, usdToCad);
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
