import { prisma } from "@/lib/db/prisma";
import { getUsdCadRateNear } from "@/lib/fx/latest-usd-cad-rate";
import { sanitizePortfolioOwner } from "@/lib/portfolio/sanitize-portfolio-owner";
import { formatAccountNumber, normalizeCurrency } from "@/lib/utils";
import { loadHoldingsForDashboard } from "./holdings-display-query";
import {
  enrichPositionRow,
  indexQuotesByTickerCurrency,
  type EnrichedPosition,
} from "./live-enrichment";
import { listExternalAccountsWithLatest } from "./external-accounts-queries";
import { makeAccountKey } from "./upsert-portfolio-state";
import {
  ensureDailyClosesPersistedForPairs,
  loadDailyCloseMap,
  pairsNeedingChartHistory,
  priorSessionCloseByPair,
  yesterdayCloseDates,
} from "./daily-close-prices";
import type {
  PerformanceAccountCurrent,
  PerformanceAccountRef,
  PerformanceCashFlow,
  PerformanceEnrichedHoldingRow,
  PerformanceHoldingRow,
  PerformanceIndicatorPayload,
  PerformanceSnapshotPoint,
} from "./performance-indicator-types";
import {
  loadPerformanceAccountHistory,
  loadPerformanceDailyTotalsCad,
} from "./performance-history-loader";
import {
  loadPersistedSessionGainsByAccount,
} from "./performance-session-gains";
import { isoDateInToronto, isEquityMarketSessionOpen } from "@/lib/market/equity-session";
import { subYears } from "date-fns";
import { isoDateFromDbDate } from "./daily-close-key";
import {
  getLatestQuotesFetchedAt,
  quotesAreStale,
  refreshLiveQuotesForLatestImport,
} from "./refresh-live-quotes";

const DASHBOARD_QUOTES_MAX_AGE_MINUTES = 30;

async function ensureFreshQuotesDuringSession(now = new Date()): Promise<void> {
  if (!isEquityMarketSessionOpen(now)) return;
  const quotesAsOf = await getLatestQuotesFetchedAt();
  if (!quotesAreStale(quotesAsOf, DASHBOARD_QUOTES_MAX_AGE_MINUTES, now.getTime())) {
    return;
  }
  await refreshLiveQuotesForLatestImport().catch((cause) => {
    console.warn("[performance] refreshLiveQuotesForLatestImport", cause);
  });
}

function toCad(value: number, currency: string, usdToCad: number | null): number {
  const cur = normalizeCurrency(currency);
  if (cur === "USD") return usdToCad !== null ? value * usdToCad : value;
  return value;
}

type DayStateCad = {
  dayGainCad: number | null;
  dayPriorCad: number | null;
};

function sumPositionsCad(rows: EnrichedPosition[], usdToCad: number | null): number {
  return rows.reduce(
    (sum, row) => sum + toCad(row.displayMarketValue, row.currency, usdToCad),
    0,
  );
}

