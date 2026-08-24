import { prisma } from "@/lib/db/prisma";

async function findAaplDuplicate() {
  const txs = await prisma.portfolioTransactionLine.findMany({
    where: {
      ticker: { in: ["AAPL-U", "AAPL", "AAPL-C"] }
    },
    orderBy: [
      { settlementDate: "asc" },
      { tradeDate: "asc" }
    ]
  });

  console.log("Found", txs.length, "AAPL transactions:");
  txs.forEach((tx, i) => {
    const date = tx.settlementDate?.toISOString().split("T")[0] || tx.tradeDate?.toISOString().split("T")[0];
    console.log(
      `${i}: ${date} | ${tx.ticker} | ${tx.quantity} shares @ $${tx.price} | FP: ${tx.fingerprint?.substring(0, 8) || "NULL"}`
    );
  });

  // Check for fingerprint nulls or duplicates
  const nullFingerprints = txs.filter(t => !t.fingerprint);
  console.log("\nTransactions with NULL fingerprint:", nullFingerprints.length);

  // Check for duplicate fingerprints
  const fpMap = new Map();
  txs.forEach(tx => {
    if (tx.fingerprint) {
      if (!fpMap.has(tx.fingerprint)) fpMap.set(tx.fingerprint, []);
      fpMap.get(tx.fingerprint).push(tx);
    }
  });

  const duplicates = [...fpMap.values()].filter(arr => arr.length > 1);
  console.log("Duplicate fingerprints found:", duplicates.length);
  duplicates.forEach(dup => {
    console.log(`FP: ${dup[0].fingerprint?.substring(0, 8)} -> ${dup.length} entries`);
    dup.forEach(d => {
      const date = d.settlementDate?.toISOString().split("T")[0] || d.tradeDate?.toISOString().split("T")[0];
      console.log(`  - ${date} | ID: ${d.id}`);
    });
  });
}

findAaplDuplicate()
  .catch(console.error)
  .finally(() => process.exit());
