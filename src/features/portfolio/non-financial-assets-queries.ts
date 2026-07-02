import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { buildOwnerDimensionResolver } from "@/lib/portfolio/owner-dimension-resolver";
import type { OwnerShare } from "@/lib/portfolio/non-financial-asset-owner-shares";

export type NonFinancialAssetWithLatest = {
  id: string;
  assetKey: string;
  assetType: "REAL_ESTATE" | "VEHICLE" | "PRIVATE_BUSINESS" | "OTHER";
  displayLabel: string;
  owner: string | null;
  currency: string;
  isActive: boolean;
  metadata: Prisma.JsonValue | null;
  ownerShares: OwnerShare[];
  latestSnapshot: {
    asOfDate: Date;
    marketValue: number;
    mortgageBalance: number;
    netEquity: number;
  } | null;
  snapshotCount: number;
};

export async function listNonFinancialAssetsWithLatest(): Promise<NonFinancialAssetWithLatest[]> {
  const [rows, ownerResolver] = await Promise.all([
    prisma.nonFinancialAsset.findMany({
      orderBy: { displayLabel: "asc" },
      include: {
        _count: { select: { snapshots: true } },
        snapshots: {
          orderBy: { asOfDate: "desc" },
          take: 1,
          select: {
            asOfDate: true,
            marketValue: true,
            mortgageBalance: true,
            netEquity: true,
          },
        },
      },
    }),
    buildOwnerDimensionResolver(),
  ]);

  return rows.map((r) => ({
    id: r.id,
    assetKey: r.assetKey,
    assetType: r.assetType,
    displayLabel: r.displayLabel,
    owner:
      ownerResolver.resolveNonFinancialAssetOwners(r.id, r.owner, r.metadata)[0]?.owner ??
      null,
    currency: r.currency,
    isActive: r.isActive,
    metadata: r.metadata,
    ownerShares: ownerResolver.resolveNonFinancialAssetOwners(r.id, r.owner, r.metadata),
    latestSnapshot: r.snapshots[0] ?? null,
    snapshotCount: r._count.snapshots,
  }));
}
