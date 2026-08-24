import { prisma } from "@/lib/db/prisma";

async function findExtraBuy() {
  // For 5KFZEU3, find all BUY/TRANSFER transactions
  const txs5kfzeu3 = await prisma.portfolioTransactionLine.findMany({
    where: {
      accountKey: "5KFZEU3|USD",
      ticker: { contains: "AAPL" },
      txCategory: { in: ["BUY", "TRANSFER_IN"] }
    },
    orderBy: [{ settlementDate: "asc" }]
  });

  console.log("5KFZEU3 BUY/TRANSFER transactions:\n");
  let total = 0;
  txs5kfzeu3.forEach((tx, i) => {
    total += tx.quantity || 0;
    console.log(`[${i}] ${tx.settlementDate?.toISOString().split("T")[0]} | ${tx.ticker} | ${tx.quantity} (${tx.transactionType})`);
    console.log(`     ID: ${tx.id}`);
    console.log(`     Price: $${tx.price} | Amount: $${tx.amount}`);
    console.log(`     Import: ${tx.importId.substring(0, 8)}`);
  });
  console.log(`\nTotal: ${total} (should be 31, but we have 32)\n`);

  // Check for similar transactions on same date
  const feb3_2026 = txs5kfzeu3.filter(t =>
    t.settlementDate?.toISOString().startsWith("2026-02-03")
  );

  if (feb3_2026.length > 1) {
    console.log("⚠️ FOUND MULTIPLE on 2026-02-03:");
    feb3_2026.forEach(t => {
      console.log(`  ${t.ticker} ${t.quantity} @ $${t.price} | ID: ${t.id}`);
    });
  }
}

findExtraBuy()
  .catch(console.error)
  .finally(() => process.exit());
