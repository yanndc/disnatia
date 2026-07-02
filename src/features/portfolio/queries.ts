import { prisma } from "@/lib/db/prisma";
import { sanitizePortfolioOwner, portfolioOwnerKey, portfolioOwnersMatch } from "@/lib/portfolio/sanitize-portfolio-owner";
import { resolveNonFinancialAssetOwnerShares } from "@/lib/portfolio/non-financial-asset-owner-shares";
import { buildOwnerDimensionResolver } from "@/lib/portfolio/owner-dimension-resolver";
import { listExternalAccountsWithLatest } from "./external-accounts-queries";
import { listNonFinancialAssetsWithLatest } from "./non-financial-assets-queries";
import { loadHoldingsForDashboard } from "./holdings-display-query";
import { priorSessionCloseByPair } from "./daily-close-prices";
import {
  enrichPositionRow,
  indexQuotesByTickerCurrency,
  withDisplayWeights,
  type EnrichedPosition,
} from "./live-enrichment";
import { getUsdCadRateNear } from "@/lib/fx/latest-usd-cad-rate";
import { makeAccountKey } from "./upsert-portfolio-state";
import { formatAccountNumber } from "@/lib/utils";
import {
  formatAggregatedTickerLabel,
  resolveAggregationGroupMeta,
} from "@/features/portfolio/ticker-aggregation-groups";

export type { EnrichedPosition };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

/** Valeur en CAD approximatif : USD × taux, autres devises laissées telles quelles. */
function toCadEquivalent(value: number, currency: string, usdToCad: number): number {
  const cur = currency.trim().toUpperCase();
  if (cur === "USD" || cur === "US") return value * usdToCad;
  if (cur === "CAD" || cur === "CAN" || cur === "CDN") return value;
  return value;
}

function positionDisplayValueCad(
  p: EnrichedPosition,
  usdToCad: number | null,
): number {
  return usdToCad !== null
    ? toCadEquivalent(p.displayMarketValue, p.currency, usdToCad)
    : p.displayMarketValue;
}

/**
 * Agrège toutes les lignes du même titre (plusieurs comptes) : valeur totale en CAD équivalent,
 * puis poids vs valeur totale du portefeuille (titres + encaisse).
 */
function buildAggregatedTickerRows(
  enrichedPositions: EnrichedPosition[],
  usdToCad: number | null,
  totalPortfolioValue: number,
): { ticker: string; marketValue: number; weightPct: number }[] {
  const buckets = new Map<
    string,
    { marketValue: number; tickers: Set<string>; groupLabel: string | null }
  >();
  for (const p of enrichedPositions) {
    const raw = p.ticker.trim();
    if (!raw) continue;
    const { mapKey, groupLabel, token } = resolveAggregationGroupMeta(raw);
    const add = positionDisplayValueCad(p, usdToCad);
    let b = buckets.get(mapKey);
    if (!b) {
      b = { marketValue: 0, tickers: new Set(), groupLabel };
      buckets.set(mapKey, b);
    }
    b.marketValue += add;
    b.tickers.add(token);
    if (groupLabel) b.groupLabel = groupLabel;
  }
  const denom = totalPortfolioValue > 0 ? totalPortfolioValue : 0;
  return [...buckets.values()]
    .map((row) => ({
      ticker: formatAggregatedTickerLabel(row),
      marketValue: row.marketValue,
      weightPct: denom > 0 ? (row.marketValue / denom) * 100 : 0,
    }))
    .toSorted((a, b) => b.marketValue - a.marketValue);
}

/**
 * Poids des positions : base en équivalent CAD si un taux est disponible,
 * sinon somme des valeurs affichées (peut mélanger USD et CAD).
 */
function withDisplayWeightsCad(
  positions: EnrichedPosition[],
  usdToCad: number | null,
): EnrichedPosition[] {
  const totals = positions.map((p) => positionDisplayValueCad(p, usdToCad));
  const total = totals.reduce((s, v) => s + v, 0);
  if (total <= 0) return positions;
  return positions.map((p, i) => ({
    ...p,
    weightPct: (totals[i]! / total) * 100,
  }));
}

