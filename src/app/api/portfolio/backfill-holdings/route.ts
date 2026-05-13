import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { upsertPortfolioStateFromSnapshot } from "@/features/portfolio/upsert-portfolio-state";
import { projectHoldingsFromTransactions } from "@/features/portfolio/project-transaction-holdings";

/**
 * POST /api/portfolio/backfill-holdings
 * Migre les états de compte (totaux / encaisse) depuis les imports portefeuille.
 * Les lignes titres courantes viennent de la projection transactions.
 * Idempotent — peut être relancé sans risque.
 */
export async function POST() {
  try {
    const imports = await prisma.portfolioImport.findMany({
      where: { OR: [{ positions: { some: {} } }, { accounts: { some: {} } }] },
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
      orderBy: { importedAt: "asc" },
    });

    if (imports.length === 0) {
      return NextResponse.json({ message: "Aucun import avec positions/comptes à migrer.", migrated: 0 });
    }

    let totalAccounts = 0;

    for (const imp of imports) {
      const asOf = imp.dataToDate ?? imp.importedAt;

      const snapshot = {
        importKind: imp.importType as "PORTFOLIO" | "POSITIONS" | "TRANSACTIONS" | "MIXED" | "UNKNOWN",
        warnings: [],
        transactions: [],
        accounts: imp.accounts.map((a) => ({
          accountName: a.accountName,
          accountNumber: a.accountNumber ?? undefined,
          accountType: a.accountType ?? undefined,
          currency: a.currency,
          cashValue: a.cashValue,
          marketValue: a.marketValue,
          totalValue: a.totalValue,
        })),
        positions: imp.positions.map((p) => ({
          accountName:
            imp.accounts.find((a) => a.id === p.accountId)?.accountName ??
            p.accountNumber ??
            "Compte Disnat",
          accountNumber: p.accountNumber ?? undefined,
          accountType:
            imp.accounts.find((a) => a.id === p.accountId)?.accountType ?? undefined,
          ticker: p.ticker,
          securityName: p.securityName ?? undefined,
          currency: p.currency,
          quantity: p.quantity,
          averageCost: p.averageCost ?? undefined,
          marketPrice: p.marketPrice ?? undefined,
          marketValue: p.marketValue,
          unrealizedGainLoss: p.unrealizedGainLoss ?? undefined,
          weightPct: p.weightPct ?? undefined,
          sector: p.sector ?? undefined,
          assetType: p.assetType ?? undefined,
        })),
        snapshotIncludesCashFromPortfolioExport:
          imp.importType === "PORTFOLIO" || imp.importType === "MIXED",
      };

      const result = await upsertPortfolioStateFromSnapshot(snapshot, imp.id, asOf);
      totalAccounts += result.accountStatesUpserted;
    }

    let projectedCount: { currentHoldingsProjected: number } | null = null;
    if ((await prisma.portfolioTransactionLine.count()) > 0) {
      projectedCount = await projectHoldingsFromTransactions();
    }

    return NextResponse.json({
      message: `Migration terminée : ${totalAccounts} états de compte mis à jour.${
        projectedCount
          ? ` Titres projetés : ${projectedCount.currentHoldingsProjected} lignes.`
          : " Aucune transaction : projection non exécutée."
      }`,
      importsProcessed: imports.length,
      holdingsUpserted: 0,
      accountStatesUpserted: totalAccounts,
      projectedHoldings: projectedCount?.currentHoldingsProjected ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur inconnue" },
      { status: 500 },
    );
  }
}
