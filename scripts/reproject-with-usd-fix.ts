import { projectHoldingsFromTransactions } from "@/features/portfolio/project-transaction-holdings";
import { prisma } from "@/lib/db/prisma";

async function reprojectWithUsdFix() {
  console.log("🔄 Re-projecting holdings with corrected USD ticker handling...\n");

  const res = await projectHoldingsFromTransactions();

  console.log("✅ Re-projection complete:");
  console.log(`   Transactions considered: ${res.transactionsConsidered}`);
  console.log(`   Holdings projected: ${res.currentHoldingsProjected}\n`);

  // Check the USD positions
  console.log("Checking USD positions now:");
  const usdHoldings = await prisma.portfolioHolding.findMany({
    where: { ticker: { contains: "-U" } }
  });

  console.log(`\nFound ${usdHoldings.length} USD holdings:\n`);
  usdHoldings.slice(0, 10).forEach(h => {
    console.log(`  ${h.ticker} (${h.accountKey}): ${h.quantity}`);
  });
}

reprojectWithUsdFix()
  .catch(console.error)
  .finally(() => process.exit());
