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

export type YahooChartRange =
  | "10d"
  | "1mo"
  | "3mo"
  | "6mo"
  | "1y"
  | "2y"
  | "5y"
  | "10y"
  | "max";

/** Choix du range Yahoo selon l'ancienneté de la première détention. */
export function pickYahooChartRange(fromDate: Date): YahooChartRange {
  const years =
    (Date.now() - fromDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (years <= 1.2) return "2y";
  if (years <= 5.5) return "5y";
  if (years <= 10.5) return "10y";
  return "max";
}

/** Clôtures journalières depuis l'API chart Yahoo (`range` = 10d … max). */
export async function fetchYahooChartDailyCloses(
  symbol: string,
  range: YahooChartRange | string = "10d",
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