function uniqueTickerCurrencyPairs(
  holdings: { ticker: string; currency: string }[],
): { ticker: string; currency: string }[] {
  return [
    ...new Map(
      holdings.map((h) => [
        `${h.ticker.toUpperCase()}|${h.currency.toUpperCase()}`,
        { ticker: h.ticker.toUpperCase(), currency: h.currency.toUpperCase() },
      ]),
    ).values(),
  ];
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

// ---------------------------------------------------------------------------
// État courant synthétisé — PortfolioHolding + PortfolioAccountState
// ---------------------------------------------------------------------------

/** Titres courants : projection transactions + cours (jamais les lignes copiées du CSV portefeuille). */
export async function getAllPositions(): Promise<EnrichedPosition[]> {
  const holdings = await loadHoldingsForDashboard();
  if (holdings.length === 0) return [];

  const quotes = await loadQuotesForHoldings(holdings);
  const quoteMap = indexQuotesByTickerCurrency(quotes);
  const priorCloseByPair = await priorSessionCloseByPair(
    uniqueTickerCurrencyPairs(holdings),
  );
  const rows = holdings.map((h) => {
    const pairKey = `${h.ticker.toUpperCase()}|${h.currency.toUpperCase()}`;
    return enrichPositionRow(
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
  });

  return withDisplayWeights(rows).toSorted((a, b) => b.displayMarketValue - a.displayMarketValue);
}

/** Résumé du tableau de bord, basé sur l'état synthétisé. */
export async function getPortfolioSummary() {
  const [holdings, accountStates, anyImportCount, txGlobal, externalAccounts, nonFinancialAssets, ownerResolver] = await Promise.all([
    loadHoldingsForDashboard(),
    prisma.portfolioAccountState.findMany(),
    prisma.portfolioImport.count(),
    prisma.portfolioTransactionLine.aggregate({
      _min: { tradeDate: true },
      _max: { tradeDate: true },
      _count: { _all: true },
    }),
    listExternalAccountsWithLatest(),
    listNonFinancialAssetsWithLatest(),
    buildOwnerDimensionResolver(),
  ]);

  const externalWithValue = externalAccounts.filter((a) => a.latestSnapshot !== null);
  const externalAccountsCount = externalWithValue.length;
  const nonFinancialWithValue = nonFinancialAssets.filter(
    (a) => a.isActive && a.latestSnapshot !== null,
  );
  const nonFinancialAssetsCount = nonFinancialWithValue.length;

  if (
    holdings.length === 0 &&
    accountStates.length === 0 &&
    externalAccountsCount === 0 &&
    nonFinancialAssetsCount === 0
  ) {
    return { ...emptySummary(), hasAnyImportsInHistory: anyImportCount > 0 };
  }

  const quotes = await loadQuotesForHoldings(holdings);
  const quoteMap = indexQuotesByTickerCurrency(quotes);
  const priorCloseByPair = await priorSessionCloseByPair(
    uniqueTickerCurrencyPairs(holdings),
  );

  const enrichedPositionsBase = holdings.map((h) => {
    const pairKey = `${h.ticker.toUpperCase()}|${h.currency.toUpperCase()}`;
    return enrichPositionRow(
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
  });

  const holdingAsOfSource = holdings.map((h) => h.asOf);
  const externalAsOf = externalWithValue
    .map((a) => a.latestSnapshot!.asOfDate)
    .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));
  const nonFinancialAsOf = nonFinancialWithValue
    .map((a) => a.latestSnapshot!.asOfDate)
    .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));
  const allAsOf = [
    ...accountStates.map((a) => a.asOf),
    ...holdingAsOfSource,
    ...externalAsOf,
    ...nonFinancialAsOf,
  ].filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));
  const referenceAsOf =
    allAsOf.length > 0 ? new Date(Math.max(...allAsOf.map((d) => d.getTime()))) : null;
  const snapshotDataFrom =
    allAsOf.length > 0 ? new Date(Math.min(...allAsOf.map((d) => d.getTime()))) : null;

  const fxRow = await getUsdCadRateNear(referenceAsOf);
  const usdToCad = fxRow?.usdToCad ?? null;

  const enrichedPositions = withDisplayWeightsCad(enrichedPositionsBase, usdToCad);

  const cashValue =
    usdToCad !== null
      ? sum(accountStates.map((a) => toCadEquivalent(a.cashValue, a.currency, usdToCad)))
      : sum(accountStates.map((a) => a.cashValue));
  const disnatReferenceTotalValue =
    usdToCad !== null
      ? sum(accountStates.map((a) => toCadEquivalent(a.totalValue, a.currency, usdToCad)))
      : sum(accountStates.map((a) => a.totalValue));
  const displayPositionsValue = sum(
    enrichedPositions.map((p) => positionDisplayValueCad(p, usdToCad)),
  );

  const externalTotalCad =
    usdToCad !== null
      ? sum(
          externalWithValue.map((a) =>
            toCadEquivalent(a.latestSnapshot!.totalValue, a.currency, usdToCad),
          ),
        )
      : sum(externalWithValue.map((a) => a.latestSnapshot!.totalValue));

  const nonFinancialTotalCad =
    usdToCad !== null
      ? sum(
          nonFinancialWithValue.map((a) =>
            toCadEquivalent(a.latestSnapshot!.netEquity, a.currency, usdToCad),
          ),
        )
      : sum(nonFinancialWithValue.map((a) => a.latestSnapshot!.netEquity));

  const disnatPositionsValue = sum(
    enrichedPositions.map((p) =>
      usdToCad !== null
        ? toCadEquivalent(p.disnatMarketValue, p.currency, usdToCad)
        : p.disnatMarketValue,
    ),
  );
  const totalValue = displayPositionsValue + cashValue + externalTotalCad + nonFinancialTotalCad;
  const disnatLiveTotalValue = displayPositionsValue + cashValue;

  const driftVsDisnatPct =
    disnatReferenceTotalValue > 0
      ? ((disnatLiveTotalValue - disnatReferenceTotalValue) / disnatReferenceTotalValue) * 100
      : null;

  const quotesAsOf =
    quotes.length > 0
      ? new Date(Math.max(...quotes.map((q) => q.fetchedAt.getTime())))
      : null;
  const matchedQuotes = enrichedPositions.filter((p) => p.usesLiveQuote).length;

  const distinctAccountNumbers = [
    ...new Set([
      ...accountStates.map((a) => formatAccountNumber(a.accountNumber)).filter(Boolean),
      ...holdings.map((h) => formatAccountNumber(h.accountNumber)).filter(Boolean),
    ] as string[]),
  ].slice(0, 24);

  const ownerBreakdownMap = new Map<
    string,
    {
      owner: string;
      totalValue: number;
      cashValue: number;
      marketValue: number;
      accountCount: number;
    }
  >();

  for (const a of accountStates) {
    const resolvedOwner = ownerResolver.resolveAccountOwner(a.accountKey, a.owner);
    const ownerDisplay = resolvedOwner ?? "Inconnu";
    const ownerKey = portfolioOwnerKey(resolvedOwner) ?? ownerDisplay.toLocaleLowerCase("fr-CA");
    const row =
      ownerBreakdownMap.get(ownerKey) ??
      {
        owner: ownerDisplay,
        totalValue: 0,
        cashValue: 0,
        marketValue: 0,
        accountCount: 0,
      };
    if (usdToCad !== null) {
      row.totalValue += toCadEquivalent(a.totalValue, a.currency, usdToCad);
      row.cashValue += toCadEquivalent(a.cashValue, a.currency, usdToCad);
      row.marketValue += toCadEquivalent(a.marketValue, a.currency, usdToCad);
    } else {
      row.totalValue += a.totalValue;
      row.cashValue += a.cashValue;
      row.marketValue += a.marketValue;
    }
    row.accountCount++;
    ownerBreakdownMap.set(ownerKey, row);
  }

  for (const a of externalWithValue) {
    const resolvedOwner = ownerResolver.resolveExternalOwner(a.id, a.owner);
    const ownerDisplay = resolvedOwner ?? "Inconnu";
    const ownerKey = portfolioOwnerKey(resolvedOwner) ?? ownerDisplay.toLocaleLowerCase("fr-CA");
    const row =
      ownerBreakdownMap.get(ownerKey) ??
      {
        owner: ownerDisplay,
        totalValue: 0,
        cashValue: 0,
        marketValue: 0,
        accountCount: 0,
      };
    const v = a.latestSnapshot!.totalValue;
    const add = usdToCad !== null ? toCadEquivalent(v, a.currency, usdToCad) : v;
    row.totalValue += add;
    row.marketValue += add;
    row.accountCount++;
    ownerBreakdownMap.set(ownerKey, row);
  }

  for (const a of nonFinancialWithValue) {
    const allocations = ownerResolver.resolveNonFinancialAssetOwners(
      a.id,
      a.owner,
      a.metadata,
    );
    const v = a.latestSnapshot!.netEquity;
    for (const alloc of allocations) {
      const ownerDisplay = alloc.owner;
      const ownerKey = portfolioOwnerKey(alloc.owner) ?? ownerDisplay.toLocaleLowerCase("fr-CA");
      const row =
        ownerBreakdownMap.get(ownerKey) ??
        {
          owner: ownerDisplay,
          totalValue: 0,
          cashValue: 0,
          marketValue: 0,
          accountCount: 0,
        };
      const allocValueNative = (v * alloc.sharePct) / 100;
      const add =
        usdToCad !== null
          ? toCadEquivalent(allocValueNative, a.currency, usdToCad)
          : allocValueNative;
      row.totalValue += add;
      row.marketValue += add;
      row.accountCount++;
      ownerBreakdownMap.set(ownerKey, row);
    }
  }

  const ownerBreakdown = [...ownerBreakdownMap.values()].map((data) => ({
    owner: data.owner,
    totalValue: data.totalValue,
    cashValue: data.cashValue,
    marketValue: data.marketValue,
    accountCount: data.accountCount,
  }));

  const aggregatedRows = buildAggregatedTickerRows(
    enrichedPositions,
    usdToCad,
    totalValue,
  );
  const topPositions = aggregatedRows.slice(0, 8).map(({ ticker, marketValue }) => ({
    ticker,
    marketValue,
  }));

  const maxConcentration =
    aggregatedRows.length > 0
      ? Math.max(0, ...aggregatedRows.map((r) => r.weightPct))
      : 0;

  const validAccountAsOf = accountStates
    .map((a) => a.asOf)
    .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));
  const disnatReconciliationAsOf =
    validAccountAsOf.length > 0
      ? new Date(Math.max(...validAccountAsOf.map((d) => d.getTime())))
      : null;

  // Import le plus récent (pour l'affichage info seulement)
  const latestImport = await prisma.portfolioImport.findFirst({
    orderBy: { importedAt: "desc" },
    select: { id: true, importedAt: true },
  });

  return {
    latestImportId: latestImport?.id ?? null,
    importedAt: latestImport?.importedAt ?? null,
    snapshotDataFrom,
    snapshotDataTo: referenceAsOf,
    referenceAsOf,
    transactionsGlobalFrom: txGlobal._min.tradeDate,
    transactionsGlobalTo: txGlobal._max.tradeDate,
    transactionsGlobalCount: txGlobal._count._all,
    distinctAccountNumbers,
    totalValue,
    disnatReferenceTotalValue,
    displayPositionsValue,
    disnatLiveTotalValue,
    disnatPositionsValue,
    externalTotalCad,
    nonFinancialTotalCad,
    externalAccountsCount,
    nonFinancialAssetsCount,
    externalAccountsBrief: externalWithValue.map((a) => ({
      id: a.id,
      displayLabel: a.displayLabel,
      owner: a.owner,
      provider: a.provider,
      currency: a.currency,
      valueNative: a.latestSnapshot!.totalValue,
      valueCad:
        usdToCad !== null
          ? toCadEquivalent(a.latestSnapshot!.totalValue, a.currency, usdToCad)
          : a.latestSnapshot!.totalValue,
      asOf: a.latestSnapshot!.asOfDate,
    })),
    nonFinancialAssetsBrief: nonFinancialWithValue.map((a) => ({
      id: a.id,
      assetKey: a.assetKey,
      assetType: a.assetType,
      displayLabel: a.displayLabel,
      owner: a.owner,
      currency: a.currency,
      marketValueNative: a.latestSnapshot!.marketValue,
      mortgageBalanceNative: a.latestSnapshot!.mortgageBalance,
      netEquityNative: a.latestSnapshot!.netEquity,
      netEquityCad:
        usdToCad !== null
          ? toCadEquivalent(a.latestSnapshot!.netEquity, a.currency, usdToCad)
          : a.latestSnapshot!.netEquity,
      asOf: a.latestSnapshot!.asOfDate,
    })),
    driftVsDisnatPct,
    quoteCoverage: { matched: matchedQuotes, total: enrichedPositions.length },
    quotesAsOf,
    cashValue,
    disnatReconciliationAsOf,
    positionCount: enrichedPositions.length,
    currencyExposure: buildCurrencyExposure(enrichedPositions, accountStates),
    topPositions,
    maxConcentration,
    aggregatedTickerExposure: aggregatedRows,
    variationVsPrevious: null as number | null,
    variationPctVsPrevious: null as number | null,
    hasAnyImportsInHistory: anyImportCount > 0,
    accountCount: accountStates.length,
    ownerBreakdown,
    usdToCadRate: fxRow?.usdToCad ?? null,
    usdToCadRateDate: fxRow?.rateDate ?? null,
    totalsInCadEquivalent: usdToCad !== null,
  };
}

