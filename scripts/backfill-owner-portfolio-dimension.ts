import { prisma } from "../src/lib/db/prisma";
import {
  portfolioOwnerKey,
  sanitizePortfolioOwner,
} from "../src/lib/portfolio/sanitize-portfolio-owner";
import { resolveNonFinancialAssetOwnerShares } from "../src/lib/portfolio/non-financial-asset-owner-shares";

type OwnerSeed = { ownerKey: string; displayName: string };

function collectOwner(seeds: Map<string, OwnerSeed>, raw: string | null | undefined) {
  const display = sanitizePortfolioOwner(raw);
  const key = portfolioOwnerKey(raw);
  if (!display || !key) return;
  if (!seeds.has(key)) seeds.set(key, { ownerKey: key, displayName: display });
}

async function main() {
  const [accountStates, externalAccounts, nonFinancialAssets] = await Promise.all([
    prisma.portfolioAccountState.findMany({
      select: { accountKey: true, owner: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.externalPortfolioAccount.findMany({
      select: { id: true, owner: true },
    }),
    prisma.nonFinancialAsset.findMany({
      select: { id: true, owner: true, metadata: true },
    }),
  ]);

  const ownerSeeds = new Map<string, OwnerSeed>();

  for (const row of accountStates) collectOwner(ownerSeeds, row.owner);
  for (const row of externalAccounts) collectOwner(ownerSeeds, row.owner);
  for (const row of nonFinancialAssets) {
    collectOwner(ownerSeeds, row.owner);
    const shares = resolveNonFinancialAssetOwnerShares(row.owner, row.metadata);
    for (const s of shares) collectOwner(ownerSeeds, s.owner);
  }

  const owners = [...ownerSeeds.values()];

  for (const seed of owners) {
    await prisma.owner.upsert({
      where: { ownerKey: seed.ownerKey },
      create: {
        ownerKey: seed.ownerKey,
        displayName: seed.displayName,
      },
      update: {
        displayName: seed.displayName,
        isActive: true,
      },
    });
  }

  const ownersDb = await prisma.owner.findMany({
    where: { ownerKey: { in: owners.map((o) => o.ownerKey) } },
    select: { id: true, ownerKey: true, displayName: true },
  });
  const ownerIdByKey = new Map(ownersDb.map((o) => [o.ownerKey, o.id]));

  for (const owner of ownersDb) {
    const portfolio = await prisma.portfolio.upsert({
      where: { portfolioKey: `owner:${owner.ownerKey}` },
      create: {
        portfolioKey: `owner:${owner.ownerKey}`,
        displayName: owner.displayName,
        kind: "PERSONAL",
      },
      update: {
        displayName: owner.displayName,
        kind: "PERSONAL",
        isActive: true,
      },
    });

    await prisma.portfolioOwnerMembership.upsert({
      where: {
        portfolioId_ownerId: {
          portfolioId: portfolio.id,
          ownerId: owner.id,
        },
      },
      create: {
        portfolioId: portfolio.id,
        ownerId: owner.id,
        weightPct: 100,
      },
      update: {
        weightPct: 100,
      },
    });
  }

  if (ownersDb.length > 0) {
    const household = await prisma.portfolio.upsert({
      where: { portfolioKey: "household:all" },
      create: {
        portfolioKey: "household:all",
        displayName: "Famille",
        kind: "HOUSEHOLD",
      },
      update: {
        displayName: "Famille",
        kind: "HOUSEHOLD",
        isActive: true,
      },
    });

    const weight = 100 / ownersDb.length;
    for (const owner of ownersDb) {
      await prisma.portfolioOwnerMembership.upsert({
        where: {
          portfolioId_ownerId: {
            portfolioId: household.id,
            ownerId: owner.id,
          },
        },
        create: {
          portfolioId: household.id,
          ownerId: owner.id,
          weightPct: weight,
        },
        update: {
          weightPct: weight,
        },
      });
    }
  }

  const ownerByAccountKey = new Map<string, string>();
  for (const row of accountStates) {
    if (ownerByAccountKey.has(row.accountKey)) continue;
    const key = portfolioOwnerKey(row.owner);
    if (!key) continue;
    ownerByAccountKey.set(row.accountKey, key);
  }

  for (const [accountKey, ownerKey] of ownerByAccountKey) {
    const ownerId = ownerIdByKey.get(ownerKey);
    if (!ownerId) continue;
    await prisma.portfolioAccountOwner.upsert({
      where: { accountKey },
      create: {
        accountKey,
        ownerId,
        source: "BACKFILL",
      },
      update: {
        ownerId,
        source: "BACKFILL",
      },
    });
  }

  for (const row of externalAccounts) {
    const ownerKey = portfolioOwnerKey(row.owner);
    if (!ownerKey) continue;
    const ownerId = ownerIdByKey.get(ownerKey);
    if (!ownerId) continue;
    await prisma.externalPortfolioAccountOwner.upsert({
      where: { externalAccountId: row.id },
      create: {
        externalAccountId: row.id,
        ownerId,
        source: "BACKFILL",
      },
      update: {
        ownerId,
        source: "BACKFILL",
      },
    });
  }

  for (const row of nonFinancialAssets) {
    const shares = resolveNonFinancialAssetOwnerShares(row.owner, row.metadata);
    await prisma.nonFinancialAssetOwnerShare.deleteMany({
      where: { nonFinancialAssetId: row.id },
    });

    for (const s of shares) {
      const ownerKey = portfolioOwnerKey(s.owner);
      if (!ownerKey) continue;
      const ownerId = ownerIdByKey.get(ownerKey);
      if (!ownerId) continue;
      await prisma.nonFinancialAssetOwnerShare.create({
        data: {
          nonFinancialAssetId: row.id,
          ownerId,
          sharePct: s.sharePct,
          source: "BACKFILL",
        },
      });
    }
  }

  console.log(
    JSON.stringify({
      owners: ownersDb.length,
      accountMappings: ownerByAccountKey.size,
      externalMappings: externalAccounts.length,
      nonFinancialAssets: nonFinancialAssets.length,
      householdPortfolio: ownersDb.length > 0,
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
