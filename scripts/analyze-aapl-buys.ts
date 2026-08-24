import { prisma } from "@/lib/db/prisma";

async function analyzeAaplBuys() {
  // Get all AAPL transactions that affect quantity (BUY/SELL/TRANSFER)
  const txs = await prisma.portfolioTransactionLine.findMany({
    where: {
      ticker: { contains: "AAPL" },
      txCategory: { in: ["BUY", "SELL", "TRANSFER_IN", "TRANSFER_OUT", "STOCK_SPLIT", "STOCK_DIVIDEND"] }
    },
    select: {
      id: true,
      accountKey: true,
      ticker: true,
      quantity: true,
      settlementDate: true,
      tradeDate: true,
      transactionType: true,
      txCategory: true
    },
    orderBy: [{ settlementDate: "asc" }]
  });

  console.log("All AAPL transactions that affect quantity:\n");

  const byAccount = new Map<string, typeof txs>();
  for (const tx of txs) {
    if (!byAccount.has(tx.accountKey!)) byAccount.set(tx.accountKey!, []);
    byAccount.get(tx.accountKey!)!.push(tx);
  }

  for (const [account, acctTxs] of byAccount) {
    console.log(`\n📊 Account: ${account}`);
    let total = 0;
    acctTxs.forEach((tx, i) => {
      const date = tx.settlementDate?.toISOString().split("T")[0];
      total += tx.quantity || 0;
      console.log(`${i + 1}. ${date} | ${tx.ticker} | ${tx.quantity} (${tx.txCategory}) | Running: ${total}`);
    });
    console.log(`Final: ${total} shares\n`);
  }

  // Get current holdings
  const holdings = await prisma.portfolioHolding.findMany({
    where: { ticker: { contains: "AAPL" } }
  });

  console.log("Current holdings:");
  holdings.forEach(h => {
    console.log(`  ${h.accountKey}: ${h.quantity} shares`);
  });
}

analyzeAaplBuys()
  .catch(console.error)
  .finally(() => process.exit());