// ---------------------------------------------------------------------------
// Autres requêtes du tableau de bord
// ---------------------------------------------------------------------------

export async function getTopPositions(limit = 5) {
  const summary = await getPortfolioSummary();
  return summary.topPositions.slice(0, Math.max(1, limit));
}

export async function getCurrencyExposure() {
  const [positions, accountStates] = await Promise.all([
    getAllPositions(),
    prisma.portfolioAccountState.findMany(),
  ]);
  return buildCurrencyExposure(positions, accountStates);
}

export async function getConcentrationRisk() {
  const summary = await getPortfolioSummary();
  if (
    summary.positionCount === 0 &&
    summary.accountCount === 0 &&
    summary.externalAccountsCount === 0 &&
    summary.nonFinancialAssetsCount === 0
  ) {
    return {
      topWeight: 0,
      concentratedPositions: [] as { ticker: string; marketValue: number; weightPct: number }[],
      note: "Portefeuille vide.",
    };
  }
  const rows = summary.aggregatedTickerExposure;
  const concentrated = rows.filter((r) => r.weightPct >= 10);
  const topWeight = rows[0]?.weightPct ?? summary.maxConcentration;
  return {
    topWeight,
    concentratedPositions: concentrated.map((r) => ({
      ticker: r.ticker,
      marketValue: r.marketValue,
      weightPct: r.weightPct,
    })),
    note:
      concentrated.length > 0
        ? "Au moins un titre (somme de tous les comptes) dépasse 10% du portefeuille."
        : "Aucun titre agrégé ne dépasse 10%.",
  };
}

