import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

export type NonFinancialAssetWithLatest = {
  id: string;
  assetKey: string;
  assetType: "REAL_ESTATE" | "VEHICLE" | "PRIVATE_BUSINESS" | "OTHER";
  displayLabel: string;
  owner: string | null;
  currency: string;
  isActive: boolean;
  metadata: Prisma.JsonValue | null;
  latestSnapshot: {
    asOfDate: Date;
    marketValue: number;
    mortgageBalance: number;
    netEquity: number;
  } | null;
  snapshotCount: number;
};

export async function listNonFinancialAssetsWithLatest(): Promise<NonFinancialAssetWithLatest[]> {
  const rows = await prisma.nonFinancialAsset.findMany({
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
  });

  return rows.map((r) => ({
    id: r.id,
    assetKey: r.assetKey,
    assetType: r.assetType,
    displayLabel: r.displayLabel,
    owner: r.owner,
    currency: r.currency,
    isActive: r.isActive,
    metadata: r.metadata,
    latestSnapshot: r.snapshots[0] ?? null,
    snapshotCount: r._count.snapshots,
  }));
}
