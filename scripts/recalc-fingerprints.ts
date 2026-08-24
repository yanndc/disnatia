import { prisma } from "@/lib/db/prisma";
import { txFingerprint } from "@/lib/csv/tx-fingerprint";

async function recalcFingerprints() {
  console.log("🔄 Recalculating all transaction fingerprints with normalized tickers...\n");

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
      fingerprint: true
    }
  });

  console.log(`Found ${allTxs.length} transactions to recalculate\n`);

  let changed = 0;
  let unchanged = 0;
  const updates: Array<{ id: string; newFp: string }> = [];

  for (const tx of allTxs) {
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

    if (newFp !== tx.fingerprint) {
      changed++;
      updates.push({ id: tx.id, newFp });
      if (changed <= 5) {
        console.log(`Changed: ${tx.ticker} | Old: ${tx.fingerprint?.substring(0, 8)} → New: ${newFp.substring(0, 8)}`);
      }
    } else {
      unchanged++;
    }
  }

  console.log(`\n${changed} fingerprints changed`);
  console.log(`${unchanged} fingerprints unchanged`);

  if (changed > 0) {
    console.log(`\n💾 Updating ${changed} transactions...`);

    for (let i = 0; i < updates.length; i += 100) {
      const batch = updates.slice(i, i + 100);
      for (const { id, newFp } of batch) {
        await prisma.portfolioTransactionLine.update({
          where: { id },
          data: { fingerprint: newFp }
        });
      }
      console.log(`  Updated ${Math.min(i + 100, updates.length)}/${updates.length}`);
    }

    console.log("\n✅ Fingerprints recalculated successfully!");
  }
}

recalcFingerprints()
  .catch(console.error)
  .finally(() => process.exit());