export async function getImportHistory() {
  const imports = await prisma.portfolioImport.findMany({
    orderBy: { importedAt: "desc" },
    take: 20,
    select: {
      id: true,
      sourceFileName: true,
      sourceFileKept: true,
      importedAt: true,
      dataFromDate: true,
      dataToDate: true,
      status: true,
      importType: true,
      rawHeaderJson: true,
      rawRowCount: true,
      notes: true,
      _count: {
        select: { positions: true, accounts: true, transactions: true },
      },
      accounts: {
        select: { accountName: true, accountNumber: true, currency: true },
      },
    },
  });

  const ids = imports.map((i) => i.id);
  const txKeyGroups =
    ids.length === 0
      ? []
      : await prisma.portfolioTransactionLine.groupBy({
          by: ["importId", "accountKey"],
          where: { importId: { in: ids }, accountKey: { not: null } },
        });

  const txKeysByImport = new Map<string, Set<string>>();
  for (const row of txKeyGroups) {
    if (!row.accountKey) continue;
    const set = txKeysByImport.get(row.importId) ?? new Set();
    set.add(row.accountKey);
    txKeysByImport.set(row.importId, set);
  }

  return imports.map((imp) => {
    const fromAccounts = imp.accounts.map((a) =>
      makeAccountKey(a.accountName, a.currency, a.accountNumber),
    );
    const fromTx = [...(txKeysByImport.get(imp.id) ?? [])];
    const linkedAccountKeys = [...new Set([...fromAccounts, ...fromTx])];
    const { accounts: _accounts, ...rest } = imp;
    return { ...rest, linkedAccountKeys };
  });
}

