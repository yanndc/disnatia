import { prisma } from "@/lib/db/prisma";
import { getUsdCadRateNear } from "@/lib/fx/latest-usd-cad-rate";
import { sanitizePortfolioOwner } from "@/lib/portfolio/sanitize-portfolio-owner";
import { formatAccountNumber, normalizeCurrency } from "@/lib/utils";
import {
  accountDayTitresPnL,
} from "@/app/(dashboard)/comptes/comptes-accounts-logic";
import { loadHoldingsForDashboard } from "./holdings-display-query";
import {
  enrichPositionRow,
  indexQuotesByTickerCurrency,
} from "./live-enrichment";
import { listExternalAccountsWithLatest } from "./external-accounts-queries";
import { makeAccountKey } from "./upsert-portfolio-state";
import {
  dailyCloseKey,
  fetchChartClosesInMemory,
  loadDailyCloseMap,
  pairsNeedingChartHistory,
  yesterdayCloseDates,
  yahooSymbolForPair,
} from "./daily-close-prices";
import type {
  PerformanceAccountCurrent,
  PerformanceAccountRef,
  PerformanceCashFlow,
  PerformanceHoldingRow,
  PerformanceIndicatorPayload,
  PerformanceSnapshotPoint,
} from "./performance-indicator-types";
import {
  loadPerformanceAccountHistory,
  loadPerformanceDailyTotalsCad,
} from "./performance-history-loader";
import { isoDateInToronto } from "@/lib/market/equity-session";

function toCad(value: number, currency: string, usdToCad: number | null): number {
  const cur = normalizeCurrency(currency);
  if (cur === "USD") return usdToCad !== null ? value * usdToCad : value;
  return value;
}

