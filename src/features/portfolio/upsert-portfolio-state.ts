import { prisma } from "@/lib/db/prisma";
import type { PortfolioSnapshotInput } from "@/types/portfolio";

/**
 * Clé stable pour identifier un compte indépendamment du nom d'affichage.
 * Priorité : numéro de compte normalisé → nom normalisé.
 */
export function makeAccountKey(name: string, currency: string, accountNumber?: string | null): string {
  const num = accountNumber?.replace(/\s/g, "").toUpperCase() ?? "";
  if (num) {
    return `${num}|${currency.toUpperCase()}`;
  }
  return `name:${name.trim().toLowerCase()}|${currency.toUpperCase()}`;
}

/**
 * Après un import de snapshot (portefeuille), met à jour uniquement PortfolioAccountState
 * (totaux / encaisse Disnat pour validation). Les lignes titres à l’écran viennent de
 * `projectHoldingsFromTransactions`, pas de ce fichier.
 *
 * Idempotent : réimporter le même fichier ne change rien tant que la date ne régresse pas.
 */
export async function upsertPortfolioStateFromSnapshot(
  snapshot: PortfolioSnapshotInput,
  importId: string,
  asOf: Date,
): Promise<{ holdingsUpserted: number; accountStatesUpserted: number }> {
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

  return { holdingsUpserted: 0, accountStatesUpserted };
}
