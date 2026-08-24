import { prisma } from "@/lib/db/prisma";

async function finalCleanup() {
  // Find the duplicates
  console.log("Finding final duplicates...\n");

  // For 5KFZEU3: AAPL-U from old import on 2026-02-03
  const dup1 = await prisma.portfolioTransactionLine.findUnique({
    where: { id: "cmot147xy003blsmn8dfih2lz" }
  });

  // For 5KFZES7: similar situation
  const txs5kfzes7 = await prisma.portfolioTransactionLine.findMany({
    where: {
      accountKey: "5KFZES7|USD",
      ticker: { contains: "AAPL" },
      txCategory: { in: ["BUY", "TRANSFER_IN"] }
    },
    orderBy: [{ settlementDate: "asc" }]
  });

  console.log("5KFZES7 BUY/TRANSFER transactions:");
  let dup2Id: string | null = null;
  let total = 0;
  txs5kfzes7.forEach((tx, i) => {
    total += tx.quantity || 0;
    console.log(`[${i}] ${tx.settlementDate?.toISOString().split("T")[0]} | ${tx.ticker} | ${tx.quantity}`);
    console.log(`     ID: ${tx.id} | Import: ${tx.importId.substring(0, 8)}`);
    // The duplicate should be on 2026-02-03 AAPL-U from an older import
    if (
      tx.settlementDate?.toISOString().startsWith("2026-02-03") &&
      tx.ticker?.includes("AAPL-U") &&
      tx.importId.substring(0, 8) !== "cmt3em5t"
    ) {
      dup2Id = tx.id;
    }
  });
  console.log(`Total: ${total} (should be 2, but we have 3)\n`);

  const toDelete = [];
  if (dup1) {
    toDelete.push(dup1.id);
    console.log(`❌ Will delete from 5KFZEU3: ${dup1.id} (${dup1.ticker} ${dup1.quantity})`);
  }
  if (dup2Id) {
    toDelete.push(dup2Id);
    const tx = txs5kfzes7.find(t => t.id === dup2Id);
    console.log(`❌ Will delete from 5KFZES7: ${dup2Id} (${tx?.ticker} ${tx?.quantity})`);
  }

  if (toDelete.length === 0) {
    console.log("No duplicates found to delete");
    return;
  }

  console.log(`\nDeleting ${toDelete.length} transactions...`);
  const result = await prisma.portfolioTransactionLine.deleteMany({
    where: { id: { in: toDelete } }
  });

  console.log(`✅ Deleted ${result.count} transactions`);

  // Re-project
  console.log("\nRe-projecting holdings...");
  const { projectHoldingsFromTransactions } = await import("@/features/portfolio/project-transaction-holdings");
  const res = await projectHoldingsFromTransactions();
  console.log(`✅ Done: ${res.currentHoldingsProjected} positions`);

  // Verify
  const aapl = await prisma.portfolioHolding.findMany({
    where: { ticker: "AAPL" },
    orderBy: { accountKey: "asc" }
  });

  console.log("\nFinal AAPL quantities:");
  aapl.forEach(h => {
    console.log(`  ${h.accountKey}: ${h.quantity} (should be: 5KFZEU3=31, 5KFZES7=2)`);
  });
}

finalCleanup()
  .catch(console.error)
  .finally(() => process.exit());
