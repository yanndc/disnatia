import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import {
  loadUsdCadRateMap,
  usdCadRateOnDate,
} from "@/lib/fx/usd-cad-rate-map";
import {
  isTradingDayDate,
  previousTradingDay,
  previousTradingDayIso,
} from "@/lib/market/equity-session";
import { normalizeCurrency } from "@/lib/utils";
import { isoDateLocal, isoDateFromDbDate, parseIsoDateLocal } from "./daily-close-key";
import type { PerformanceSessionGain } from "./performance-indicator-types";

const ACCOUNT_DATE_KEY_SEP = "\u001F";
const POSITION_DATE_KEY_SEP = "\u001F";
const SESSION_GAIN_SOURCE = "holdings_closes_v2";

function positionDateKey(
  accountKey: string,
  ticker: string,
  currency: string,
  date: string,
): string {
  return `${accountKey}${POSITION_DATE_KEY_SEP}${ticker.toUpperCase()}${POSITION_DATE_KEY_SEP}${normalizeCurrency(currency)}${POSITION_DATE_KEY_SEP}${date}`;
}

/** P&L journalier = qty détenue à l'ouverture (veille) × Δ clôture. */
export function sessionGainFromPriorQuantity(
  quantityHeld: number,
  endClose: number,
  baseClose: number,
): { gainNative: number; priorNative: number } {
  if (quantityHeld <= 0 || baseClose <= 0) {
    return { gainNative: 0, priorNative: 0 };
  }
  return {
    gainNative: quantityHeld * (endClose - baseClose),
    priorNative: quantityHeld * baseClose,
  };
}

function toCadOnSessionDate(
  value: number,
  currency: string,
  sessionDate: string,
  rateMap: Map<string, number>,
  missingFxDates: Set<string>,
): number {
  const cur = normalizeCurrency(currency);
  if (cur === "CAD") return value;
  const rate = usdCadRateOnDate(rateMap, sessionDate);
  if (rate == null || !(rate > 0)) {
    missingFxDates.add(sessionDate);
    return Number.NaN;
  }
  return value * rate;
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

/** Convertit gainNative / priorNative (devise du compte) en CAD pour l’agrégation. */
export function nativeToPerformanceCad(
  value: number,
  currency: string,
  usdToCad: number | null,
): number {
  if (normalizeCurrency(currency) === "CAD") return value;
  if (usdToCad != null && usdToCad > 0) return value * usdToCad;
  return value;
}

/** Recalcule et persiste le P&L titres par compte / séance (FX BoC par jour). */
export async function recomputeAndPersistSessionGains(
  accountKeys: string[],
  fromDate: string,
  toDate: string,
): Promise<{ rowsWritten: number; missingFxDates: string[] }> {
  if (accountKeys.length === 0) return { rowsWritten: 0, missingFxDates: [] };

  const holdingsFrom = isoDateLocal(
    previousTradingDay(parseIsoDateLocal(fromDate), 12),
  );
  const allHoldings = await prisma.portfolioDailyHolding.findMany({
    where: {
      accountKey: { in: accountKeys },
      quantity: { gt: 0 },
      holdingDate: {
        gte: parseIsoDateLocal(holdingsFrom),
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
  const holdings = allHoldings.filter((h) => {
    const date = isoDateFromDbDate(h.holdingDate);
    return date >= fromDate && date <= toDate;
  });
  if (holdings.length === 0) return { rowsWritten: 0, missingFxDates: [] };

  const pairSet = new Set<string>();
  for (const h of holdings) {
    pairSet.add(`${h.ticker.toUpperCase()}|${normalizeCurrency(h.currency)}`);
  }
  const pairs = [...pairSet].map((k) => {
    const [ticker, currency] = k.split("|");
    return { ticker: ticker!, currency: currency! };
  });

  const qtyByPositionDate = new Map<string, number>();
  for (const h of allHoldings) {
    const date = isoDateFromDbDate(h.holdingDate);
    qtyByPositionDate.set(
      positionDateKey(h.accountKey, h.ticker, h.currency, date),
      h.quantity,
    );
  }

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

  const fxFrom = previousTradingDayIso(fromDate, 14);
  const rateMap = await loadUsdCadRateMap(fxFrom, toDate);
  const missingFxDates = new Set<string>();
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
    const priorDay = previousTradingDayIso(date, 1);
    const qtyHeld =
      qtyByPositionDate.get(
        positionDateKey(h.accountKey, h.ticker, h.currency, priorDay),
      ) ?? 0;
    const { gainNative, priorNative } = sessionGainFromPriorQuantity(
      qtyHeld,
      endClose,
      baseClose,
    );
    const gainCad = toCadOnSessionDate(
      gainNative,
      h.currency,
      date,
      rateMap,
      missingFxDates,
    );
    const priorCad = toCadOnSessionDate(
      priorNative,
      h.currency,
      date,
      rateMap,
      missingFxDates,
    );
    if (!Number.isFinite(gainCad) || !Number.isFinite(priorCad)) continue;

    bucket.gainCad += gainCad;
    bucket.priorCad += priorCad;
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
      source: SESSION_GAIN_SOURCE,
      updatedAt: new Date(),
    };
  });

  if (rows.length === 0) {
    return { rowsWritten: 0, missingFxDates: [...missingFxDates].toSorted() };
  }

  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    await prisma.portfolioDailyAccountSessionGain.createMany({
      data: rows.slice(i, i + chunkSize),
    });
  }

  return {
    rowsWritten: rows.length,
    missingFxDates: [...missingFxDates].toSorted(),
  };
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
    bucket.gainCad += nativeToPerformanceCad(
      row.gainNative,
      row.currency,
      usdToCad,
    );
    bucket.priorCad += nativeToPerformanceCad(
      row.priorNative,
      row.currency,
      usdToCad,
    );
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

/** P&L de séance par compte (clé = accountKey). */
export async function loadPersistedSessionGainsByAccount(
  accountKeys: string[],
  fromDate: string,
  toDate: string,
  usdToCad: number | null,
): Promise<Record<string, PerformanceSessionGain[]>> {
  if (accountKeys.length === 0) return {};

  const rows = await prisma.portfolioDailyAccountSessionGain.findMany({
    where: {
      accountKey: { in: accountKeys },
      sessionDate: {
        gte: parseIsoDateLocal(fromDate),
        lte: parseIsoDateLocal(toDate),
      },
    },
    select: {
      accountKey: true,
      sessionDate: true,
      currency: true,
      gainNative: true,
      priorNative: true,
    },
    orderBy: [{ accountKey: "asc" }, { sessionDate: "asc" }],
  });

  const out: Record<string, Map<string, { gainCad: number; priorCad: number }>> = {};

  for (const row of rows) {
    const date = isoDateFromDbDate(row.sessionDate);
    const accountMap = out[row.accountKey] ?? new Map();
    const bucket = accountMap.get(date) ?? { gainCad: 0, priorCad: 0 };
    bucket.gainCad += nativeToPerformanceCad(
      row.gainNative,
      row.currency,
      usdToCad,
    );
    bucket.priorCad += nativeToPerformanceCad(
      row.priorNative,
      row.currency,
      usdToCad,
    );
    accountMap.set(date, bucket);
    out[row.accountKey] = accountMap;
  }

  const result: Record<string, PerformanceSessionGain[]> = {};
  for (const [accountKey, byDate] of Object.entries(out)) {
    result[accountKey] = [...byDate.entries()]
      .map(([date, v]) => ({ date, gainCad: v.gainCad, priorCad: v.priorCad }))
      .toSorted((a, b) => a.date.localeCompare(b.date));
  }
  return result;
}
