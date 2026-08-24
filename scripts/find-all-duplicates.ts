import { prisma } from "@/lib/db/prisma";

async function findAllDuplicates() {
  // Get all AAPL transactions grouped by date
  const aapl = await prisma.portfolioTransactionLine.findMany({
    where: { ticker: { contains: "AAPL" } },
    select: {
      id: true,
      accountKey: true,
      ticker: true,
      quantity: true,
      amount: true,
      settlementDate: true,
      tradeDate: true,
      transactionType: true,
      fingerprint: true
    }
  });

  console.log("Checking for exact duplicates (same everything):\n");

  // Group by all fields
  const groups = new Map();
  for (const tx of aapl) {
    const key = `${tx.accountKey}|${tx.ticker}|${tx.quantity}|${tx.settlementDate}|${tx.transactionType}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tx);
  }

  const dupes = [...groups.entries()].filter(([_, arr]) => arr.length > 1);

  if (dupes.length > 0) {
    console.log(`Found ${dupes.length} duplicate groups:\n`);
    for (const [key, txs] of dupes) {
      console.log(`KEY: ${key}`);
      for (const tx of txs) {
        console.log(`  ID: ${tx.id} | FP: ${tx.fingerprint?.substring(0, 8) || "NULL"}`);
      }
      console.log("");
    }
  } else {
    console.log("✅ No exact duplicates found");
  }

  // Now check what's left and calculate total
  let total = 0;
  let boughtsOnly = 0;
  const sortedTxs = [...aapl]
    .filter(t => t.transactionType !== "DIVIDENDE" && t.transactionType !== "INTÉRÊT")
    .sort((a, b) => {
      const da = a.settlementDate || a.tradeDate || new Date(0);
      const db = b.settlementDate || b.tradeDate || new Date(0);
      return da.getTime() - db.getTime();
    });

  console.log("\nAll non-dividend transactions:\n");
  sortedTxs.forEach((tx, i) => {
    const date = tx.settlementDate?.toISOString().split("T")[0] || tx.tradeDate?.toISOString().split("T")[0];
    total += tx.quantity || 0;
    if (tx.transactionType?.toUpperCase().includes("BUY") || tx.transactionType === "ACHAT") {
      boughtsOnly += tx.quantity || 0;
    }
    console.log(`${i}: ${date} | ${tx.ticker} | ${tx.quantity} shares | ${tx.transactionType}`);
  });

  console.log(`\nRunning total: ${total}`);
}

findAllDuplicates()
  .catch(console.error)
  .finally(() => process.exit());
