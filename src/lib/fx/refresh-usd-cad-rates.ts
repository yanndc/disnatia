import { prisma } from "@/lib/db/prisma";

const FRANKFURTER_BASE = "https://api.frankfurter.app";
/** Inclure quelques jours avant le 2024-01-01 pour amorcer le report sur le 1er janvier. */
const HISTORY_START = "2023-12-27";
const TABLE_START = "2024-01-01";

type FrankfurterRangeResponse = {
  rates: Record<string, { CAD: number }>;
};

function formatIsoDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseIsoDateUTC(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function todayUtcDate(): Date {
  return parseIsoDateUTC(formatIsoDateUTC(new Date()));
}

async function fetchFrankfurterUsdCad(
  startIso: string,
  endIso: string,
): Promise<Record<string, number>> {
  const url = `${FRANKFURTER_BASE}/${startIso}..${endIso}?from=USD&to=CAD`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) {
    throw new Error(
      `Frankfurter ${res.status}: impossible de charger USD→CAD (${startIso}..${endIso})`,
    );
  }
  const body = (await res.json()) as FrankfurterRangeResponse;
  const out: Record<string, number> = {};
  for (const [day, pair] of Object.entries(body.rates ?? {})) {
    if (typeof pair?.CAD === "number") out[day] = pair.CAD;
  }
  return out;
}

function buildDailySeriesFromApi(
  raw: Record<string, number>,
  fromIso: string,
  toIso: string,
): { rateDate: Date; usdToCad: number }[] {
  const sortedKeys = Object.keys(raw).sort();
  let last: number | null = null;
  for (const k of sortedKeys) {
    if (k < fromIso) last = raw[k]!;
  }
  if (last === null) {
    const firstOnOrAfter = sortedKeys.find((k) => k >= fromIso);
    if (firstOnOrAfter) last = raw[firstOnOrAfter]!;
  }
  if (last === null) {
    throw new Error("Aucun taux USD→CAD utilisable pour amorcer la série.");
  }

  const end = parseIsoDateUTC(toIso);
  const rows: { rateDate: Date; usdToCad: number }[] = [];
  for (
    let d = parseIsoDateUTC(fromIso);
    d.getTime() <= end.getTime();
    d = new Date(d.getTime() + 86400000)
  ) {
    const key = formatIsoDateUTC(d);
    if (raw[key] != null) last = raw[key]!;
    rows.push({ rateDate: d, usdToCad: last });
  }
  return rows;
}

/**
 * Complète l’historique depuis le 1er janvier 2024 et ramène la série jusqu’à aujourd’hui (UTC).
 */
export async function refreshUsdCadRatesIfStale(): Promise<void> {
  const today = todayUtcDate();

  const agg = await prisma.usdCadDailyRate.aggregate({
    _max: { rateDate: true },
    _count: { _all: true },
  });

  const maxDate = agg._max.rateDate;
  const needsFullBackfill = agg._count._all === 0;
  const stale =
    maxDate == null || formatIsoDateUTC(maxDate) < formatIsoDateUTC(today);

  if (!needsFullBackfill && !stale) return;

  const fetchEnd = formatIsoDateUTC(today);
  let raw: Record<string, number>;
  let buildFrom: string;

  if (needsFullBackfill) {
    raw = await fetchFrankfurterUsdCad(HISTORY_START, fetchEnd);
    buildFrom = TABLE_START;
  } else {
    const anchor = maxDate!;
    raw = await fetchFrankfurterUsdCad(formatIsoDateUTC(anchor), fetchEnd);
    const next = new Date(anchor);
    next.setUTCDate(next.getUTCDate() + 1);
    buildFrom = formatIsoDateUTC(next);
    if (buildFrom > fetchEnd) return;
  }

  const series = buildDailySeriesFromApi(raw, buildFrom, fetchEnd);

  if (needsFullBackfill) {
    const chunk = 400;
    for (let i = 0; i < series.length; i += chunk) {
      const slice = series.slice(i, i + chunk);
      await prisma.usdCadDailyRate.createMany({
        data: slice.map((row) => ({
          rateDate: row.rateDate,
          usdToCad: row.usdToCad,
          source: "frankfurter",
        })),
      });
    }
    return;
  }

  for (let i = 0; i < series.length; i += 1) {
    const row = series[i]!;
    await prisma.usdCadDailyRate.upsert({
      where: { rateDate: row.rateDate },
      create: {
        rateDate: row.rateDate,
        usdToCad: row.usdToCad,
        source: "frankfurter",
      },
      update: {
        usdToCad: row.usdToCad,
        source: "frankfurter",
      },
    });
  }
}
