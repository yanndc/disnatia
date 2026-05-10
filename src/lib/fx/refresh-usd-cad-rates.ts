import { prisma } from "@/lib/db/prisma";

/** Série quotidienne BoC : même référence que les « taux du jour » publics au Canada (proche courtiers nationaux). */
const BOC_OBSERVATIONS =
  "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json";
const RATE_SOURCE = "bank_of_canada";
/** Requêtes fragmentées pour limiter la taille des réponses. */
const BOC_CHUNK_DAYS = 400;

/** Inclure quelques jours avant le 2024-01-01 pour amorcer le report sur le 1er janvier. */
const HISTORY_START = "2023-12-27";
const TABLE_START = "2024-01-01";

type BocObservationsResponse = {
  observations?: Array<{
    d: string;
    FXUSDCAD?: { v?: string };
  }>;
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

function compareIso(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function addUtcDaysIso(iso: string, days: number): string {
  const d = parseIsoDateUTC(iso);
  return formatIsoDateUTC(new Date(d.getTime() + days * 86_400_000));
}

async function fetchBankOfCanadaChunk(
  startIso: string,
  endIso: string,
): Promise<Record<string, number>> {
  const url = `${BOC_OBSERVATIONS}?start_date=${startIso}&end_date=${endIso}`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) {
    throw new Error(
      `Banque du Canada ${res.status}: impossible de charger USD→CAD (${startIso}..${endIso})`,
    );
  }
  const body = (await res.json()) as BocObservationsResponse;
  const out: Record<string, number> = {};
  for (const obs of body.observations ?? []) {
    const raw = obs.FXUSDCAD?.v;
    if (raw == null) continue;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) continue;
    out[obs.d] = n;
  }
  return out;
}

/** Télécharge FXUSDCAD sur une plage [startIso, endIso] (inclusive), par morceaux. */
async function fetchBankOfCanadaUsdCad(
  startIso: string,
  endIso: string,
): Promise<Record<string, number>> {
  if (compareIso(startIso, endIso) > 0) return {};
  const merged: Record<string, number> = {};
  let cursor = startIso;
  while (compareIso(cursor, endIso) <= 0) {
    const tentativeEnd = addUtcDaysIso(cursor, BOC_CHUNK_DAYS - 1);
    const chunkEnd =
      compareIso(tentativeEnd, endIso) > 0 ? endIso : tentativeEnd;
    const chunk = await fetchBankOfCanadaChunk(cursor, chunkEnd);
    Object.assign(merged, chunk);
    if (compareIso(chunkEnd, endIso) >= 0) break;
    cursor = addUtcDaysIso(chunkEnd, 1);
  }
  return merged;
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
    d = new Date(d.getTime() + 86_400_000)
  ) {
    const key = formatIsoDateUTC(d);
    if (raw[key] != null) last = raw[key]!;
    rows.push({ rateDate: d, usdToCad: last });
  }
  return rows;
}

/**
 * Complète l’historique depuis le 1er janvier 2024 et ramène la série jusqu’à aujourd’hui (UTC).
 * Source : Banque du Canada (FXUSDCAD), jours fériés / fins de semaine = dernier cours publié.
 */
export async function refreshUsdCadRatesIfStale(): Promise<void> {
  const today = todayUtcDate();

  const agg = await prisma.usdCadDailyRate.aggregate({
    _max: { rateDate: true },
    _count: { _all: true },
  });

  let maxDate = agg._max.rateDate;
  let needsFullBackfill = agg._count._all === 0;

  /* Ancienne source (Frankfurter) : un seul passage pour réaligner tout l’historique sur la BoC. */
  if (!needsFullBackfill) {
    const legacyFrankfurter = await prisma.usdCadDailyRate.findFirst({
      where: { source: "frankfurter" },
      select: { id: true },
    });
    if (legacyFrankfurter) {
      await prisma.usdCadDailyRate.deleteMany({});
      needsFullBackfill = true;
      maxDate = null;
    }
  }

  const stale =
    maxDate == null || formatIsoDateUTC(maxDate) < formatIsoDateUTC(today);

  if (!needsFullBackfill && !stale) return;

  const fetchEnd = formatIsoDateUTC(today);
  let raw: Record<string, number>;
  let buildFrom: string;

  if (needsFullBackfill) {
    raw = await fetchBankOfCanadaUsdCad(HISTORY_START, fetchEnd);
    buildFrom = TABLE_START;
  } else {
    const anchor = maxDate!;
    raw = await fetchBankOfCanadaUsdCad(formatIsoDateUTC(anchor), fetchEnd);
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
          source: RATE_SOURCE,
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
        source: RATE_SOURCE,
      },
      update: {
        usdToCad: row.usdToCad,
        source: RATE_SOURCE,
      },
    });
  }
}
