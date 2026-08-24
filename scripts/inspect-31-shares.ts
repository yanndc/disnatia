import { prisma } from "@/lib/db/prisma";

async function inspect31() {
  const txs = await prisma.portfolioTransactionLine.findMany({
    where: {
      ticker: { contains: "AAPL" },
      quantity: 31
    }
  });

  console.log(`Found ${txs.length} transactions with quantity 31:\n`);

  txs.forEach((tx, i) => {
    const date = tx.settlementDate?.toISOString().split("T")[0] || tx.tradeDate?.toISOString().split("T")[0];
    console.log(`[${i}] ${date}`);
    console.log(`    ID: ${tx.id}`);
    console.log(`    Account: ${tx.accountKey}`);
    console.log(`    Type: ${tx.transactionType}`);
    console.log(`    Category: ${tx.txCategory}`);
    console.log(`    Amount: $${tx.amount}`);
    console.log(`    Price: $${tx.price}`);
    console.log(`    Description: ${tx.securityName}`);
    console.log("");
  });
}

inspect31()
  .catch(console.error)
  .finally(() => process.exit());
