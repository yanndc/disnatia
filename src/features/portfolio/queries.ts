import { prisma } from "@/lib/db/prisma";

export async function getLatestPortfolioImport() {
  return prisma.portfolioImport.findFirst({
    orderBy: { importedAt: "desc" },
    include: {
      accounts: true,
      positions: true,
    },
  });
}

export async function getPortfolioSummary() {
  const latest = await getLatestPortfolioImport();
  if (!latest) {
    return emptySummary();
  }

  const previous = await prisma.portfolioImport.findFirst({
    where: { id: { not: latest.id } },
    orderBy: { importedAt: "desc" },
    include: { accounts: true, positions: true },
  });

  const totalValue = sum(latest.accounts.map((account) => account.totalValue));
  const previousTotalValue = previous
    ? sum(previous.accounts.map((account) => account.totalValue))
    : null;
  const cashValue = sum(latest.accounts.map((account) => account.cashValue));
  const topPositions = latest.positions
    .toSorted((a, b) => b.marketValue - a.marketValue)
    .slice(0, 5);
  const maxConcentration = topPositions[0]?.weightPct ?? 0;

  return {
    latestImportId: latest.id,
    importedAt: latest.importedAt,
    totalValue,
    cashValue,
    positionCount: latest.positions.length,
    currencyExposure: getCurrencyExposureFromImport(latest),
    topPositions,
    maxConcentration,
    variationVsPrevious:
      previousTotalValue === null ? null : totalValue - previousTotalValue,
    variationPctVsPrevious:
      previousTotalValue && previousTotalValue > 0
        ? ((totalValue - previousTotalValue) / previousTotalValue) * 100
        : null,
  };
}

export async function getAllPositions() {
  const latest = await getLatestPortfolioImport();
  if (!latest) {
    return [];
  }

  return latest.positions
    .map((position) => ({
      ...position,
      accountName:
        latest.accounts.find((account) => account.id === position.accountId)
          ?.accountName ?? "Compte Disnat",
    }))
    .toSorted((a, b) => b.marketValue - a.marketValue);
}

export async function getTopPositions(limit = 5) {
  const positions = await getAllPositions();
  return positions.slice(0, limit);
}

export async function getCurrencyExposure() {
  const latest = await getLatestPortfolioImport();
  if (!latest) {
    return [];
  }

  return getCurrencyExposureFromImport(latest);
}

export async function getConcentrationRisk() {
  const positions = await getAllPositions();
  const concentrated = positions.filter((position) => (position.weightPct ?? 0) >= 10);
  const topWeight = positions[0]?.weightPct ?? 0;

  return {
    topWeight,
    concentratedPositions: concentrated.map((position) => ({
      ticker: position.ticker,
      marketValue: position.marketValue,
      weightPct: position.weightPct ?? 0,
    })),
    note:
      concentrated.length > 0
        ? "Au moins une position dépasse 10% du portefeuille."
        : "Aucune position ne dépasse 10% du portefeuille selon le dernier import.",
  };
}

export async function getLatestImportInfo() {
  const latest = await getLatestPortfolioImport();
  if (!latest) {
    return null;
  }

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
    (position) => position.ticker.toUpperCase() === input.fromTicker.toUpperCase(),
  );
  const to = positions.find(
    (position) => position.ticker.toUpperCase() === input.toTicker.toUpperCase(),
  );
  const total = sum(positions.map((position) => position.marketValue));

  if (!from || !to || total <= 0) {
    return {
      possible: false,
      reason: "Ticker source ou destination introuvable dans le dernier import.",
    };
  }

  return {
    possible: true,
    fromTicker: from.ticker,
    toTicker: to.ticker,
    amountCad: input.amountCad,
    before: {
      [from.ticker]: from.weightPct ?? 0,
      [to.ticker]: to.weightPct ?? 0,
    },
    after: {
      [from.ticker]: ((from.marketValue - input.amountCad) / total) * 100,
      [to.ticker]: ((to.marketValue + input.amountCad) / total) * 100,
    },
    caveat:
      "Simulation simplifiée en CAD, sans frais, fiscalité, devise ni variation de prix.",
  };
}

export async function getImportHistory() {
  return prisma.portfolioImport.findMany({
    orderBy: { importedAt: "desc" },
    take: 20,
    include: {
      _count: {
        select: { positions: true, accounts: true },
      },
    },
  });
}

function getCurrencyExposureFromImport(importData: Awaited<ReturnType<typeof getLatestPortfolioImport>>) {
  if (!importData) {
    return [];
  }

  const exposure = new Map<string, number>();
  importData.accounts.forEach((account) => {
    exposure.set(account.currency, (exposure.get(account.currency) ?? 0) + account.totalValue);
  });

  return Array.from(exposure.entries()).map(([currency, value]) => ({
    currency,
    value,
  }));
}

function emptySummary() {
  return {
    latestImportId: null,
    importedAt: null,
    totalValue: 0,
    cashValue: 0,
    positionCount: 0,
    currencyExposure: [],
    topPositions: [],
    maxConcentration: 0,
    variationVsPrevious: null,
    variationPctVsPrevious: null,
  };
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
