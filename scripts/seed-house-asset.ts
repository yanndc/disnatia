import { prisma } from "../src/lib/db/prisma";

async function main() {
  const today = new Date();
  const asOfDate = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12, 0, 0),
  );

  const id = "asset_maison_principale";
  const assetKey = "asset:maison_principale";

  const marketValue = 600000;
  const mortgageBalance = 250000;
  const netEquity = marketValue - mortgageBalance;

  await prisma.nonFinancialAsset.upsert({
    where: { assetKey },
    create: {
      id,
      assetKey,
      assetType: "REAL_ESTATE",
      displayLabel: "Maison principale",
      owner: "YANN DE CHAMPLAIN",
      currency: "CAD",
      isActive: true,
      snapshots: {
        create: {
          asOfDate,
          marketValue,
          mortgageBalance,
          netEquity,
          notes: "Seed initial maison",
        },
      },
    },
    update: {
      displayLabel: "Maison principale",
      owner: "YANN DE CHAMPLAIN",
      currency: "CAD",
      isActive: true,
    },
  });

  await prisma.nonFinancialAssetSnapshot.upsert({
    where: {
      nonFinancialAssetId_asOfDate: {
        nonFinancialAssetId: id,
        asOfDate,
      },
    },
    create: {
      nonFinancialAssetId: id,
      asOfDate,
      marketValue,
      mortgageBalance,
      netEquity,
      notes: "Seed initial maison",
    },
    update: {
      marketValue,
      mortgageBalance,
      netEquity,
      notes: "Seed initial maison",
    },
  });

  console.log(
    JSON.stringify({
      ok: true,
      assetKey,
      asOfDate: asOfDate.toISOString().slice(0, 10),
      marketValue,
      mortgageBalance,
      netEquity,
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
