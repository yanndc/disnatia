import { prisma } from "@/lib/db/prisma";
import { getPortfolioSummary } from "@/features/portfolio/queries";
import { loadHoldingsForDashboard } from "@/features/portfolio/holdings-display-query";
import {
  enrichPositionRow,
  indexQuotesByTickerCurrency,
} from "@/features/portfolio/live-enrichment";
import { priorSessionCloseByPair } from "@/features/portfolio/daily-close-prices";
import { computePeriodResult } from "@/features/portfolio/performance-indicator-logic";
import { getPerformanceIndicatorPayload } from "@/features/portfolio/performance-indicator-queries";
import {
  isoDateInToronto,
  referenceTradingSessionDay,
  resolveDayPeriodLabels,
} from "@/lib/market/equity-session";
import { normalizeCurrency } from "@/lib/utils";
import type {
  EodReportAccountRow,
  EodReportData,
  EodReportPositionRow,
} from "./eod-report-types";

function toCadEquivalent(value: number, currency: string, usdToCad: number | null): number {
  const cur = normalizeCurrency(currency);
  if (cur === "USD" && usdToCad !== null) return value * usdToCad;
  return value;
}

async function loadQuotesForHoldings(
  holdings: { ticker: string; currency: string }[],
) {
  if (holdings.length === 0) return [];
  const keySet = new Set<string>();
  const pairs: { ticker: string; currency: string }[] = [];
  for (const h of holdings) {
    const k = `${h.ticker.toUpperCase()}|${h.currency.toUpperCase()}`;
    if (keySet.has(k)) continue;
    keySet.add(k);
    pairs.push({ ticker: h.ticker.toUpperCase(), currency: h.currency.toUpperCase() });
  }
  if (pairs.length === 0) return [];
  try {
    return await prisma.portfolioLiveQuote.findMany({
      where: { OR: pairs.map((p) => ({ ticker: p.ticker, currency: p.currency })) },
    });
  } catch {
    return [];
  }
}

export async function buildEodReportData(now = new Date()): Promise<EodReportData> {
  const [payload, summary] = await Promise.all([
    getPerformanceIndicatorPayload(),
    getPortfolioSummary(),
  ]);

  const filters = {
    preset: "all" as const,
    owner: null,
    includedAccountKeys: [] as string[],
    excludedAccountKeys: [] as string[],
    selectedYear: now.getFullYear(),
  };

  const dayPeriod = computePeriodResult(payload, filters, "day");
  const yesterdayPeriod = computePeriodResult(payload, filters, "yesterday");

  const sessionDate = isoDateInToronto(referenceTradingSessionDay(now));
  const { label: sessionLabel } = resolveDayPeriodLabels(now);

  const accountLabelByKey = new Map(
    payload.accounts.map((a) => [a.accountKey, a.label]),
  );

  const accounts: EodReportAccountRow[] = payload.accounts.map((a) => {
    const cur = payload.currentByAccount[a.accountKey];
    return {
      accountKey: a.accountKey,
      label: a.label,
      owner: a.owner,
      isExternal: a.isExternal,
      totalCad: cur?.totalCad ?? 0,
      positionsCad: cur?.positionsCad ?? 0,
      cashCad: cur?.cashCad ?? 0,
      dayGainCad: cur?.dayGainCad ?? null,
    };
  });

  const holdings = await loadHoldingsForDashboard();
  const quotes = await loadQuotesForHoldings(holdings);
  const quoteMap = indexQuotesByTickerCurrency(quotes);
  const uniquePairs = [
    ...new Map(
      holdings.map((h) => [
        `${h.ticker.toUpperCase()}|${h.currency.toUpperCase()}`,
        { ticker: h.ticker.toUpperCase(), currency: h.currency.toUpperCase() },
      ]),
    ).values(),
  ];
  const priorCloseByPair = await priorSessionCloseByPair(uniquePairs);
  const usdToCad = payload.usdToCad;

  const positions: EodReportPositionRow[] = holdings
    .filter((h) => h.quantity > 0)
    .map((h) => {
      const pairKey = `${h.ticker.toUpperCase()}|${h.currency.toUpperCase()}`;
      const enriched = enrichPositionRow(
        {
          id: h.id,
          importId: h.sourceImportId,
          accountId: null,
          accountKey: h.accountKey,
          accountNumber: h.accountNumber ?? null,
          ticker: h.ticker,
          securityName: h.securityName ?? "",
          currency: h.currency,
          quantity: h.quantity,
          averageCost: h.averageCost ?? null,
          marketPrice: h.snapshotPrice ?? null,
          marketValue: h.snapshotValue,
          unrealizedGainLoss: h.unrealizedGainLoss ?? null,
          loanValue: h.loanValue ?? null,
          weightPct: null,
          sector: h.sector ?? null,
          assetType: h.assetType ?? null,
        },
        h.accountName,
        quoteMap.get(pairKey),
        priorCloseByPair.get(pairKey) ?? null,
      );

      const marketValueCad = toCadEquivalent(
        enriched.displayMarketValue,
        enriched.currency,
        usdToCad,
      );
      const dayGainCad =
        enriched.displayDayGainLoss !== null
          ? toCadEquivalent(enriched.displayDayGainLoss, enriched.currency, usdToCad)
          : null;

      return {
        accountKey: h.accountKey,
        accountLabel: accountLabelByKey.get(h.accountKey) ?? h.accountName,
        ticker: h.ticker.toUpperCase(),
        securityName: h.securityName ?? null,
        currency: normalizeCurrency(h.currency),
        quantity: h.quantity,
        marketValueCad,
        dayGainCad,
        usesLiveQuote: enriched.usesLiveQuote,
      };
    })
    .toSorted((a, b) => b.marketValueCad - a.marketValueCad);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || null;

  return {
    sessionDate,
    sessionLabel,
    generatedAt: now.toISOString(),
    totalValueCad: summary.totalValue,
    dayPeriod,
    yesterdayPeriod,
    accounts: accounts.toSorted((a, b) => b.totalCad - a.totalCad),
    positions,
    quoteCoverage: summary.quoteCoverage,
    quotesAsOf:
      summary.quotesAsOf instanceof Date
        ? summary.quotesAsOf.toISOString()
        : summary.quotesAsOf
          ? String(summary.quotesAsOf)
          : null,
    driftVsDisnatPct: summary.driftVsDisnatPct,
    usdToCad: payload.usdToCad,
    usdToCadDate: payload.usdToCadDate,
    appUrl,
  };
}
