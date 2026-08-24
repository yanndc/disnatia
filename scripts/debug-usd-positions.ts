import { prisma } from "@/lib/db/prisma";

async function debugUsd() {
  console.log("🔍 Checking USD positions:\n");

  // Get snapshots
  const snapshots = await prisma.portfolioPosition.findMany({
    where: { ticker: { contains: "-U" } },
    select: {
      accountNumber: true,
      ticker: true,
      quantity: true,
      currency: true,
      import: { select: { importedAt: true, dataToDate: true } }
    },
    distinct: ["accountNumber", "ticker"],
    orderBy: [{ import: { importedAt: "desc" } }]
  });

  console.log(`Portfolio snapshots with -U (${snapshots.length}):`);
  snapshots.slice(0, 5).forEach(s => {
    console.log(`  ${s.ticker} in ${s.accountNumber}: ${s.quantity} (${s.currency})`);
  });

  // Get transactions with USD
  const txsUsd = await prisma.portfolioTransactionLine.findMany({
    where: {
      ticker: { contains: "-U" },
      txCategory: { in: ["BUY", "SELL", "TRANSFER_IN", "TRANSFER_OUT"] }
    },
    select: {
      accountKey: true,
      ticker: true,
      quantity: true,
      currency: true
    },
    distinct: ["accountKey", "ticker"]
  });

  console.log(`\nTransactions with -U ticker (${txsUsd.length}):`);
  txsUsd.slice(0, 5).forEach(t => {
    console.log(`  ${t.accountKey} | ${t.ticker}: ${t.quantity}`);
  });

  // Check holdings
  const holdingsUsd = await prisma.portfolioHolding.findMany({
    where: { ticker: { contains: "-U" } }
  });

  console.log(`\nHoldings with -U (${holdingsUsd.length}):`);
  holdingsUsd.forEach(h => {
    console.log(`  ${h.accountKey} | ${h.ticker}: ${h.quantity}`);
  });

  // What about holdings WITHOUT -U but with USD currency?
  const holdingsUsdNoSuffix = await prisma.portfolioHolding.findMany({
    where: { currency: "USD", ticker: { not: { contains: "-" } } }
  });

  console.log(`\nHoldings with USD currency but no suffix (${holdingsUsdNoSuffix.length}):`);
  holdingsUsdNoSuffix.slice(0, 5).forEach(h => {
    console.log(`  ${h.accountKey} | ${h.ticker}: ${h.quantity}`);
  });
}

debugUsd()
  .catch(console.error)
  .finally(() => process.exit());
