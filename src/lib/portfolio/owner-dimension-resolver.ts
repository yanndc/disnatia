import { prisma } from "@/lib/db/prisma";
import { sanitizePortfolioOwner } from "@/lib/portfolio/sanitize-portfolio-owner";
import {
  resolveNonFinancialAssetOwnerShares,
  type OwnerShare,
} from "@/lib/portfolio/non-financial-asset-owner-shares";

export type OwnerDimensionResolver = {
  resolveAccountOwner(accountKey: string, fallbackOwner: string | null | undefined): string | null;
  resolveExternalOwner(externalAccountId: string, fallbackOwner: string | null | undefined): string | null;
  resolveNonFinancialAssetOwners(
    assetId: string,
    fallbackOwner: string | null | undefined,
    fallbackMetadata: unknown,
  ): OwnerShare[];
};

export async function buildOwnerDimensionResolver(): Promise<OwnerDimensionResolver> {
  const [accountOwners, externalOwners, assetShares] = await Promise.all([
    prisma.portfolioAccountOwner.findMany({
      select: {
        accountKey: true,
        owner: { select: { displayName: true } },
      },
    }),
    prisma.externalPortfolioAccountOwner.findMany({
      select: {
        externalAccountId: true,
        owner: { select: { displayName: true } },
      },
    }),
    prisma.nonFinancialAssetOwnerShare.findMany({
      select: {
        nonFinancialAssetId: true,
        sharePct: true,
        owner: { select: { displayName: true } },
      },
      orderBy: [{ nonFinancialAssetId: "asc" }, { ownerId: "asc" }],
    }),
  ]);

  const accountOwnerByAccountKey = new Map<string, string>();
  for (const row of accountOwners) {
    const display = sanitizePortfolioOwner(row.owner.displayName);
    if (display) accountOwnerByAccountKey.set(row.accountKey, display);
  }

  const externalOwnerById = new Map<string, string>();
  for (const row of externalOwners) {
    const display = sanitizePortfolioOwner(row.owner.displayName);
    if (display) externalOwnerById.set(row.externalAccountId, display);
  }

  const nonFinancialSharesByAssetId = new Map<string, OwnerShare[]>();
  for (const row of assetShares) {
    const display = sanitizePortfolioOwner(row.owner.displayName);
    if (!display) continue;
    const list = nonFinancialSharesByAssetId.get(row.nonFinancialAssetId) ?? [];
    list.push({ owner: display, sharePct: row.sharePct });
    nonFinancialSharesByAssetId.set(row.nonFinancialAssetId, list);
  }

  function resolveAccountOwner(
    accountKey: string,
    fallbackOwner: string | null | undefined,
  ): string | null {
    return accountOwnerByAccountKey.get(accountKey) ?? sanitizePortfolioOwner(fallbackOwner);
  }

  function resolveExternalOwner(
    externalAccountId: string,
    fallbackOwner: string | null | undefined,
  ): string | null {
    return externalOwnerById.get(externalAccountId) ?? sanitizePortfolioOwner(fallbackOwner);
  }

  function resolveNonFinancialAssetOwners(
    assetId: string,
    fallbackOwner: string | null | undefined,
    fallbackMetadata: unknown,
  ): OwnerShare[] {
    const mapped = nonFinancialSharesByAssetId.get(assetId);
    if (mapped && mapped.length > 0) {
      const sum = mapped.reduce((s, x) => s + x.sharePct, 0);
      if (sum > 0) {
        return mapped.map((x) => ({ owner: x.owner, sharePct: (x.sharePct / sum) * 100 }));
      }
    }
    return resolveNonFinancialAssetOwnerShares(fallbackOwner, fallbackMetadata);
  }

  return {
    resolveAccountOwner,
    resolveExternalOwner,
    resolveNonFinancialAssetOwners,
  };
}
