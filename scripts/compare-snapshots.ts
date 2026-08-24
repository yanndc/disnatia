import { prisma } from "@/lib/db/prisma";

async function compareSnapshots() {
  // Get latest positions from imports
  const latest = await prisma.portfolioPosition.findMany({
    where: { ticker: "AAPL" },
    orderBy: { import: { importedAt: "desc" } },
    take: 10,
    include: { import: true }
  });

  console.log("Latest AAPL positions from Disnat snapshots:\n");

  latest.forEach((pos, i) => {
    const date = pos.import.importedAt.toISOString().split("T")[0];
    const dataDate = pos.import.dataToDate?.toISOString().split("T")[0];
    console.log(`[${i}] ${date} (data as of ${dataDate})`);
    console.log(`    Account: ${pos.accountNumber}`);
    console.log(`    Quantity: ${pos.quantity}`);
    console.log(`    Avg Cost: $${pos.averageCost}`);
    console.log("");
  });

  // Compare with computed holdings
  const holdings = await prisma.portfolioHolding.findMany({
    where: { ticker: "AAPL" }
  });

  console.log("\nComputed Holdings (from transactions):\n");
  holdings.forEach(h => {
    console.log(`Account: ${h.accountKey}`);
    console.log(`  Quantity: ${h.quantity}`);
    console.log(`  Avg Cost: $${h.averageCost}`);
  });
}

compareSnapshots()
  .catch(console.error)
  .finally(() => process.exit());
