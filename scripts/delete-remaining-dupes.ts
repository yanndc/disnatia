import { prisma } from "@/lib/db/prisma";

async function deleteRemainingDuplicates() {
  // These are confirmed duplicates
  const toDelete = [
    'cmt3eldgc0n9a04jxszhr71ij', // 2026-02-12 DIVIDENDE 31 shares duplicate
  ];

  console.log('Deleting remaining dividend duplicates...');
  const result = await prisma.portfolioTransactionLine.deleteMany({
    where: { id: { in: toDelete } }
  });

  console.log(`✅ Deleted ${result.count} transactions`);

  // Re-project
  const { projectHoldingsFromTransactions } = await import("@/features/portfolio/project-transaction-holdings");
  const res = await projectHoldingsFromTransactions();
  console.log(`Holdings re-projected: ${res.currentHoldingsProjected} positions`);
}

deleteRemainingDuplicates()
  .catch(console.error)
  .finally(() => process.exit());
