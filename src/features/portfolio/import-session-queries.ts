import { prisma } from "@/lib/db/prisma";
import { sanitizePortfolioOwner } from "@/lib/portfolio/sanitize-portfolio-owner";
import { PROJECTED_HOLDINGS_SOURCE_ID } from "@/features/portfolio/project-transaction-holdings";
import { isoDateFromDbTimestamp } from "@/features/portfolio/daily-close-key";
import { isoDateInToronto } from "@/lib/market/equity-session";
import {
  assessAccountCoverage,
  expectedCoverageSessionIso,
  summarizeCoverage,
} from "@/features/portfolio/account-coverage";
import type {
  ImportSessionAccount,
  ImportSessionHolding,
  ImportSessionPayload,
} from "@/features/portfolio/import-session-types";

export type {
  ImportSessionAccount,
  ImportSessionAttributionRule,
  ImportSessionHolding,
  ImportSessionPayload,
} from "@/features/portfolio/import-session-types";

/**
 * Construit le payload de la **session d'import guidée** (`/imports` → onglet dédié) :
 * état des comptes, couverture (import / opérations / attestation) et règles apprises.
 *
 * Aucune écriture : la session ne modifie la base qu'à la confirmation de l'utilisateur.
 */
function isoFromNullableDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  return isoDateFromDbTimestamp(value);
}

export async function buildImportSession(
  now = new Date(),
): Promise<ImportSessionPayload> {
  const [accountStates, holdings, transactionBounds, lastTransactions, confirmations, rules] =
    await Promise.all([
      prisma.portfolioAccountState.findMany({
        orderBy: [{ owner: "asc" }, { accountType: "asc" }, { accountName: "asc" }],
      }),
      prisma.portfolioHolding.findMany({
        where: { sourceImportId: PROJECTED_HOLDINGS_SOURCE_ID },
        select: { accountKey: true, ticker: true, currency: true, quantity: true },
      }),
      prisma.portfolioTransactionLine.aggregate({
        _min: { tradeDate: true },
        _max: { tradeDate: true },
        _count: { _all: true },
      }),
      prisma.portfolioTransactionLine.groupBy({
        by: ["accountKey"],
        where: { accountKey: { not: null }, tradeDate: { not: null } },
        _max: { tradeDate: true },
      }),
      prisma.portfolioAccountConfirmation.findMany({
        orderBy: [{ accountKey: "asc" }, { dataAsOf: "desc" }],
        select: { accountKey: true, dataAsOf: true, confirmedAt: true },
      }),
      prisma.portfolioImportAttributionRule.findMany({
        orderBy: { updatedAt: "desc" },
        take: 200,
      }),
    ]);

  const lastTransactionByAccount = new Map<string, Date>();
  for (const row of lastTransactions) {
    if (row.accountKey && row._max.tradeDate) {
      lastTransactionByAccount.set(row.accountKey, row._max.tradeDate);
    }
  }

  const latestConfirmationByAccount = new Map<
    string,
    { dataAsOf: Date; confirmedAt: Date }
  >();
  for (const confirmation of confirmations) {
    if (!latestConfirmationByAccount.has(confirmation.accountKey)) {
      latestConfirmationByAccount.set(confirmation.accountKey, {
        dataAsOf: confirmation.dataAsOf,
        confirmedAt: confirmation.confirmedAt,
      });
    }
  }

  const holdingsByAccount = new Map<string, ImportSessionHolding[]>();
  for (const holding of holdings) {
    const list = holdingsByAccount.get(holding.accountKey) ?? [];
    list.push({
      ticker: holding.ticker,
      currency: holding.currency,
      quantity: holding.quantity,
    });
    holdingsByAccount.set(holding.accountKey, list);
  }

  const accounts: ImportSessionAccount[] = accountStates.map((state) => {
    const lastTx = lastTransactionByAccount.get(state.accountKey) ?? null;
    const confirmation = latestConfirmationByAccount.get(state.accountKey) ?? null;
    const lastTransactionDate = isoFromNullableDate(lastTx);
    const lastConfirmationDataAsOf = confirmation
      ? isoDateFromDbTimestamp(confirmation.dataAsOf)
      : null;

    return {
      accountKey: state.accountKey,
      accountName: state.accountName,
      accountNumber: state.accountNumber,
      accountType: state.accountType,
      owner: sanitizePortfolioOwner(state.owner),
      currency: state.currency,
      totalValue: state.totalValue,
      cashValue: state.cashValue,
      snapshotAsOf: isoDateFromDbTimestamp(state.asOf),
      lastTransactionDate,
      lastConfirmationDataAsOf,
      lastConfirmationAt: confirmation
        ? confirmation.confirmedAt.toISOString()
        : null,
      coverage: assessAccountCoverage(
        {
          accountKey: state.accountKey,
          snapshotAsOf: isoDateFromDbTimestamp(state.asOf),
          lastTransactionDate,
          lastConfirmationDataAsOf,
          lastConfirmationAt: confirmation
            ? confirmation.confirmedAt.toISOString()
            : null,
        },
        now,
      ),
      holdings: holdingsByAccount.get(state.accountKey) ?? [],
    };
  });

  return {
    todayIso: isoDateInToronto(now),
    expectedSessionIso: expectedCoverageSessionIso(now),
    accounts,
    summary: {
      ...summarizeCoverage(accounts.map((account) => account.coverage)),
      transactionCount: transactionBounds._count._all,
      transactionFrom: isoFromNullableDate(transactionBounds._min.tradeDate),
      transactionTo: isoFromNullableDate(transactionBounds._max.tradeDate),
    },
    attributionRules: rules.map((rule) => ({
      signature: rule.signature,
      accountKey: rule.accountKey,
      sampleFileName: rule.sampleFileName,
      hits: rule.hits,
      updatedAt: rule.updatedAt.toISOString(),
    })),
  };
}
