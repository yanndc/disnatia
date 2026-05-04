import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { upsertPortfolioStateFromSnapshot } from "@/features/portfolio/upsert-portfolio-state";

/**
 * POST /api/portfolio/backfill-holdings
 * Migre les données des anciennes tables (portfolio_positions / portfolio_accounts)
 * vers les nouvelles tables synthétisées (portfolio_holdings / portfolio_account_states).
 * Idempotent — peut être relancé sans risque.
 */
export async function POST() {
  try {
    const imports = await prisma.portfolioImport.findMany({
      where: { OR: [{ positions: { some: {} } }, { accounts: { some: {} } }] },
      include: { accounts: true, positions: true },
      orderBy: { importedAt: "asc" },
    });

    if (imports.length === 0) {
      return NextResponse.json({ message: "Aucun import avec positions/comptes à migrer.", migrated: 0 });
    }

    let totalHoldings = 0;
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
      };

      const result = await upsertPortfolioStateFromSnapshot(snapshot, imp.id, asOf);
      totalHoldings += result.holdingsUpserted;
      totalAccounts += result.accountStatesUpserted;
    }

    return NextResponse.json({
      message: `Migration terminée : ${totalHoldings} positions, ${totalAccounts} états de compte mis à jour.`,
      importsProcessed: imports.length,
      holdingsUpserted: totalHoldings,
      accountStatesUpserted: totalAccounts,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur inconnue" },
      { status: 500 },
    );
  }
}
