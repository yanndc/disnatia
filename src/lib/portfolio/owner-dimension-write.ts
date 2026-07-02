import { prisma } from "@/lib/db/prisma";
import {
  portfolioOwnerKey,
  sanitizePortfolioOwner,
} from "@/lib/portfolio/sanitize-portfolio-owner";

type MappingSource = "MANUAL" | "BACKFILL" | "IMPORT";

type OwnerShareInput = {
  owner: string | null | undefined;
  sharePct: number;
};

async function ensureCanonicalOwner(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  rawOwner: string | null | undefined,
) {
  const displayName = sanitizePortfolioOwner(rawOwner);
  const ownerKey = portfolioOwnerKey(rawOwner);
  if (!displayName || !ownerKey) return null;

  const owner = await tx.owner.upsert({
    where: { ownerKey },
    create: {
      ownerKey,
      displayName,
      isActive: true,
    },
    update: {
      displayName,
      isActive: true,
    },
  });

  const personalPortfolio = await tx.portfolio.upsert({
    where: { portfolioKey: `owner:${ownerKey}` },
    create: {
      portfolioKey: `owner:${ownerKey}`,
      displayName,
      kind: "PERSONAL",
      isActive: true,
    },
    update: {
      displayName,
      kind: "PERSONAL",
      isActive: true,
    },
  });

  await tx.portfolioOwnerMembership.upsert({
    where: {
      portfolioId_ownerId: {
        portfolioId: personalPortfolio.id,
        ownerId: owner.id,
      },
    },
    create: {
      portfolioId: personalPortfolio.id,
      ownerId: owner.id,
      weightPct: 100,
    },
    update: {
      weightPct: 100,
    },
  });

  return owner;
}

export async function syncAccountOwnerMapping(
  accountKey: string,
  rawOwner: string | null | undefined,
  source: MappingSource = "IMPORT",
) {
  await prisma.$transaction(async (tx) => {
    const owner = await ensureCanonicalOwner(tx, rawOwner);
    if (!owner) {
      await tx.portfolioAccountOwner.deleteMany({ where: { accountKey } });
      return;
    }

    await tx.portfolioAccountOwner.upsert({
      where: { accountKey },
      create: {
        accountKey,
        ownerId: owner.id,
        source,
      },
      update: {
        ownerId: owner.id,
        source,
      },
    });
  });
}

export async function syncExternalAccountOwnerMapping(
  externalAccountId: string,
  rawOwner: string | null | undefined,
  source: MappingSource = "IMPORT",
) {
  await prisma.$transaction(async (tx) => {
    const owner = await ensureCanonicalOwner(tx, rawOwner);
    if (!owner) {
      await tx.externalPortfolioAccountOwner.deleteMany({ where: { externalAccountId } });
      return;
    }

    await tx.externalPortfolioAccountOwner.upsert({
      where: { externalAccountId },
      create: {
        externalAccountId,
        ownerId: owner.id,
        source,
      },
      update: {
        ownerId: owner.id,
        source,
      },
    });
  });
}

export async function replaceNonFinancialAssetOwnerShares(
  nonFinancialAssetId: string,
  ownerShares: OwnerShareInput[],
  source: MappingSource = "IMPORT",
) {
  const grouped = new Map<string, { ownerLabel: string; sharePct: number }>();

  for (const row of ownerShares) {
    if (!row || !(row.sharePct > 0)) continue;
    const ownerLabel = sanitizePortfolioOwner(row.owner);
    const ownerKey = portfolioOwnerKey(row.owner);
    if (!ownerLabel || !ownerKey) continue;
    const current = grouped.get(ownerKey);
    if (current) {
      current.sharePct += row.sharePct;
    } else {
      grouped.set(ownerKey, { ownerLabel, sharePct: row.sharePct });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.nonFinancialAssetOwnerShare.deleteMany({ where: { nonFinancialAssetId } });

    for (const [, groupedShare] of grouped) {
      const owner = await ensureCanonicalOwner(tx, groupedShare.ownerLabel);
      if (!owner) continue;
      await tx.nonFinancialAssetOwnerShare.create({
        data: {
          nonFinancialAssetId,
          ownerId: owner.id,
          sharePct: groupedShare.sharePct,
          source,
        },
      });
    }
  });
}