import { prisma } from "@/lib/db/prisma";

async function verifyFix() {
  console.log("✅ Verifying duplicate cleanup...\n");

  // Check AAPL specifically
  const aapl = await prisma.portfolioHolding.findUnique({
    where: {
      accountKey_ticker_currency: {
        accountKey: "REER de Yann",
        ticker: "AAPL",
        currency: "CAD"
      }
    }
  });

  if (aapl) {
    console.log(`AAPL holding: ${aapl.quantity} shares`);
  } else {
    // Try to find any AAPL holding
    const allAapl = await prisma.portfolioHolding.findMany({
      where: { ticker: { contains: "AAPL" } }
    });
    if (allAapl.length > 0) {
      console.log("AAPL holdings found:");
      allAapl.forEach(h => {
        console.log(`  ${h.accountKey} | ${h.ticker}: ${h.quantity} shares`);
      });
    }
  }

  // Check total holdings count
  const totalHoldings = await prisma.portfolioHolding.findMany({
    orderBy: { snapshotValue: "desc" }
  });

  console.log(`\nTotal positions: ${totalHoldings.length}`);
  console.log("\nTop 10 by value:");
  totalHoldings.slice(0, 10).forEach((h, i) => {
    console.log(`${i + 1}. ${h.ticker}: ${h.quantity} shares @ $${h.snapshotPrice?.toFixed(2) || "N/A"}`);
  });

  // Check for any remaining duplicates
  const allTxs = await prisma.portfolioTransactionLine.findMany({
    select: { ticker: true, quantity: true, amount: true, settlementDate: true, transactionType: true }
  });

  const dupCheck = new Map();
  let suspiciousTxs = 0;
  for (const tx of allTxs) {
    if (tx.transactionType === "DIVIDENDE") {
      const key = `${tx.ticker}|${tx.settlementDate?.toISOString()}|${tx.quantity}|${tx.amount}`;
      dupCheck.set(key, (dupCheck.get(key) || 0) + 1);
      if (dupCheck.get(key) > 1) suspiciousTxs++;
    }
  }

  console.log(`\nRemaining suspicious dividend transactions: ${suspiciousTxs}`);
}

verifyFix()
  .catch(console.error)
  .finally(() => process.exit());
