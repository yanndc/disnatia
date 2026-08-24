import { prisma } from "@/lib/db/prisma";

async function nuclearCleanup() {
  // Strategy: for each (accountKey + ticker + date + quantity + amount),
  // keep only ONE transaction. Delete all others.

  const all = await prisma.portfolioTransactionLine.findMany({
    select: {
      id: true,
      accountKey: true,
      ticker: true,
      quantity: true,
      amount: true,
      settlementDate: true,
      tradeDate: true,
      importId: true,
      import: {
        select: { importedAt: true }
      }
    }
  });

  // Group by (accountKey + ticker + date + quantity + amount)
  const groups = new Map<string, typeof all>();
  for (const tx of all) {
    const date = tx.settlementDate || tx.tradeDate;
    const key = `${tx.accountKey}|${tx.ticker}|${date?.toISOString()}|${tx.quantity}|${tx.amount}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }

  // Find groups with duplicates
  const duplicateGroups = [...groups.entries()].filter(([_, txs]) => txs.length > 1);

  console.log(`Found ${duplicateGroups.length} groups with duplicates\n`);

  const toDelete: string[] = [];

  for (const [key, txs] of duplicateGroups) {
    // Keep the newest import, delete the rest
    const sorted = [...txs].sort((a, b) =>
      b.import.importedAt.getTime() - a.import.importedAt.getTime()
    );

    console.log(`Duplicates: ${key}`);
    sorted.forEach((tx, idx) => {
      const action = idx === 0 ? "✅ KEEP" : "❌ DELETE";
      console.log(`  [${idx}] ID: ${tx.id} (Import: ${tx.import.importedAt.toISOString().split("T")[0]}) ${action}`);
      if (idx > 0) toDelete.push(tx.id);
    });
    console.log("");
  }

  if (toDelete.length === 0) {
    console.log("✅ No duplicates to delete");
    return;
  }

  console.log(`\n🔴 Deleting ${toDelete.length} duplicate transactions...`);
  const result = await prisma.portfolioTransactionLine.deleteMany({
    where: { id: { in: toDelete } }
  });

  console.log(`✅ Deleted ${result.count} transactions`);

  // Re-project
  console.log("\n🔄 Re-projecting holdings...");
  const { projectHoldingsFromTransactions } = await import("@/features/portfolio/project-transaction-holdings");
  const res = await projectHoldingsFromTransactions();
  console.log(`✅ Re-projection complete: ${res.currentHoldingsProjected} positions`);
}

nuclearCleanup()
  .catch(console.error)
  .finally(() => process.exit());
