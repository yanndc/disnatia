import { prisma } from "@/lib/db/prisma";
import {
  enrichPositionRow,
  indexQuotesByTickerCurrency,
  withDisplayWeights,
  type EnrichedPosition,
} from "./live-enrichment";

export type { EnrichedPosition };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
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

/** Toutes les positions courantes (une seule ligne par compte+ticker, la plus récente). */
export async function getAllPositions(): Promise<EnrichedPosition[]> {
  const holdings = await prisma.portfolioHolding.findMany({
    orderBy: { snapshotValue: "desc" },
  });
  if (holdings.length === 0) return [];

  const quotes = await loadQuotesForHoldings(holdings);
  const quoteMap = indexQuotesByTickerCurrency(quotes);

  const rows = holdings.map((h) =>
    enrichPositionRow(
      {
        id: h.id,
        importId: h.sourceImportId,
        accountId: null,
        accountNumber: h.accountNumber ?? null,
        ticker: h.ticker,
        securityName: h.securityName ?? "",
        currency: h.currency,
        quantity: h.quantity,
        averageCost: h.averageCost ?? null,
        marketPrice: h.snapshotPrice ?? null,
        marketValue: h.snapshotValue,
        unrealizedGainLoss: h.unrealizedGainLoss ?? null,
        weightPct: null,
        sector: h.sector ?? null,
        assetType: h.assetType ?? null,
      },
      `${h.accountName}${h.accountNumber ? ` (${h.accountNumber})` : ""}`,
      quoteMap.get(`${h.ticker.toUpperCase()}|${h.currency.toUpperCase()}`),
    ),
  );

  return withDisplayWeights(rows).toSorted((a, b) => b.displayMarketValue - a.displayMarketValue);
}

