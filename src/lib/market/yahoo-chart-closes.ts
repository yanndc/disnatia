export type DailyClosePoint = {
  /** ISO date YYYY-MM-DD (heure de Toronto) */
  date: string;
  close: number;
};

const TORONTO_TZ = "America/Toronto";

function isoDateInToronto(epochSec: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TORONTO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochSec * 1000));
}

type YahooChartPayload = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: (number | null)[];
        }>;
      };
    }>;
  };
};

/** Dernières séances (jusqu'à ~10 jours calendaires) depuis l'API chart Yahoo. */
export async function fetchYahooChartDailyCloses(
  symbol: string,
  range = "10d",
): Promise<DailyClosePoint[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol,
  )}?interval=1d&range=${range}`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; DisnatIA/1.0)",
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) return [];

  const data = (await response.json()) as YahooChartPayload;
  const result = data.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];

  const out: DailyClosePoint[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const close = closes[i];
    if (ts == null || close == null || !Number.isFinite(close) || close <= 0) {
      continue;
    }
    out.push({ date: isoDateInToronto(ts), close });
  }
  return out;
}
