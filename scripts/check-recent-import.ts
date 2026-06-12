import { prisma } from "@/lib/db/prisma";

async function main() {
  const recent = await prisma.portfolioImport.findMany({
    orderBy: { importedAt: "desc" },
    take: 5,
    select: {
      id: true,
      sourceFileName: true,
      importedAt: true,
      status: true,
      dataToDate: true,
      _count: { select: { transactions: true } },
    },
  });
  console.log("=== Imports récents ===");
  for (const r of recent) {
    console.log(
      `${r.importedAt.toISOString().slice(0, 19)} | ${r.sourceFileName} | ${r.status} | ${r._count.transactions} tx`,
    );
  }

  const b3 = await prisma.portfolioTransactionLine.count({
    where: {
      OR: [
        { accountKey: { contains: "5L3APB3" } },
        { accountName: { contains: "5L3APB3", mode: "insensitive" } },
        { accountNumber: { contains: "5L3APB3", mode: "insensitive" } },
      ],
    },
  });
  console.log(`\nTransactions 5L3APB3 (toute source): ${b3}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
