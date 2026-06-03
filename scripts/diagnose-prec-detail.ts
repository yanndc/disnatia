/**
 * Diagnostic détaillé Préc. + périodes longues.
 */
import { prisma } from "@/lib/db/prisma";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  computePeriodResult,
  computeTitresPeriodGain,
  titresCadAtOrBefore,
  resolvePeriodBounds,
  defaultPerformanceFilters,
} from "@/features/portfolio/performance-indicator-logic";
import {
  isoDateInToronto,
  priorSessionDateIso,
  previousTradingDayIso,
} from "@/lib/market/equity-session";
import { isoDateFromDbDate, parseIsoDateLocal } from "@/features/portfolio/daily-close-key";
import { closeOnOrBefore } from "@/features/portfolio/performance-history-loader";
import { normalizeCurrency } from "@/lib/utils";
import { getUsdCadRateNear } from "@/lib/fx/latest-usd-cad-rate";

const fmt = (n: number) =>
  n.toLocaleString("fr-CA", { maximumFractionDigits: 2 });

function toCad(v: number, cur: string, fx: number | null) {
  return normalizeCurrency(cur) === "USD" && fx ? v * fx : v;
}

/** V(D) en n'utilisant QUE les points avec asOf = D exactement. */
function titresCadOnExactDate(
  accountKeys: string[],
  payload: Awaited<ReturnType<typeof getPerformanceIndicatorPayload>>,
  date: string,
) {
  const keys = new Set(accountKeys);
  let total = 0;
  const rows: { key: string; v: number }[] = [];
  for (const pt of payload.historyPoints) {
    if (!keys.has(pt.accountKey) || pt.asOf !== date) continue;
    const v = toCad(pt.totalValueNative, pt.currency, payload.usdToCad);
    total += v;
    rows.push({ key: pt.accountKey, v });
  }
  return { total, rows };
}

async function vFromHoldingsPrices(date: string, accountKeys: string[]) {
  const fx = await getUsdCadRateNear(new Date());
  const usdToCad = fx?.usdToCad ?? null;
  const day = parseIsoDateLocal(date);
  const holdings = await prisma.portfolioDailyHolding.findMany({
    where: {
      accountKey: { in: accountKeys },
      holdingDate: day,
      quantity: { gt: 0 },
    },
    select: {
      accountKey: true,
      ticker: true,
      currency: true,
      quantity: true,
    },
  });
  const tickers = [...new Set(holdings.map((h) => `${h.ticker}|${h.currency}`))];
  const prices = await prisma.portfolioDailyPrice.findMany({
    where: {
      priceDate: day,
      OR: tickers.map((k) => {
        const [ticker, currency] = k.split("|");
        return { ticker: ticker!, currency: currency! };
      }),
    },
    select: { ticker: true, currency: true, closePrice: true, priceDate: true },
  });
  const series = new Map<string, Map<string, number>>();
  for (const p of prices) {
    const key = `${p.ticker.toUpperCase()}|${normalizeCurrency(p.currency)}`;
    const m = series.get(key) ?? new Map();
    m.set(isoDateFromDbDate(p.priceDate), p.closePrice);
    series.set(key, m);
  }
  let total = 0;
  for (const h of holdings) {
    const sk = `${h.ticker.toUpperCase()}|${normalizeCurrency(h.currency)}`;
    const s = series.get(sk);
    if (!s) continue;
    const close = closeOnOrBefore(s, date);
    if (close == null) continue;
    total += toCad(h.quantity * close, h.currency, usdToCad);
  }
  return { total, holdingRows: holdings.length, priceRows: prices.length };
}

async function main() {
  const now = new Date();
  const d1 = priorSessionDateIso(now);
  const d0 = previousTradingDayIso(d1, 1);
  const payload = await getPerformanceIndicatorPayload();
  const filters = defaultPerformanceFilters(payload);
  const accountKeys = payload.accounts.filter((a) => !a.isExternal).map((a) => a.accountKey);

  console.log("Dates: D1=", d1, "D0=", d0, "| comptes Disnat:", accountKeys.length);

  const stale = accountKeys.filter((k) => {
    const d0h = titresCadAtOrBefore([k], payload, d0);
    return d0h != null && d0h.asOf < d0;
  });
  console.log("\nComptes avec V_debut STALE (asOf < D0):", stale.length);
  for (const k of stale) {
    const d0h = titresCadAtOrBefore([k], payload, d0)!;
    const d1h = titresCadAtOrBefore([k], payload, d1);
    console.log(" ", k, "| D0 asOf", d0h.asOf, fmt(d0h.valueCad), "| D1 asOf", d1h?.asOf ?? "—", fmt(d1h?.valueCad ?? 0));
  }

  const code = computeTitresPeriodGain(accountKeys, payload, {
    start: d1,
    end: d1,
    baselineLookup: d0,
  });

  const exact0 = titresCadOnExactDate(accountKeys, payload, d0);
  const exact1 = titresCadOnExactDate(accountKeys, payload, d1);
  const raw0 = await vFromHoldingsPrices(d0, accountKeys);
  const raw1 = await vFromHoldingsPrices(d1, accountKeys);

  console.log("\n=== Préc. — 4 façons de calculer ===");
  console.log("A) Code actuel (titresCadAtOrBefore): gain", fmt(code.gainCad ?? 0), "| V_debut", fmt(code.baselineCad ?? 0), "coverage min", code.baselineDate);
  console.log("B) historyPoints asOf EXACT D0/D1: V0", fmt(exact0.total), "V1", fmt(exact1.total), "gain", fmt(exact1.total - exact0.total));
  console.log("C) holdings×prices jour exact: V0", fmt(raw0.total), `(${raw0.holdingRows} lignes)`, "V1", fmt(raw1.total), `(${raw1.holdingRows} lignes)`, "gain", fmt(raw1.total - raw0.total));

  const periods = ["yesterday", "month", "month3", "year"] as const;
  console.log("\n=== Autres périodes (code actuel) ===");
  for (const p of periods) {
    const r = computePeriodResult(payload, filters, p);
    const b = resolvePeriodBounds(p, now, 2026, null);
    console.log(
      p,
      "| $", r.gainCad != null ? fmt(r.gainCad) : "—",
      "| %", r.gainPct?.toFixed(1) ?? "—",
      "| incomplete", r.incomplete,
      "| start", b.start,
      "| baseline", b.baselineLookup,
    );
  }

  let sessionD1 = 0;
  for (const k of accountKeys) {
    for (const g of payload.sessionGainsByAccount[k] ?? []) {
      if (g.date === d1) sessionD1 += g.gainCad;
    }
  }
  console.log("\nΣ session_gains table (D1):", fmt(sessionD1));

  const live = accountKeys.reduce((s, k) => s + (payload.currentByAccount[k]?.positionsCad ?? 0), 0);
  console.log("Positions live maintenant:", fmt(live));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
