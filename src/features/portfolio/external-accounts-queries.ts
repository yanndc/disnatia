import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { buildOwnerDimensionResolver } from "@/lib/portfolio/owner-dimension-resolver";

export type ExternalAccountWithLatest = {
  id: string;
  accountKey: string;
  provider: string;
  displayLabel: string;
  owner: string | null;
  currency: string;
  portalUrl: string | null;
  metadata: Prisma.JsonValue | null;
  latestSnapshot: {
    asOfDate: Date;
    totalValue: number;
  } | null;
  snapshotCount: number;
};

export async function listExternalAccountsWithLatest(): Promise<ExternalAccountWithLatest[]> {
  const [rows, ownerResolver] = await Promise.all([
    prisma.externalPortfolioAccount.findMany({
      orderBy: { displayLabel: "asc" },
      include: {
        _count: { select: { snapshots: true } },
        snapshots: {
          orderBy: { asOfDate: "desc" },
          take: 1,
          select: { asOfDate: true, totalValue: true },
        },
      },
    }),
    buildOwnerDimensionResolver(),
  ]);

  return rows.map((r) => ({
    id: r.id,
    accountKey: r.accountKey,
    provider: r.provider,
    displayLabel: r.displayLabel,
    owner: ownerResolver.resolveExternalOwner(r.id, r.owner),
    currency: r.currency,
    portalUrl: r.portalUrl,
    metadata: r.metadata,
    latestSnapshot: r.snapshots[0] ?? null,
    snapshotCount: r._count.snapshots,
  }));
}
