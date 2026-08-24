import { prisma } from "@/lib/db/prisma";

async function debugAapl() {
  // Get all AAPL holdings with account details
  const allAapl = await prisma.portfolioHolding.findMany({
    where: { ticker: { contains: "AAPL" } },
    include: { /* account info is in the holding */ }
  });

  console.log("All AAPL holdings:\n");
  allAapl.forEach(h => {
    console.log(`Account: ${h.accountKey} (${h.accountNumber})`);
    console.log(`  Ticker: ${h.ticker}`);
    console.log(`  Quantity: ${h.quantity} shares`);
    console.log(`  Avg Cost: $${h.averageCost}`);
    console.log(`  Security: ${h.securityName}`);
    console.log(`  As of: ${h.asOf.toISOString().split("T")[0]}`);
    console.log("");
  });

  // Get all transactions for these accounts
  for (const aapl of allAapl) {
    const txs = await prisma.portfolioTransactionLine.findMany({
      where: {
        accountKey: aapl.accountKey,
        ticker: { contains: "AAPL" }
      },
      orderBy: [{ settlementDate: "asc" }]
    });

    console.log(`\n📊 Transactions for ${aapl.accountKey}:`);
    let runningQty = 0;
    txs.forEach((tx, i) => {
      const date = tx.settlementDate?.toISOString().split("T")[0] || tx.tradeDate?.toISOString().split("T")[0];
      runningQty += tx.quantity || 0;
      console.log(`${i + 1}. ${date} | ${tx.ticker} | ${tx.quantity} shares | Running: ${runningQty}`);
    });
    console.log(`Final quantity: ${runningQty}`);
  }
}

debugAapl()
  .catch(console.error)
  .finally(() => process.exit());
