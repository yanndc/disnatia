import { prisma } from "@/lib/db/prisma";
import { sanitizePortfolioOwner } from "@/lib/portfolio/sanitize-portfolio-owner";
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
 * Après un import de snapshot **portefeuille** Disnat, met à jour `PortfolioAccountState`.
 *
 * **Réconciliation (référence « vérité fichier » au `asOf` du snapshot)** : pour chaque compte,
 * les champs `cashValue`, `marketValue` et `totalValue` lus dans le fichier sont enregistrés
 * tels quels et font foi pour comparer l’app à Disnat (écarts), jusqu’au prochain import
 * portefeuille plus récent pour ce compte. Ils ne sont pas recalculés à partir des transactions.
 *
 * Les **titres ligne à ligne** affichés dans l’app viennent uniquement de
 * `projectHoldingsFromTransactions` + cours marché, pas des lignes d’avoirs du CSV.
 *
 * Idempotent : une donnée déjà connue avec un `asOf` plus récent n’est pas écrasée.
 */
export async function upsertPortfolioStateFromSnapshot(
  snapshot: PortfolioSnapshotInput,
  importId: string,
  asOf: Date,
): Promise<{ holdingsUpserted: number; accountStatesUpserted: number }> {
  let accountStatesUpserted = 0;

  // --- Comptes ---
  for (const account of snapshot.accounts) {
    const num = account.accountNumber?.replace(/\s/g, "").trim();
    if (!num) {
      continue;
    }

    const accountKey = makeAccountKey(account.accountName, account.currency, account.accountNumber);

    const existing = await prisma.portfolioAccountState.findUnique({
      where: { accountKey_currency: { accountKey, currency: account.currency.toUpperCase() } },
    });

    if (existing && existing.asOf >= asOf) {
      continue; // donnée déjà plus récente → on ne touche pas
    }

    const trimmedOwner = sanitizePortfolioOwner(account.owner);
    const owner =
      trimmedOwner && trimmedOwner.length > 0 ? trimmedOwner : (sanitizePortfolioOwner(existing?.owner) ?? null);

    const preserveCash =
      snapshot.snapshotIncludesCashFromPortfolioExport !== true && existing != null;
    const cashValue = preserveCash ? existing.cashValue : account.cashValue;
    const marketValue = account.marketValue;
    const totalValue = cashValue + marketValue;

    await prisma.portfolioAccountState.upsert({
      where: { accountKey_currency: { accountKey, currency: account.currency.toUpperCase() } },
      create: {
        accountKey,
        accountName: account.accountName,
        accountNumber: account.accountNumber ?? null,
        accountType: account.accountType ?? null,
        owner,
        currency: account.currency.toUpperCase(),
        cashValue,
        marketValue,
        totalValue,
        asOf,
        sourceImportId: importId,
      },
      update: {
        accountName: account.accountName,
        accountNumber: account.accountNumber ?? null,
        accountType: account.accountType ?? null,
        owner,
        cashValue,
        marketValue,
        totalValue,
        asOf,
        sourceImportId: importId,
      },
    });
    accountStatesUpserted += 1;
  }

  return { holdingsUpserted: 0, accountStatesUpserted };
}