export async function getLatestImportInfo() {
  const latest = await prisma.portfolioImport.findFirst({
    orderBy: { importedAt: "desc" },
    select: {
      id: true,
      sourceFileName: true,
      importedAt: true,
      rawRowCount: true,
      status: true,
      notes: true,
    },
  });
  if (!latest) return null;
  return {
    id: latest.id,
    sourceFileName: latest.sourceFileName,
    importedAt: latest.importedAt,
    rawRowCount: latest.rawRowCount,
    status: latest.status,
    notes: latest.notes,
  };
}

export async function simulateRebalance(input: {
  fromTicker: string;
  toTicker: string;
  amountCad: number;
}) {
  const positions = await getAllPositions();
  const from = positions.find(
    (p) => p.ticker.toUpperCase() === input.fromTicker.toUpperCase(),
  );
  const to = positions.find(
    (p) => p.ticker.toUpperCase() === input.toTicker.toUpperCase(),
  );
  const total = sum(positions.map((p) => p.displayMarketValue));
  if (!from || !to || total <= 0) {
    return { possible: false, reason: "Ticker source ou destination introuvable." };
  }
  return {
    possible: true,
    fromTicker: from.ticker,
    toTicker: to.ticker,
    amountCad: input.amountCad,
    before: { [from.ticker]: from.weightPct ?? 0, [to.ticker]: to.weightPct ?? 0 },
    after: {
      [from.ticker]: ((from.displayMarketValue - input.amountCad) / total) * 100,
      [to.ticker]: ((to.displayMarketValue + input.amountCad) / total) * 100,
    },
    caveat: "Simulation simplifiée en CAD, sans frais, fiscalité, devise ni variation de prix.",
  };
}

