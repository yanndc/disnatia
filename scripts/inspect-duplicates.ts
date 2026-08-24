import { prisma } from "@/lib/db/prisma";

async function inspectDuplicates() {
  const txs = await prisma.portfolioTransactionLine.findMany({
    where: {
      ticker: "AAPL",
      settlementDate: {
        gte: new Date("2026-02-12"),
        lte: new Date("2026-08-13")
      }
    },
    orderBy: [
      { settlementDate: "asc" },
      { id: "asc" }
    ]
  });

  console.log("Found", txs.length, "AAPL transactions from 2026-02-12 onwards:\n");
  txs.forEach((tx, i) => {
    const date = tx.settlementDate?.toISOString().split("T")[0];
    console.log(`[${i}] ID: ${tx.id.substring(0, 8)}`);
    console.log(`    Date: ${date}`);
    console.log(`    Quantity: ${tx.quantity} @ $${tx.price}`);
    console.log(`    Amount: $${tx.amount}`);
    console.log(`    Type: ${tx.transactionType}`);
    console.log(`    Raw JSON keys: ${Object.keys(tx.rawJson || {}).join(", ")}`);
    console.log("");
  });

  // Group by date and quantity
  const byDateQty = new Map();
  txs.forEach(tx => {
    const key = `${tx.settlementDate?.toISOString().split("T")[0]}|${tx.quantity}`;
    if (!byDateQty.has(key)) byDateQty.set(key, []);
    byDateQty.get(key).push(tx);
  });

  console.log("\nGrouped by date + quantity:");
  for (const [key, txList] of byDateQty) {
    if (txList.length > 1) {
      console.log(`\n⚠️ DUPLICATE: ${key} (${txList.length} times)`);
      txList.forEach((tx, i) => {
        console.log(`   [${i}] ID: ${tx.id} | Amount: $${tx.amount}`);
      });
    }
  }
}

inspectDuplicates()
  .catch(console.error)
  .finally(() => process.exit());