function isoDate(d: Date): string {
  return isoDateInToronto(d);
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

export async function getPerformanceIndicatorPayload(): Promise<PerformanceIndicatorPayload> {
  const [accountStates, holdings, externalAccounts, portfolioImports, extSnapshots, txFlows] =
    await Promise.all([
      prisma.portfolioAccountState.findMany({
        orderBy: [{ owner: "asc" }, { accountType: "asc" }],
      }),
      loadHoldingsForDashboard(),
      listExternalAccountsWithLatest(),
      prisma.portfolioImport.findMany({
        where: {
          status: "COMPLETED",
          accounts: { some: {} },
        },
        orderBy: [{ dataToDate: "desc" }, { importedAt: "desc" }],
        select: {
          dataToDate: true,
          importedAt: true,
          accounts: {
            select: {
              accountName: true,
              accountNumber: true,
              currency: true,
              totalValue: true,
            },
          },
        },
      }),
      prisma.externalAccountSnapshot.findMany({
        orderBy: { asOfDate: "asc" },
        select: {
          asOfDate: true,
          totalValue: true,
          externalAccount: {
            select: { accountKey: true, currency: true },
          },
        },
      }),
      prisma.portfolioTransactionLine.findMany({
        where: {
          accountKey: { not: null },
          tradeDate: { not: null },
          txCategory: {
            in: ["CONTRIBUTION", "TRANSFER_IN", "TRANSFER_OUT", "INTERNAL_TRANSFER"],
          },
        },
        select: {
          accountKey: true,
          tradeDate: true,
          txCategory: true,
          amount: true,
          currency: true,
        },
      }),
    ]);

  const quotes = await loadQuotesForHoldings(holdings);
  const quoteMap = indexQuotesByTickerCurrency(quotes);
  const fxRow = await getUsdCadRateNear(new Date());
  const usdToCad = fxRow?.usdToCad ?? null;

  const positionsByAccount = new Map<string, ReturnType<typeof enrichPositionRow>[]>();
  for (const h of holdings) {
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
      quoteMap.get(`${h.ticker.toUpperCase()}|${h.currency.toUpperCase()}`),
    );
    const list = positionsByAccount.get(h.accountKey) ?? [];
    list.push(enriched);
    positionsByAccount.set(h.accountKey, list);
  }

  const accounts: PerformanceAccountRef[] = [];
  const currentByAccount: Record<string, PerformanceAccountCurrent> = {};

  for (const a of accountStates) {
    const rows = positionsByAccount.get(a.accountKey) ?? [];
    const dayState = accountDayTitresPnL(rows);
    const positionsNative = rows.reduce((s, p) => s + p.displayMarketValue, 0);
    const cashNative = a.cashValue;
    const positionsCad = toCad(positionsNative, a.currency, usdToCad);
    const cashCad = toCad(cashNative, a.currency, usdToCad);
    const totalCad = positionsCad + cashCad;

    let dayGainCad: number | null = null;
    let dayPriorCad: number | null = null;
    if (dayState.sum !== null) {
      dayGainCad = toCad(dayState.sum, a.currency, usdToCad);
    }
    if (dayState.priorCloseTitresValue !== null && dayState.priorCloseTitresValue > 0) {
      dayPriorCad = toCad(dayState.priorCloseTitresValue, a.currency, usdToCad);
    }

    const num = formatAccountNumber(a.accountNumber);
    const label = num
      ? `${a.accountType ?? a.accountName} · ${num}`
      : a.accountName;

    accounts.push({
      accountKey: a.accountKey,
      label,
      owner: sanitizePortfolioOwner(a.owner),
      accountType: a.accountType,
      currency: normalizeCurrency(a.currency),
      isExternal: false,
    });

    currentByAccount[a.accountKey] = {
      totalCad,
      positionsCad,
      cashCad,
      dayGainCad,
      dayPriorCad,
    };
  }

  for (const ext of externalAccounts) {
    if (!ext.latestSnapshot) continue;
    const totalNative = ext.latestSnapshot.totalValue;
    accounts.push({
      accountKey: ext.accountKey,
      label: ext.displayLabel,
      owner: sanitizePortfolioOwner(ext.owner),
      accountType: null,
      currency: normalizeCurrency(ext.currency),
      isExternal: true,
      provider: ext.provider,
    });
    currentByAccount[ext.accountKey] = {
      totalCad: toCad(totalNative, ext.currency, usdToCad),
      positionsCad: toCad(totalNative, ext.currency, usdToCad),
      cashCad: 0,
      dayGainCad: null,
      dayPriorCad: null,
    };
  }

  const snapshots: PerformanceSnapshotPoint[] = [];

  for (const imp of portfolioImports) {
    const asOf = imp.dataToDate ?? imp.importedAt;
    const asOfStr = isoDate(asOf);
    for (const acc of imp.accounts) {
      const accountKey = makeAccountKey(
        acc.accountName,
        acc.currency,
        acc.accountNumber,
      );
      snapshots.push({
        accountKey,
        asOf: asOfStr,
        totalValueNative: acc.totalValue,
        currency: normalizeCurrency(acc.currency),
      });
    }
  }

  for (const snap of extSnapshots) {
    snapshots.push({
      accountKey: snap.externalAccount.accountKey,
      asOf: isoDate(snap.asOfDate),
      totalValueNative: snap.totalValue,
      currency: normalizeCurrency(snap.externalAccount.currency),
    });
  }

  const yearSet = new Set<number>();
  const nowYear = new Date().getFullYear();
  yearSet.add(nowYear);

  const [historyPoints, dailyTotalsCad] = await Promise.all([
    loadPerformanceAccountHistory(),
    loadPerformanceDailyTotalsCad(usdToCad),
  ]);

  for (const s of snapshots) {
    yearSet.add(Number(s.asOf.slice(0, 4)));
  }
  for (const h of historyPoints) {
    yearSet.add(Number(h.asOf.slice(0, 4)));
  }
  for (const d of dailyTotalsCad) {
    yearSet.add(Number(d.date.slice(0, 4)));
  }
  const availableYears = [...yearSet].toSorted((a, b) => b - a);

  const quotesAsOf =
    quotes.length > 0
      ? new Date(Math.max(...quotes.map((q) => q.fetchedAt.getTime()))).toISOString()
      : null;

  const cashFlows: PerformanceCashFlow[] = [];
  for (const tx of txFlows) {
    if (!tx.accountKey || !tx.tradeDate || !tx.txCategory) continue;
    const amount = tx.amount;
    if (amount === null || !Number.isFinite(amount) || Math.abs(amount) < 0.01) continue;
    cashFlows.push({
      accountKey: tx.accountKey,
      tradeDate: isoDate(tx.tradeDate),
      txCategory: tx.txCategory as PerformanceCashFlow["txCategory"],
      amountCad: toCad(amount, tx.currency ?? "CAD", usdToCad),
    });
  }

  const performanceHoldings: PerformanceHoldingRow[] = holdings
    .filter((h) => h.quantity > 0)
    .map((h) => ({
      accountKey: h.accountKey,
      ticker: h.ticker.toUpperCase(),
      currency: normalizeCurrency(h.currency),
      quantity: h.quantity,
    }));

  const { sessionEnd, sessionStart } = yesterdayCloseDates(new Date());
  const closeFrom = sessionStart;
  const closeTo = isoDate(new Date());

  const uniquePairs = [
    ...new Map(
      performanceHoldings.map((h) => [
        `${h.ticker}|${h.currency}`,
        { ticker: h.ticker, currency: h.currency },
      ]),
    ).values(),
  ];

  let closeMap = await loadDailyCloseMap(performanceHoldings, closeFrom, closeTo);
  let needingChart = pairsNeedingChartHistory(uniquePairs, closeMap, sessionEnd);
  if (needingChart.length > 0) {
    const fetched = await fetchChartClosesInMemory(
      needingChart.map((p) => ({
        ...p,
        yahooSymbol: yahooSymbolForPair(p.ticker, p.currency),
      })),
    );
    closeMap = new Map([...closeMap, ...fetched]);
  }
  for (const q of quotes) {
    if (q.previousClose != null && q.previousClose > 0) {
      const key = dailyCloseKey(q.ticker, q.currency, sessionEnd);
      if (!closeMap.has(key)) {
        closeMap.set(key, q.previousClose);
      }
    }
  }

  const dailyCloses: Record<string, number> = {};
  for (const [key, value] of closeMap) {
    dailyCloses[key] = value;
  }

  return {
    accounts,
    currentByAccount,
    snapshots,
    historyPoints,
    dailyTotalsCad,
    cashFlows,
    holdings: performanceHoldings,
    dailyCloses,
    usdToCad,
    usdToCadDate: fxRow?.rateDate ? isoDate(fxRow.rateDate) : null,
    availableYears,
    quotesAsOf,
    asOfNow: isoDate(new Date()),
  };
}