// ---------------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------------

export async function getAccountsWithStats() {
  const accounts = await prisma.portfolioAccountState.findMany({
    orderBy: [{ accountType: "asc" }, { currency: "asc" }],
  });

  const holdings = await loadHoldingsForDashboard();
  const reconstructedByAccountKey = new Map<string, number>();
  if (holdings.length > 0) {
    const quotes = await loadQuotesForHoldings(holdings);
    const quoteMap = indexQuotesByTickerCurrency(quotes);
    const priorCloseByPair = await priorSessionCloseByPair(
      uniqueTickerCurrencyPairs(holdings),
    );
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
      reconstructedByAccountKey.set(
        h.accountKey,
        (reconstructedByAccountKey.get(h.accountKey) ?? 0) + enriched.displayMarketValue,
      );
    }
  }

  // Nombre de transactions par compte
  const txCounts = await prisma.portfolioTransactionLine.groupBy({
    by: ["accountKey"],
    _count: { id: true },
    where: { accountKey: { not: null } },
  });
  const txByKey = new Map(txCounts.map((r) => [r.accountKey, r._count.id]));

  // Dernière transaction par compte
  const latestTx = await prisma.portfolioTransactionLine.findMany({
    where: { accountKey: { not: null } },
    orderBy: { settlementDate: "desc" },
    distinct: ["accountKey"],
    select: { accountKey: true, settlementDate: true, tradeDate: true },
  });
  const lastTxByKey = new Map(
    latestTx.map((r) => [
      r.accountKey,
      r.settlementDate ?? r.tradeDate ?? null,
    ]),
  );

  const hasHoldings = holdings.length > 0;
  return accounts.map((a) => {
    const reconstructedMarketValue = hasHoldings
      ? (reconstructedByAccountKey.get(a.accountKey) ?? 0)
      : null;
    const driftTitresVsSnapshot =
      reconstructedMarketValue === null ? null : reconstructedMarketValue - a.marketValue;
    const displayTotalValue =
      reconstructedMarketValue !== null
        ? a.cashValue + reconstructedMarketValue
        : a.totalValue;
    return {
      ...a,
      txCount: txByKey.get(a.accountKey) ?? 0,
      lastTxDate: lastTxByKey.get(a.accountKey) ?? null,
      reconstructedMarketValue,
      driftTitresVsSnapshot,
      displayTotalValue,
    };
  });
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export async function getTransactions(opts?: {
  accountKey?: string;
  owner?: string;
  txCategory?: string;
  ticker?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}) {
  const where: Record<string, unknown> = {};

  if (opts?.owner) {
    const ownerAccounts = await prisma.portfolioAccountState.findMany({
      select: { accountKey: true, owner: true },
    });
    where.accountKey = {
      in: ownerAccounts
        .filter((a) => portfolioOwnersMatch(a.owner, opts.owner))
        .map((a) => a.accountKey),
    };
  }

  if (opts?.accountKey) where.accountKey = opts.accountKey;
  if (opts?.txCategory) where.txCategory = opts.txCategory;
  if (opts?.ticker) where.ticker = { contains: opts.ticker.toUpperCase(), mode: "insensitive" };
  if (opts?.fromDate ?? opts?.toDate) {
    where.settlementDate = {
      ...(opts.fromDate ? { gte: opts.fromDate } : {}),
      ...(opts.toDate ? { lte: opts.toDate } : {}),
    };
  }

  const [rows, total] = await Promise.all([
    prisma.portfolioTransactionLine.findMany({
      where,
      orderBy: { settlementDate: "desc" },
      take: opts?.limit ?? 200,
      skip: opts?.offset ?? 0,
      select: {
        id: true,
        accountKey: true,
        accountName: true,
        tradeDate: true,
        settlementDate: true,
        transactionType: true,
        txCategory: true,
        ticker: true,
        securityName: true,
        market: true,
        currency: true,
        assetClass: true,
        quantity: true,
        price: true,
        amount: true,
        fees: true,
      },
    }),
    prisma.portfolioTransactionLine.count({ where }),
  ]);

  return { rows, total };
}

