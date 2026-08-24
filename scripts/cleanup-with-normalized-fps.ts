import { prisma } from "@/lib/db/prisma";
import { txFingerprint } from "@/lib/csv/tx-fingerprint";

async function cleanupWithNormalizedFps() {
  console.log("🔍 Finding duplicates with normalized fingerprints...\n");

  const allTxs = await prisma.portfolioTransactionLine.findMany({
    select: {
      id: true,
      accountKey: true,
      tradeDate: true,
      settlementDate: true,
      transactionType: true,
      ticker: true,
      amount: true,
      currency: true,
      quantity: true,
      price: true,
      securityName: true,
      import: { select: { importedAt: true } }
    }
  });

  // Group by normalized fingerprint
  const fpMap = new Map();
  for (const tx of allTxs) {
    const fp = txFingerprint(tx.accountKey || "", {
      tradeDate: tx.tradeDate,
      settlementDate: tx.settlementDate,
      transactionType: tx.transactionType,
      ticker: tx.ticker,
      amount: tx.amount,
      currency: tx.currency,
      quantity: tx.quantity,
      price: tx.price,
      securityName: tx.securityName
    });

    if (!fpMap.has(fp)) fpMap.set(fp, []);
    fpMap.get(fp).push(tx);
  }

  // Find groups with duplicates
  const duplicateGroups = [...fpMap.entries()].filter(([_, txs]) => txs.length > 1);

  console.log(`Found ${duplicateGroups.length} groups of duplicates\n`);

  const toDelete: string[] = [];

  for (const [fp, txs] of duplicateGroups) {
    // Sort by import date (keep newest)
    const sorted = [...txs].sort((a, b) =>
      b.import.importedAt.getTime() - a.import.importedAt.getTime()
    );

    console.log(`📌 FP: ${fp.substring(0, 8)} (${sorted[0].ticker})`);
    sorted.forEach((tx, idx) => {
      const date = tx.import.importedAt.toISOString().split("T")[0];
      const action = idx === 0 ? "✅ KEEP" : "❌ DELETE";
      console.log(`   [${idx}] ${tx.ticker} | ${tx.quantity} @ ${date} | ${action}`);
      if (idx > 0) toDelete.push(tx.id);
    });
    console.log("");
  }

  if (toDelete.length === 0) {
    console.log("✅ No duplicates found!");
    return;
  }

  console.log(`\n🔴 Deleting ${toDelete.length} duplicate transactions...`);
  const result = await prisma.portfolioTransactionLine.deleteMany({
    where: { id: { in: toDelete } }
  });

  console.log(`✅ Deleted ${result.count}`);

  // Now update fingerprints for remaining transactions
  console.log("\n🔄 Updating fingerprints for all remaining transactions...");
  const remaining = await prisma.portfolioTransactionLine.findMany({
    select: {
      id: true,
      accountKey: true,
      tradeDate: true,
      settlementDate: true,
      transactionType: true,
      ticker: true,
      amount: true,
      currency: true,
      quantity: true,
      price: true,
      securityName: true
    }
  });

  let updated = 0;
  for (let i = 0; i < remaining.length; i += 50) {
    const batch = remaining.slice(i, i + 50);
    for (const tx of batch) {
      const newFp = txFingerprint(tx.accountKey || "", {
        tradeDate: tx.tradeDate,
        settlementDate: tx.settlementDate,
        transactionType: tx.transactionType,
        ticker: tx.ticker,
        amount: tx.amount,
        currency: tx.currency,
        quantity: tx.quantity,
        price: tx.price,
        securityName: tx.securityName
      });

      await prisma.portfolioTransactionLine.update({
        where: { id: tx.id },
        data: { fingerprint: newFp }
      });
      updated++;
    }
    console.log(`  ${Math.min(i + 50, remaining.length)}/${remaining.length}`);
  }

  console.log(`✅ Updated ${updated} fingerprints\n`);

  // Re-project
  console.log("🔄 Re-projecting holdings...");
  const { projectHoldingsFromTransactions } = await import("@/features/portfolio/project-transaction-holdings");
  const res = await projectHoldingsFromTransactions();
  console.log(`✅ Done: ${res.currentHoldingsProjected} positions`);
}

cleanupWithNormalizedFps()
  .catch(console.error)
  .finally(() => process.exit());
