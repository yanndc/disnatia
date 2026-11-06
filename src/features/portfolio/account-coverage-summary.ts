import { prisma } from "@/lib/db/prisma";
import { isoDateFromDbTimestamp } from "./daily-close-key";
import {
  assessAccountCoverage,
  clientCodeFromAccountKey,
  expectedCoverageSessionIso,
  summarizeCoverage,
  type AccountCoverage,
} from "./account-coverage";

export type AccountCoverageBadge = {
  summary: ReturnType<typeof summarizeCoverage>;
  expectedSessionIso: string;
};

/**
 * État de couverture des comptes pour un badge global (navigation).
 * Même logique que la session guidée, sans charger les règles d'attribution ni les holdings :
 * relevé portefeuille, dernière opération, attestation et capture client du favori.
 */
export async function loadAccountCoverageBadge(
  now = new Date(),
): Promise<AccountCoverageBadge> {
  const [states, lastTransactions, confirmations, cashSnapshots] = await Promise.all([
    prisma.portfolioAccountState.findMany({
      select: { accountKey: true, asOf: true },
    }),
    prisma.portfolioTransactionLine.groupBy({
      by: ["accountKey"],
      where: { accountKey: { not: null }, tradeDate: { not: null } },
      _max: { tradeDate: true },
    }),
    prisma.portfolioAccountConfirmation.findMany({
      select: { accountKey: true, dataAsOf: true },
      orderBy: { dataAsOf: "desc" },
    }),
    prisma.disnatClientCashSnapshot
      .findMany({ select: { clientCode: true, asOfDate: true } })
      .catch(() => []),
  ]);

  const lastTransactionByAccount = new Map<string, string>();
  for (const row of lastTransactions) {
    if (row.accountKey && row._max.tradeDate) {
      lastTransactionByAccount.set(row.accountKey, isoDateFromDbTimestamp(row._max.tradeDate));
    }
  }

  const confirmationByAccount = new Map<string, string>();
  for (const confirmation of confirmations) {
    if (!confirmationByAccount.has(confirmation.accountKey)) {
      confirmationByAccount.set(
        confirmation.accountKey,
        isoDateFromDbTimestamp(confirmation.dataAsOf),
      );
    }
  }

  const clientSnapshotByCode = new Map<string, string>();
  for (const snapshot of cashSnapshots) {
    const iso = isoDateFromDbTimestamp(snapshot.asOfDate);
    const current = clientSnapshotByCode.get(snapshot.clientCode);
    if (!current || iso > current) clientSnapshotByCode.set(snapshot.clientCode, iso);
  }

  const coverages: AccountCoverage[] = states.map((state) =>
    assessAccountCoverage(
      {
        accountKey: state.accountKey,
        snapshotAsOf: isoDateFromDbTimestamp(state.asOf),
        lastTransactionDate: lastTransactionByAccount.get(state.accountKey) ?? null,
        lastConfirmationDataAsOf: confirmationByAccount.get(state.accountKey) ?? null,
        lastConfirmationAt: null,
        clientSnapshotAsOf: clientSnapshotByCode.get(clientCodeFromAccountKey(state.accountKey)),
      },
      now,
    ),
  );

  return {
    summary: summarizeCoverage(coverages),
    expectedSessionIso: expectedCoverageSessionIso(now),
  };
}