// ---------------------------------------------------------------------------
// Revenus (dividendes, intérêts, retenues)
// ---------------------------------------------------------------------------

export async function getIncomeByYear() {
  const rows = await prisma.portfolioTransactionLine.findMany({
    where: {
      txCategory: { in: ["DIVIDEND", "STOCK_DIVIDEND", "INTEREST", "TAX_WITHHOLD"] },
      amount: { not: null },
    },
    select: {
      txCategory: true,
      settlementDate: true,
      tradeDate: true,
      currency: true,
      amount: true,
      ticker: true,
      securityName: true,
      accountKey: true,
    },
    orderBy: { settlementDate: "desc" },
  });

  type YearEntry = {
    year: number;
    DIVIDEND: number;
    STOCK_DIVIDEND: number;
    INTEREST: number;
    TAX_WITHHOLD: number;
    byAccount: Map<string, number>;
  };

  const byYear = new Map<number, YearEntry>();

  for (const row of rows) {
    const date = row.settlementDate ?? row.tradeDate;
    if (!date || row.amount === null) continue;
    const year = date.getFullYear();
    if (!byYear.has(year)) {
      byYear.set(year, {
        year,
        DIVIDEND: 0,
        STOCK_DIVIDEND: 0,
        INTEREST: 0,
        TAX_WITHHOLD: 0,
        byAccount: new Map(),
      });
    }
    const entry = byYear.get(year)!;
    const cat = row.txCategory as keyof Omit<YearEntry, "year" | "byAccount">;
    if (cat in entry) {
      (entry[cat] as number) += row.amount;
    }
    const ak = row.accountKey ?? "—";
    entry.byAccount.set(ak, (entry.byAccount.get(ak) ?? 0) + row.amount);
  }

  return Array.from(byYear.values())
    .sort((a, b) => b.year - a.year)
    .map((e) => ({
      ...e,
      byAccount: Array.from(e.byAccount.entries()).map(([accountKey, amount]) => ({
        accountKey,
        amount,
      })),
    }));
}

// ---------------------------------------------------------------------------
// Fonctions légacy — gardées pour compatibilité avec refresh-live-quotes.ts
// ---------------------------------------------------------------------------

export async function getLatestPortfolioImport() {
  return prisma.portfolioImport.findFirst({
    orderBy: { importedAt: "desc" },
    select: {
      id: true,
      sourceFileName: true,
      sourceFileKept: true,
      importedAt: true,
      dataFromDate: true,
      dataToDate: true,
      status: true,
      importType: true,
      rawHeaderJson: true,
      rawRowCount: true,
      notes: true,
      accounts: true,
      positions: true,
    },
  });
}

