import { prisma } from "@/lib/db/prisma";
import { makeAccountKey } from "@/features/portfolio/upsert-portfolio-state";

async function main() {
  const imports = await prisma.portfolioImport.findMany({
    where: { status: "COMPLETED" },
    orderBy: [{ dataToDate: "desc" }],
    select: {
      id: true,
      dataToDate: true,
      accounts: {
        select: {
          accountName: true,
          accountNumber: true,
          currency: true,
          totalValue: true,
          marketValue: true,
          cashValue: true,
        },
      },
    },
    take: 20,
  });

  for (const imp of imports) {
    const acc = imp.accounts.find(
      (a) => makeAccountKey(a.accountName, a.currency, a.accountNumber) === "5KFZEZ2|CAD",
    );
    if (!acc) continue;
    console.log(
      imp.dataToDate?.toISOString().slice(0, 10),
      "total",
      acc.totalValue,
      "market",
      acc.marketValue,
      "cash",
      acc.cashValue,
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