/** Résumé du tableau de bord, basé sur l'état synthétisé. */
export async function getPortfolioSummary() {
  const [holdings, accountStates, anyImportCount, txGlobal] = await Promise.all([
    prisma.portfolioHolding.findMany({ orderBy: { snapshotValue: "desc" } }),
    prisma.portfolioAccountState.findMany(),
    prisma.portfolioImport.count(),
    prisma.portfolioTransactionLine.aggregate({
      _min: { tradeDate: true },
      _max: { tradeDate: true },
      _count: { _all: true },
    }),
  ]);

  if (holdings.length === 0 && accountStates.length === 0) {
    return { ...emptySummary(), hasAnyImportsInHistory: anyImportCount > 0 };
  }

  const quotes = await loadQuotesForHoldings(holdings);
  const quoteMap = indexQuotesByTickerCurrency(quotes);

  const enrichedPositions = withDisplayWeights(
    holdings.map((h) =>
      enrichPositionRow(
        {
          id: h.id,
          importId: h.sourceImportId,
          accountId: null,
          accountNumber: h.accountNumber ?? null,
          ticker: h.ticker,
          securityName: h.securityName ?? "",
          currency: h.currency,
          quantity: h.quantity,
          averageCost: h.averageCost ?? null,
          marketPrice: h.snapshotPrice ?? null,
          marketValue: h.snapshotValue,
          unrealizedGainLoss: h.unrealizedGainLoss ?? null,
          weightPct: null,
          sector: h.sector ?? null,
          assetType: h.assetType ?? null,
        },
        `${h.accountName}${h.accountNumber ? ` (${h.accountNumber})` : ""}`,
        quoteMap.get(`${h.ticker.toUpperCase()}|${h.currency.toUpperCase()}`),
      ),
    ),
  );

  const cashValue = sum(accountStates.map((a) => a.cashValue));
  const disnatReferenceTotalValue = sum(accountStates.map((a) => a.totalValue));
  const displayPositionsValue = sum(enrichedPositions.map((p) => p.displayMarketValue));
  const disnatPositionsValue = sum(enrichedPositions.map((p) => p.disnatMarketValue));
  const totalValue = displayPositionsValue + cashValue;

  const driftVsDisnatPct =
    disnatReferenceTotalValue > 0
      ? ((totalValue - disnatReferenceTotalValue) / disnatReferenceTotalValue) * 100
      : null;

  const quotesAsOf =
    quotes.length > 0
      ? new Date(Math.max(...quotes.map((q) => q.fetchedAt.getTime())))
      : null;
  const matchedQuotes = enrichedPositions.filter((p) => p.usesLiveQuote).length;

  // Date de référence globale = date la plus récente parmi tous les états de compte
  const allAsOf = [
    ...accountStates.map((a) => a.asOf),
    ...holdings.map((h) => h.asOf),
  ];
  const referenceAsOf = allAsOf.length > 0 ? new Date(Math.max(...allAsOf.map((d) => d.getTime()))) : null;
  const snapshotDataFrom = allAsOf.length > 0 ? new Date(Math.min(...allAsOf.map((d) => d.getTime()))) : null;

  const distinctAccountNumbers = [
    ...new Set([
      ...accountStates.map((a) => a.accountNumber?.trim()).filter(Boolean),
      ...holdings.map((h) => h.accountNumber?.trim()).filter(Boolean),
    ] as string[]),
  ].slice(0, 24);

  const ownerBreakdown = Object.entries(
    accountStates.reduce(
      (acc, a) => {
        const owner = a.owner ?? "Inconnu";
        if (!acc[owner]) acc[owner] = { totalValue: 0, cashValue: 0, marketValue: 0, accountCount: 0 };
        acc[owner].totalValue += a.totalValue;
        acc[owner].cashValue += a.cashValue;
        acc[owner].marketValue += a.marketValue;
        acc[owner].accountCount++;
        return acc;
      },
      {} as Record<string, { totalValue: number; cashValue: number; marketValue: number; accountCount: number }>,
    ),
  ).map(([owner, data]) => ({ owner, ...data }));

  const topPositions = enrichedPositions
    .toSorted((a, b) => b.displayMarketValue - a.displayMarketValue)
    .slice(0, 5)
    .map((p) => ({ ticker: p.ticker, marketValue: p.displayMarketValue }));

  const maxConcentration = enrichedPositions[0]?.weightPct ?? 0;

  // Import le plus récent (pour l'affichage info seulement)
  const latestImport = await prisma.portfolioImport.findFirst({
    orderBy: { importedAt: "desc" },
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
    disnatPositionsValue,
    driftVsDisnatPct,
    quoteCoverage: { matched: matchedQuotes, total: enrichedPositions.length },
    quotesAsOf,
    cashValue,
    positionCount: holdings.length,
    currencyExposure: buildCurrencyExposure(enrichedPositions, accountStates),
    topPositions,
    maxConcentration,
    variationVsPrevious: null as number | null,
    variationPctVsPrevious: null as number | null,
    hasAnyImportsInHistory: anyImportCount > 0,
    accountCount: accountStates.length,
    ownerBreakdown,
  };
}

// ---------------------------------------------------------------------------
// Autres requêtes du tableau de bord
// ---------------------------------------------------------------------------

export async function getTopPositions(limit = 5) {
  const positions = await getAllPositions();
  return positions.slice(0, limit);
}

export async function getCurrencyExposure() {
  const [holdings, accountStates] = await Promise.all([
    prisma.portfolioHolding.findMany(),
    prisma.portfolioAccountState.findMany(),
  ]);
  const quotes = await loadQuotesForHoldings(holdings);
  const quoteMap = indexQuotesByTickerCurrency(quotes);
  const enriched = holdings.map((h) =>
    enrichPositionRow(
      {
        id: h.id, importId: h.sourceImportId, accountId: null,
        accountNumber: h.accountNumber ?? null, ticker: h.ticker,
        securityName: h.securityName ?? "", currency: h.currency,
        quantity: h.quantity, averageCost: h.averageCost ?? null,
        marketPrice: h.snapshotPrice ?? null, marketValue: h.snapshotValue,
        unrealizedGainLoss: h.unrealizedGainLoss ?? null,
        weightPct: null, sector: h.sector ?? null, assetType: h.assetType ?? null,
      },
      h.accountName,
      quoteMap.get(`${h.ticker.toUpperCase()}|${h.currency.toUpperCase()}`),
    ),
  );
  return buildCurrencyExposure(enriched, accountStates);
}

export async function getConcentrationRisk() {
  const positions = await getAllPositions();
  const concentrated = positions.filter((p) => (p.weightPct ?? 0) >= 10);
  const topWeight = positions[0]?.weightPct ?? 0;
  return {
    topWeight,
    concentratedPositions: concentrated.map((p) => ({
      ticker: p.ticker,
      marketValue: p.displayMarketValue,
      weightPct: p.weightPct ?? 0,
    })),
    note:
      concentrated.length > 0
        ? "Au moins une position dépasse 10% du portefeuille."
        : "Aucune position ne dépasse 10%.",
  };
}

export async function getImportHistory() {
  return prisma.portfolioImport.findMany({
    orderBy: { importedAt: "desc" },
    take: 20,
    include: {
      _count: { select: { positions: true, accounts: true, transactions: true } },
    },
  });
}

export async function getLatestImportInfo() {
  const latest = await prisma.portfolioImport.findFirst({
    orderBy: { importedAt: "desc" },
    include: { accounts: true, positions: true },
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

  return accounts.map((a) => ({
    ...a,
    txCount: txByKey.get(a.accountKey) ?? 0,
    lastTxDate: lastTxByKey.get(a.accountKey) ?? null,
  }));
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
      where: { owner: opts.owner },
      select: { accountKey: true },
    });
    where.accountKey = { in: ownerAccounts.map((a) => a.accountKey) };
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
    include: { accounts: true, positions: true },
  });
}

/** @deprecated Utiliser getPortfolioSummary(). Conservé pour refresh-live-quotes. */
export async function getLatestDashboardImport() {
  const candidates = await prisma.portfolioImport.findMany({
    where: { OR: [{ positions: { some: {} } }, { accounts: { some: {} } }] },
    orderBy: { importedAt: "desc" },
    take: 40,
    include: { accounts: true, positions: true },
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
    displayPositionsValue: 0,
    disnatPositionsValue: 0,
    driftVsDisnatPct: null as number | null,
    quoteCoverage: { matched: 0, total: 0 },
    quotesAsOf: null as Date | null,
    cashValue: 0,
    positionCount: 0,
    accountCount: 0,
    currencyExposure: [] as { currency: string; value: number }[],
    topPositions: [] as { ticker: string; marketValue: number }[],
    maxConcentration: 0,
    variationVsPrevious: null as number | null,
    variationPctVsPrevious: null as number | null,
    hasAnyImportsInHistory: false,
    ownerBreakdown: [] as { owner: string; totalValue: number; cashValue: number; marketValue: number; accountCount: number }[],
  };
}
