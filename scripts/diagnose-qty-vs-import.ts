import { prisma } from "@/lib/db/prisma";
import { loadHoldingsForDashboard } from "@/features/portfolio/holdings-display-query";
import { makeAccountKey } from "@/features/portfolio/upsert-portfolio-state";
import { normalizeCurrency } from "@/lib/utils";

const fmt = (n: number) => n.toLocaleString("fr-CA", { maximumFractionDigits: 4 });

async function main() {
  const holdings = await loadHoldingsForDashboard();
  const latestImport = await prisma.portfolioImport.findFirst({
    where: { status: "COMPLETED" },
    orderBy: [{ dataToDate: "desc" }, { importedAt: "desc" }],
    include: {
      positions: {
        select: {
          accountNumber: true,
          currency: true,
          ticker: true,
          quantity: true,
          marketValue: true,
          account: { select: { accountName: true } },
        },
      },
    },
  });
  if (!latestImport) {
    console.log("Pas d'import");
    return;
  }
  console.log("Import:", latestImport.sourceFileName, latestImport.dataToDate?.toISOString().slice(0, 10));

  const importByKey = new Map<string, { qty: number; mv: number }>();
  for (const p of latestImport.positions) {
    const key = `${makeAccountKey(p.account?.accountName ?? "", p.currency, p.accountNumber ?? null)}|${p.ticker.toUpperCase()}|${normalizeCurrency(p.currency)}`;
    const cur = importByKey.get(key) ?? { qty: 0, mv: 0 };
    cur.qty += p.quantity;
    cur.mv += p.marketValue;
    importByKey.set(key, cur);
  }

  let mismatches = 0;
  for (const h of holdings) {
    if (h.quantity <= 0) continue;
    const key = `${h.accountKey}|${h.ticker.toUpperCase()}|${normalizeCurrency(h.currency)}`;
    const imp = importByKey.get(key);
    if (!imp) {
      console.log("Absent import:", key, "qty app=", h.quantity);
      mismatches++;
      continue;
    }
    if (Math.abs(imp.qty - h.quantity) > 0.0001) {
      console.log("Qty:", key, "app=", fmt(h.quantity), "import=", fmt(imp.qty));
      mismatches++;
    }
  }

  for (const [key, imp] of importByKey) {
    const found = holdings.some(
      (h) =>
        `${h.accountKey}|${h.ticker.toUpperCase()}|${normalizeCurrency(h.currency)}` === key &&
        h.quantity > 0,
    );
    if (!found) console.log("Absent app:", key, "import qty=", fmt(imp.qty));
  }

  console.log("\nLignes qty différentes ou absentes:", mismatches);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
