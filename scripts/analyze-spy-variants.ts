import { prisma } from "@/lib/db/prisma";

async function analyzeSpy() {
  console.log("🔍 Analyzing SPY variants in snapshots:\n");

  const all = await prisma.portfolioPosition.findMany({
    where: { ticker: { in: ["SPY", "SPY-U"] } },
    select: {
      accountNumber: true,
      ticker: true,
      quantity: true,
      currency: true,
      import: {
        select: {
          importedAt: true,
          dataToDate: true,
          sourceFileName: true
        }
      }
    },
    orderBy: [
      { accountNumber: "asc" },
      { import: { importedAt: "desc" } }
    ]
  });

  console.log(`Found ${all.length} SPY/SPY-U positions\n`);

  // Group by account + import date
  const byAccountAndDate = new Map();
  for (const pos of all) {
    const key = `${pos.accountNumber} | ${pos.import.importedAt.toISOString().split("T")[0]}`;
    if (!byAccountAndDate.has(key)) byAccountAndDate.set(key, []);
    byAccountAndDate.get(key).push(pos);
  }

  for (const [key, positions] of byAccountAndDate) {
    console.log(`${key}:`);
    positions.forEach(p => {
      console.log(`  ${p.ticker}: ${p.quantity} (${p.currency})`);
    });
    if (positions.length > 1) {
      console.log(`  ⚠️ MULTIPLE entries for same date/account`);
    }
    console.log("");
  }

  // Check transactions
  const txs = await prisma.portfolioTransactionLine.findMany({
    where: { ticker: { in: ["SPY", "SPY-U"] } },
    select: {
      ticker: true,
      quantity: true,
      txCategory: true,
      accountKey: true
    },
    distinct: ["ticker", "accountKey"]
  });

  console.log(`\nTransactions for SPY (${txs.length}):`);
  txs.forEach(t => {
    console.log(`  ${t.accountKey} | ${t.ticker}: ${t.quantity} (${t.txCategory})`);
  });
}

analyzeSpy()
  .catch(console.error)
  .finally(() => process.exit());
