import { prisma } from "@/lib/db/prisma";

async function checkFeb3() {
  const feb3 = await prisma.portfolioTransactionLine.findMany({
    where: {
      ticker: { contains: "AAPL" },
      settlementDate: new Date("2026-02-03")
    }
  });

  console.log(`Transactions on 2026-02-03: ${feb3.length}\n`);

  feb3.forEach((tx, i) => {
    console.log(`[${i}] ID: ${tx.id}`);
    console.log(`    Ticker: ${tx.ticker}`);
    console.log(`    Quantity: ${tx.quantity}`);
    console.log(`    Category: ${tx.txCategory}`);
    console.log(`    Type: ${tx.transactionType}`);
    console.log(`    Amount: $${tx.amount}`);
    console.log(`    Price: $${tx.price}`);
    console.log(`    Account: ${tx.accountKey}`);
    console.log(`    Import: ${tx.importId}`);
    console.log("");
  });

  // Check if there are exact duplicates
  const groups = new Map();
  for (const tx of feb3) {
    const key = `${tx.accountKey}|${tx.ticker}|${tx.quantity}|${tx.price}|${tx.amount}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  }

  const dupes = [...groups.entries()].filter(([_, arr]) => arr.length > 1);
  if (dupes.length > 0) {
    console.log("FOUND DUPLICATES:\n");
    for (const [key, txs] of dupes) {
      console.log(`Key: ${key}`);
      txs.forEach(tx => console.log(`  - ${tx.id}`));
    }
  } else {
    console.log("✅ No exact duplicates on 2026-02-03");
  }
}

checkFeb3()
  .catch(console.error)
  .finally(() => process.exit());
