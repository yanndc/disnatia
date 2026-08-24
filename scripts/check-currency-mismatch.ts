import { prisma } from "@/lib/db/prisma";

async function checkMismatch() {
  console.log("🔍 Checking for ticker-currency mismatches:\n");

  // Get all transactions grouped by account + ticker
  const txs = await prisma.portfolioTransactionLine.findMany({
    select: {
      accountKey: true,
      ticker: true,
      currency: true,
      quantity: true,
      txCategory: true
    }
  });

  // Group by account + ticker
  const groups = new Map<string, typeof txs>();
  for (const tx of txs) {
    const key = `${tx.accountKey}|${tx.ticker}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }

  // Find cases where same ticker in same account has mixed currencies
  const mismatches: Array<{
    key: string;
    ticker: string;
    currencies: string[];
    transactions: number;
  }> = [];

  for (const [key, txList] of groups) {
    const currencies = new Set(txList.map(t => t.currency).filter((c): c is string => c !== null));
    if (currencies.size > 1) {
      mismatches.push({
        key,
        ticker: txList[0]!.ticker ?? "UNKNOWN",
        currencies: [...currencies],
        transactions: txList.length
      });
    }
  }

  if (mismatches.length === 0) {
    console.log("✅ No currency mismatches found - all good!\n");
    return;
  }

  console.log(`⚠️ Found ${mismatches.length} ticker-currency mismatches:\n`);

  mismatches.forEach(m => {
    console.log(`${m.key}`);
    console.log(`  Ticker: ${m.ticker}`);
    console.log(`  Currencies: ${m.currencies.join(", ")}`);
    console.log(`  Transactions: ${m.transactions}`);
    console.log("");
  });

  // Now check if the -U/-C suffixes are involved
  console.log("\n🔍 Checking if suffixes match currencies:\n");

  for (const [key, txList] of groups) {
    const currencies = new Set(txList.map(t => t.currency));
    if (currencies.size === 1) continue; // Skip single-currency

    const ticker = txList[0].ticker;
    const cur = [...currencies][0];

    console.log(`${key} | ${ticker}`);
    txList.forEach(tx => {
      const expected =
        tx.currency === "USD" ? "-U" : tx.currency === "CAD" ? "-C" : "";
      const hasCorrectSuffix = expected
        ? ticker.endsWith(expected)
        : !ticker.match(/-[UC]$/);
      const check = hasCorrectSuffix ? "✅" : "❌";
      console.log(
        `  ${check} Currency: ${tx.currency} | Ticker: ${ticker} | Qty: ${tx.quantity}`
      );
    });
    console.log("");
  }
}

checkMismatch()
  .catch(console.error)
  .finally(() => process.exit());
