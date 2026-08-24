import { prisma } from "@/lib/db/prisma";

async function cleanupDuplicates() {
  console.log("🔍 Scanning for duplicate transactions...\n");

  // Find all dividend transactions that appear multiple times
  const duplicateTxs = await prisma.portfolioTransactionLine.findMany({
    where: {
      txCategory: "DIVIDEND"
    },
    select: {
      id: true,
      ticker: true,
      quantity: true,
      amount: true,
      settlementDate: true,
      tradeDate: true,
      importId: true,
      import: {
        select: {
          importedAt: true,
          dataToDate: true
        }
      }
    }
  });

  // Group by ticker + settlement/trade date + quantity + amount
  const groups = new Map<string, typeof duplicateTxs>();
  for (const tx of duplicateTxs) {
    const date = tx.settlementDate || tx.tradeDate;
    const key = `${tx.ticker}|${date?.toISOString()}|${tx.quantity}|${tx.amount}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }

  // Find duplicates (more than 1 entry per key)
  const duplicates = [...groups.entries()]
    .filter(([_, txList]) => txList.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  if (duplicates.length === 0) {
    console.log("✅ No duplicates found!");
    return;
  }

  console.log(`Found ${duplicates.length} sets of duplicate transactions:\n`);

  const toDelete: string[] = [];

  for (const [key, txList] of duplicates) {
    console.log(`📌 ${key}`);
    console.log(`   Found ${txList.length} copies:`);

    // Sort by import date (keep newest, delete oldest)
    const sorted = [...txList].sort((a, b) =>
      (b.import.importedAt.getTime() - a.import.importedAt.getTime())
    );

    sorted.forEach((tx, idx) => {
      const importDate = tx.import.importedAt.toISOString().split("T")[0];
      const keep = idx === 0 ? " ✅ KEEP" : " ❌ DELETE";
      console.log(`   [${idx}] ID: ${tx.id} (Import: ${importDate})${keep}`);
      if (idx > 0) toDelete.push(tx.id);
    });
    console.log("");
  }

  // Confirm deletion
  console.log(`\n⚠️  About to delete ${toDelete.length} duplicate transactions.\n`);

  if (toDelete.length > 0) {
    console.log("Deleting duplicates...");
    const result = await prisma.portfolioTransactionLine.deleteMany({
      where: {
        id: { in: toDelete }
      }
    });
    console.log(`✅ Deleted ${result.count} transactions\n`);

    // Re-project holdings
    console.log("Re-projecting holdings from transactions...");
    const { projectHoldingsFromTransactions } = await import("@/features/portfolio/project-transaction-holdings");
    const projectionResult = await projectHoldingsFromTransactions();
    console.log(`✅ Projection complete:`);
    console.log(`   - Transactions: ${projectionResult.transactionsRaw} raw, ${projectionResult.transactionsConsidered} after dedup`);
    console.log(`   - Holdings projected: ${projectionResult.currentHoldingsProjected}`);
  }
}

cleanupDuplicates()
  .catch(console.error)
  .finally(() => process.exit());
