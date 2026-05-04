import { prisma } from "@/lib/db/prisma";
import type { PortfolioSnapshotInput } from "@/types/portfolio";

/**
 * Clé stable pour identifier un compte indépendamment du nom d'affichage.
 * Priorité : numéro de compte normalisé → nom normalisé.
 */
function makeAccountKey(name: string, currency: string, accountNumber?: string | null): string {
  const num = accountNumber?.replace(/\s/g, "").toUpperCase() ?? "";
  if (num) {
    return `${num}|${currency.toUpperCase()}`;
  }
  return `name:${name.trim().toLowerCase()}|${currency.toUpperCase()}`;
}

/**
 * Après un import de snapshot (positions / portefeuille), met à jour les tables
 * PortfolioHolding et PortfolioAccountState si la date de référence du fichier
 * est plus récente que ce qui est déjà stocké pour chaque compte/position.
 *
 * Idempotent : réimporter le même fichier ne change rien tant que la date ne régresse pas.
 */
export async function upsertPortfolioStateFromSnapshot(
  snapshot: PortfolioSnapshotInput,
  importId: string,
  asOf: Date,
): Promise<{ holdingsUpserted: number; accountStatesUpserted: number }> {
  let holdingsUpserted = 0;
  let accountStatesUpserted = 0;

  // --- Comptes ---
  for (const account of snapshot.accounts) {
    const accountKey = makeAccountKey(account.accountName, account.currency, account.accountNumber);

    const existing = await prisma.portfolioAccountState.findUnique({
      where: { accountKey_currency: { accountKey, currency: account.currency.toUpperCase() } },
    });

    if (existing && existing.asOf >= asOf) {
      continue; // donnée déjà plus récente → on ne touche pas
    }

    await prisma.portfolioAccountState.upsert({
      where: { accountKey_currency: { accountKey, currency: account.currency.toUpperCase() } },
      create: {
        accountKey,
        accountName: account.accountName,
        accountNumber: account.accountNumber ?? null,
        accountType: account.accountType ?? null,
        owner: account.owner ?? null,
        currency: account.currency.toUpperCase(),
        cashValue: account.cashValue,
        marketValue: account.marketValue,
        totalValue: account.totalValue,
        asOf,
        sourceImportId: importId,
      },
      update: {
        accountName: account.accountName,
        accountNumber: account.accountNumber ?? null,
        accountType: account.accountType ?? null,
        owner: account.owner ?? null,
        cashValue: account.cashValue,
        marketValue: account.marketValue,
        totalValue: account.totalValue,
        asOf,
        sourceImportId: importId,
      },
    });
    accountStatesUpserted += 1;
  }

  // --- Positions ---
  for (const position of snapshot.positions) {
    const accountKey = makeAccountKey(
      position.accountName,
      position.currency,
      position.accountNumber,
    );
    const ticker = position.ticker.toUpperCase();
    const currency = position.currency.toUpperCase();

    const existing = await prisma.portfolioHolding.findUnique({
      where: { accountKey_ticker_currency: { accountKey, ticker, currency } },
    });

    if (existing && existing.asOf >= asOf) {
      continue;
    }

    await prisma.portfolioHolding.upsert({
      where: { accountKey_ticker_currency: { accountKey, ticker, currency } },
      create: {
        accountKey,
        accountName: position.accountName,
        accountNumber: position.accountNumber ?? null,
        accountType: position.accountType ?? null,
        ticker,
        securityName: position.securityName ?? null,
        currency,
        quantity: position.quantity,
        averageCost: position.averageCost ?? null,
        snapshotPrice: position.marketPrice ?? null,
        snapshotValue: position.marketValue,
        unrealizedGainLoss: position.unrealizedGainLoss ?? null,
        sector: position.sector ?? null,
        assetType: position.assetType ?? null,
        asOf,
        sourceImportId: importId,
      },
      update: {
        accountName: position.accountName,
        accountNumber: position.accountNumber ?? null,
        accountType: position.accountType ?? null,
        securityName: position.securityName ?? null,
        quantity: position.quantity,
        averageCost: position.averageCost ?? null,
        snapshotPrice: position.marketPrice ?? null,
        snapshotValue: position.marketValue,
        unrealizedGainLoss: position.unrealizedGainLoss ?? null,
        sector: position.sector ?? null,
        assetType: position.assetType ?? null,
        asOf,
        sourceImportId: importId,
      },
    });
    holdingsUpserted += 1;
  }

  return { holdingsUpserted, accountStatesUpserted };
}