function dayStateCadForRows(
  rows: EnrichedPosition[],
  usdToCad: number | null,
): DayStateCad {
  const withQty = rows.filter((row) => row.quantity > 0);
  if (withQty.length === 0) {
    return { dayGainCad: null, dayPriorCad: null };
  }

  const known = withQty.filter(
    (row) =>
      row.displayDayGainLoss !== null && Number.isFinite(row.displayDayGainLoss),
  );
  if (known.length === 0) {
    return { dayGainCad: null, dayPriorCad: null };
  }

  let dayGainCad = 0;
  let dayPriorCad = 0;
  for (const row of known) {
    const gainNative = row.displayDayGainLoss ?? 0;
    const priorNative = row.displayMarketValue - gainNative;
    dayGainCad += toCad(gainNative, row.currency, usdToCad);
    if (Number.isFinite(priorNative) && priorNative > 0) {
      dayPriorCad += toCad(priorNative, row.currency, usdToCad);
    }
  }

  return {
    dayGainCad,
    dayPriorCad: dayPriorCad > 0 ? dayPriorCad : null,
  };
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
  await ensureFreshQuotesDuringSession();
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
  const uniquePairs = [
    ...new Map(
      holdings.map((h) => [
        `${h.ticker.toUpperCase()}|${h.currency.toUpperCase()}`,
        { ticker: h.ticker.toUpperCase(), currency: h.currency.toUpperCase() },
      ]),
    ).values(),
  ];
  const priorCloseByPair = await priorSessionCloseByPair(uniquePairs);
  const fxRow = await getUsdCadRateNear(new Date());
  const usdToCad = fxRow?.usdToCad ?? null;

  const positionsByAccount = new Map<string, ReturnType<typeof enrichPositionRow>[]>();
  const enrichedHoldings: PerformanceEnrichedHoldingRow[] = [];
  for (const h of holdings) {
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
    const list = positionsByAccount.get(h.accountKey) ?? [];
    list.push(enriched);
    positionsByAccount.set(h.accountKey, list);
    if (h.quantity > 0) {
      enrichedHoldings.push({
        accountKey: h.accountKey,
        ticker: h.ticker.toUpperCase(),
        securityName: (h.securityName ?? "").trim() || h.ticker.toUpperCase(),
        currency: normalizeCurrency(h.currency),
        quantity: h.quantity,
        quoteChangePerShare: enriched.quoteChangePerShare,
        displayDayGainLoss: enriched.displayDayGainLoss,
      });
    }
  }

  const accounts: PerformanceAccountRef[] = [];
  const currentByAccount: Record<string, PerformanceAccountCurrent> = {};

  for (const a of accountStates) {
    const rows = positionsByAccount.get(a.accountKey) ?? [];
    const cashNative = a.cashValue;
    const positionsCad = sumPositionsCad(rows, usdToCad);
    const cashCad = toCad(cashNative, a.currency, usdToCad);
    const totalCad = positionsCad + cashCad;
    const dayState = dayStateCadForRows(rows, usdToCad);

    const dayGainCad = dayState.dayGainCad;
    const dayPriorCad = dayState.dayPriorCad;

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

  const disnatAccountKeys = accounts.filter((a) => !a.isExternal).map((a) => a.accountKey);
  const now = new Date();
  const sessionGainTo = isoDate(now);
  const defaultSessionGainFrom = isoDate(subYears(now, 4));

  const [historyPoints, dailyTotalsCad, earliestSessionGainRow] = await Promise.all([
    loadPerformanceAccountHistory(defaultSessionGainFrom),
    loadPerformanceDailyTotalsCad(usdToCad),
    disnatAccountKeys.length > 0
      ? prisma.portfolioDailyAccountSessionGain.findFirst({
          where: { accountKey: { in: disnatAccountKeys } },
          orderBy: { sessionDate: "asc" },
          select: { sessionDate: true },
        })
      : Promise.resolve(null),
  ]);

  const sessionGainFrom = earliestSessionGainRow
    ? isoDateFromDbDate(earliestSessionGainRow.sessionDate)
    : defaultSessionGainFrom;

  const sessionGainsByAccount = await loadPersistedSessionGainsByAccount(
    disnatAccountKeys,
    sessionGainFrom,
    sessionGainTo,
    usdToCad,
  );

  const sessionGainsByDate = disnatAccountKeys
    .flatMap((key) => sessionGainsByAccount[key] ?? [])
    .reduce((map, g) => {
      const bucket = map.get(g.date) ?? { gainCad: 0, priorCad: 0 };
      bucket.gainCad += g.gainCad;
      bucket.priorCad += g.priorCad;
      map.set(g.date, bucket);
      return map;
    }, new Map<string, { gainCad: number; priorCad: number }>());

  const sessionGainsByDateList = [...sessionGainsByDate.entries()]
    .map(([date, v]) => ({ date, gainCad: v.gainCad, priorCad: v.priorCad }))
    .toSorted((a, b) => a.date.localeCompare(b.date));
  const sessionDataHealth = {
    ok: sessionGainsByDateList.length > 0,
    message:
      sessionGainsByDateList.length > 0
        ? null
        : "Aucune séance persistée dans portfolio_daily_account_session_gains. Recalcul requis avant affichage fiable.",
    persistedDays: sessionGainsByDateList.length,
    firstDate: sessionGainsByDateList[0]?.date ?? null,
    lastDate: sessionGainsByDateList.at(-1)?.date ?? null,
  };

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

  const closeHistoryPairs = [
    ...new Map(
      performanceHoldings.map((h) => [
        `${h.ticker}|${h.currency}`,
        { ticker: h.ticker, currency: h.currency },
      ]),
    ).values(),
  ];

  let closeMap = await loadDailyCloseMap(performanceHoldings, closeFrom, closeTo);
  const needingHistory = pairsNeedingChartHistory(closeHistoryPairs, closeMap, sessionEnd);
  if (needingHistory.length > 0) {
    const { sessionStart: priorForEnd } = yesterdayCloseDates();
    const datesToEnsure = [sessionEnd, priorForEnd].filter(
      (d, i, arr) => arr.indexOf(d) === i,
    );
    await ensureDailyClosesPersistedForPairs(needingHistory, datesToEnsure);
    closeMap = await loadDailyCloseMap(performanceHoldings, closeFrom, closeTo);
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
    sessionGainsByDate: sessionGainsByDateList,
    sessionGainsByAccount,
    sessionDataHealth,
    cashFlows,
    holdings: performanceHoldings,
    enrichedHoldings,
    dailyCloses,
    usdToCad,
    usdToCadDate: fxRow?.rateDate ? isoDate(fxRow.rateDate) : null,
    availableYears,
    quotesAsOf,
    asOfNow: new Date().toISOString(),
  };
}