/** @deprecated Utiliser getPortfolioSummary(). Conservé pour refresh-live-quotes. */
export async function getLatestDashboardImport() {
  const candidates = await prisma.portfolioImport.findMany({
    where: { OR: [{ positions: { some: {} } }, { accounts: { some: {} } }] },
    orderBy: { importedAt: "desc" },
    take: 40,
    select: {
      id: true,
      sourceFileName: true,
      sourceFileKept: true,
      importedAt: true,
      dataFromDate: true,
      dataToDate: true,
      status: true,
      importType: true,
      rawHeaderJson: true,
      rawRowCount: true,
      notes: true,
      accounts: true,
      positions: true,
    },
  });
  if (candidates.length === 0) return null;
  return candidates.toSorted(
    (a, b) =>
      (b.dataToDate?.getTime() ?? b.importedAt.getTime()) -
      (a.dataToDate?.getTime() ?? a.importedAt.getTime()),
  )[0];
}

// ---------------------------------------------------------------------------
// Helpers internes
// ---------------------------------------------------------------------------

function buildCurrencyExposure(
  positions: EnrichedPosition[],
  accountStates: { currency: string; cashValue: number }[],
) {
  const exposure = new Map<string, number>();
  positions.forEach((p) => {
    exposure.set(p.currency, (exposure.get(p.currency) ?? 0) + p.displayMarketValue);
  });
  accountStates.forEach((a) => {
    exposure.set(a.currency, (exposure.get(a.currency) ?? 0) + a.cashValue);
  });
  return Array.from(exposure.entries()).map(([currency, value]) => ({ currency, value }));
}

function emptySummary() {
  return {
    latestImportId: null as string | null,
    importedAt: null as Date | null,
    snapshotDataFrom: null as Date | null,
    snapshotDataTo: null as Date | null,
    referenceAsOf: null as Date | null,
    transactionsGlobalFrom: null as Date | null,
    transactionsGlobalTo: null as Date | null,
    transactionsGlobalCount: 0,
    distinctAccountNumbers: [] as string[],
    totalValue: 0,
    disnatReferenceTotalValue: 0,
    disnatLiveTotalValue: 0,
    displayPositionsValue: 0,
    disnatPositionsValue: 0,
    externalTotalCad: 0,
    nonFinancialTotalCad: 0,
    externalAccountsCount: 0,
    nonFinancialAssetsCount: 0,
    externalAccountsBrief: [] as {
      id: string;
      displayLabel: string;
      owner: string | null;
      provider: string;
      currency: string;
      valueNative: number;
      valueCad: number;
      asOf: Date;
    }[],
    nonFinancialAssetsBrief: [] as {
      id: string;
      assetKey: string;
      assetType: "REAL_ESTATE" | "VEHICLE" | "PRIVATE_BUSINESS" | "OTHER";
      displayLabel: string;
      owner: string | null;
      currency: string;
      marketValueNative: number;
      mortgageBalanceNative: number;
      netEquityNative: number;
      netEquityCad: number;
      asOf: Date;
    }[],
    driftVsDisnatPct: null as number | null,
    quoteCoverage: { matched: 0, total: 0 },
    quotesAsOf: null as Date | null,
    cashValue: 0,
    disnatReconciliationAsOf: null as Date | null,
    positionCount: 0,
    accountCount: 0,
    currencyExposure: [] as { currency: string; value: number }[],
    topPositions: [] as { ticker: string; marketValue: number }[],
    maxConcentration: 0,
    aggregatedTickerExposure: [] as { ticker: string; marketValue: number; weightPct: number }[],
    variationVsPrevious: null as number | null,
    variationPctVsPrevious: null as number | null,
    hasAnyImportsInHistory: false,
    ownerBreakdown: [] as { owner: string; totalValue: number; cashValue: number; marketValue: number; accountCount: number }[],
    usdToCadRate: null as number | null,
    usdToCadRateDate: null as Date | null,
    totalsInCadEquivalent: false,
  };
}
