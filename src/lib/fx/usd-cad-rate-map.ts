import { prisma } from "@/lib/db/prisma";
import { isoDateFromDbDate, parseIsoDateLocal } from "@/features/portfolio/daily-close-key";
import {
  isTradingDayIso,
  nextTradingDayIso,
  previousTradingDayIso,
} from "@/lib/market/equity-session";

/** Charge les taux USD→CAD BoC pour [fromIso, toIso], avec report du dernier cours connu. */
export async function loadUsdCadRateMap(
  fromIso: string,
  toIso: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (fromIso > toIso) return map;

  const padStart = previousTradingDayIso(fromIso, 14);
  const rows = await prisma.usdCadDailyRate.findMany({
    where: {
      rateDate: {
        gte: parseIsoDateLocal(padStart),
        lte: parseIsoDateLocal(toIso),
      },
    },
    orderBy: { rateDate: "asc" },
    select: { rateDate: true, usdToCad: true },
  });

  let lastRate: number | null = null;
  for (const row of rows) {
    if (Number.isFinite(row.usdToCad) && row.usdToCad > 0) {
      lastRate = row.usdToCad;
      map.set(isoDateFromDbDate(row.rateDate), row.usdToCad);
    }
  }

  let cursor = padStart;
  let carry = lastRate;
  while (cursor <= toIso) {
    if (isTradingDayIso(cursor)) {
      const hit = map.get(cursor);
      if (hit != null && hit > 0) {
        carry = hit;
      } else if (carry != null) {
        map.set(cursor, carry);
      }
    }
    cursor = nextTradingDayIso(cursor);
  }

  return map;
}

export function usdCadRateOnDate(
  rateMap: Map<string, number>,
  sessionDateIso: string,
): number | null {
  const direct = rateMap.get(sessionDateIso);
  if (direct != null && direct > 0) return direct;

  let cursor = sessionDateIso;
  for (let i = 0; i < 14; i++) {
    cursor = previousTradingDayIso(cursor, 1);
    const hit = rateMap.get(cursor);
    if (hit != null && hit > 0) return hit;
  }
  return null;
}

export function listTradingDaysInRange(startIso: string, endIso: string): string[] {
  if (startIso > endIso) return [];
  let cursor = startIso;
  while (cursor <= endIso && !isTradingDayIso(cursor)) {
    cursor = nextTradingDayIso(cursor);
  }
  const out: string[] = [];
  while (cursor <= endIso) {
    if (isTradingDayIso(cursor)) out.push(cursor);
    cursor = nextTradingDayIso(cursor);
  }
  return out;
}
